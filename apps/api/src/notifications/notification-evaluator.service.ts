import { ForbiddenException, Injectable } from '@nestjs/common';
import { StockIntelligenceService } from '../inventory/stock-intelligence.service.js';
import { localCalendarDate } from '../inventory/plan-use.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  localQuietEnd,
  notificationCandidates,
  type HouseholdAssessments,
} from './notification-rules.js';

@Injectable()
export class NotificationEvaluatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intelligence: StockIntelligenceService,
  ) {}

  private async assessedHouseholds(userId: string, at: Date) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { householdId: true, household: { select: { name: true } } },
      orderBy: { householdId: 'asc' },
    });
    const households: (HouseholdAssessments & { name: string })[] = [];
    for (const membership of memberships) {
      try {
        const assessed = await this.intelligence.assessHousehold(
          userId,
          membership.householdId,
          undefined,
          at,
        );
        households.push({
          householdId: membership.householdId,
          name: membership.household.name,
          assessments: assessed.assessments,
        });
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return households;
  }

  private async currentCandidates(userId: string, at: Date) {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (
      !preference ||
      (!preference.lowStockAlertsEnabled && !preference.expiryAlertsEnabled)
    )
      return { candidates: [], preference };
    const households = await this.assessedHouseholds(userId, at);
    return {
      candidates: notificationCandidates(households, preference),
      preference,
    };
  }

  async attention(userId: string, at = new Date()) {
    const households = await this.assessedHouseholds(userId, at);
    const candidates = notificationCandidates(households, {
      lowStockAlertsEnabled: true,
      expiryAlertsEnabled: true,
      dailyDigestEnabled: true,
      quietHoursStart: null,
      quietHoursEnd: null,
    });
    const digest = candidates.find(
      (candidate) => candidate.kind === 'DAILY_DIGEST',
    );
    const grouped =
      digest?.content && 'households' in digest.content
        ? digest.content.households
        : [];
    return {
      asOf: at.toISOString(),
      households: grouped.map((group) => {
        const household = households.find(
          (row) => row.householdId === group.householdId,
        )!;
        return {
          householdId: group.householdId,
          name: household.name,
          items: group.items.map((item) => {
            const assessment = household.assessments.find(
              (row) => row.itemId === item.itemId,
            )!;
            return {
              itemId: item.itemId,
              name: assessment.name,
              trackingMode: assessment.trackingMode,
              signals: item.signals,
              lowStockRisk: assessment.lowStockRisk,
              expiryRisk: assessment.expiryRisk,
            };
          }),
        };
      }),
    };
  }

  // Internal entry point. No public route or scheduler invokes it in this slice.
  async evaluateUser(
    userId: string,
    at = new Date(),
    kind?: 'IMMEDIATE_ITEM' | 'DAILY_DIGEST',
  ) {
    const { candidates, preference } = await this.currentCandidates(userId, at);
    const selected = kind
      ? candidates.filter((candidate) => candidate.kind === kind)
      : candidates;
    if (!preference || !selected.length) return { created: 0 };
    const quietEnd = localQuietEnd(at, preference);
    const result = await this.prisma.notificationIntent.createMany({
      data: selected.map((candidate) => ({
        userId,
        kind: candidate.kind,
        status: quietEnd ? ('DEFERRED' as const) : ('PENDING' as const),
        localDay: localCalendarDate(at),
        subjectKey: candidate.subjectKey,
        householdId: candidate.householdId,
        itemId: candidate.itemId,
        content: candidate.content,
        dueAt: quietEnd ?? at,
      })),
      skipDuplicates: true,
    });
    return { created: result.count };
  }

  async evaluateEligibleUsers(
    at = new Date(),
    kind?: 'IMMEDIATE_ITEM' | 'DAILY_DIGEST',
  ) {
    const preferences = await this.prisma.notificationPreference.findMany({
      where: {
        OR: [{ lowStockAlertsEnabled: true }, { expiryAlertsEnabled: true }],
      },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    });
    for (const preference of preferences)
      await this.evaluateUser(preference.userId, at, kind);
  }

  // A future sender must call this before any delivery; stored content is only a snapshot.
  async revalidateIntent(intentId: string, at = new Date()) {
    const intent = await this.prisma.notificationIntent.findUnique({
      where: { id: intentId },
    });
    if (!intent) return { ready: false, reason: 'NOT_FOUND' as const };
    if (intent.dueAt > at) return { ready: false, reason: 'NOT_DUE' as const };
    const today = localCalendarDate(at);
    const priorSignal =
      intent.content &&
      typeof intent.content === 'object' &&
      !Array.isArray(intent.content) &&
      'signal' in intent.content
        ? intent.content.signal
        : null;
    if (
      intent.kind === 'IMMEDIATE_ITEM' &&
      intent.localDay !== today &&
      priorSignal === 'USE_TODAY'
    )
      return { ready: false, reason: 'STALE_DAY' as const };
    const overnightDigest =
      intent.kind === 'DAILY_DIGEST' && intent.localDay !== today;
    if (
      overnightDigest &&
      (intent.status !== 'DEFERRED' ||
        localCalendarDate(intent.dueAt) !== today)
    )
      return { ready: false, reason: 'STALE_DAY' as const };
    const { candidates, preference } = await this.currentCandidates(
      intent.userId,
      at,
    );
    if (!preference)
      return { ready: false, reason: 'PREFERENCE_DISABLED' as const };
    if (localQuietEnd(at, preference))
      return { ready: false, reason: 'QUIET_HOURS' as const };
    const candidate = candidates.find(
      (value) =>
        value.kind === intent.kind && value.subjectKey === intent.subjectKey,
    );
    if (!candidate) return { ready: false, reason: 'STALE_CANDIDATE' as const };
    if (overnightDigest) {
      await this.prisma.notificationIntent.createMany({
        data: [
          {
            userId: intent.userId,
            kind: 'DAILY_DIGEST',
            status: 'PENDING',
            localDay: today,
            subjectKey: 'all',
            householdId: null,
            itemId: null,
            content: candidate.content,
            dueAt: at,
          },
        ],
        skipDuplicates: true,
      });
      const replacement =
        await this.prisma.notificationIntent.findUniqueOrThrow({
          where: {
            userId_kind_localDay_subjectKey: {
              userId: intent.userId,
              kind: 'DAILY_DIGEST',
              localDay: today,
              subjectKey: 'all',
            },
          },
          select: { id: true },
        });
      return {
        ready: false,
        reason: 'ROLLED_OVER' as const,
        replacementIntentId: replacement.id,
      };
    }
    if (
      intent.kind === 'IMMEDIATE_ITEM' &&
      (!('signal' in candidate.content) ||
        candidate.content.signal !== priorSignal)
    )
      return { ready: false, reason: 'STALE_CANDIDATE' as const };
    return { ready: true, content: candidate.content };
  }
}
