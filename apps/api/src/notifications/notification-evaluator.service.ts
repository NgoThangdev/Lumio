import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { StockIntelligenceService } from '../inventory/stock-intelligence.service.js';
import { localCalendarDate } from '../inventory/plan-use.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireActiveHousehold } from '../households/active-household.js';
import {
  localQuietEnd,
  notificationCandidates,
  type Candidate,
  type HouseholdAssessments,
} from './notification-rules.js';

function localTime(at: Date) {
  return new Date(at.getTime() + 7 * 60 * 60_000).toISOString().slice(11, 16);
}

@Injectable()
export class NotificationEvaluatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intelligence: StockIntelligenceService,
  ) {}

  private async assessedHouseholds(userId: string, at: Date) {
    return this.prisma.$transaction(async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { userId },
        select: { householdId: true },
        orderBy: { householdId: 'asc' },
      });
      const households: (HouseholdAssessments & { name: string })[] = [];
      for (const membership of memberships) {
        try {
          await requireActiveHousehold(tx, userId, membership.householdId);
          const [household, assessed] = await Promise.all([
            tx.household.findUniqueOrThrow({
              where: { id: membership.householdId },
              select: { name: true },
            }),
            this.intelligence.assessInTransaction(
              tx,
              userId,
              membership.householdId,
              undefined,
              at,
            ),
          ]);
          households.push({
            householdId: membership.householdId,
            name: household.name,
            assessments: assessed.assessments,
          });
        } catch (error) {
          if (!(
            error instanceof ForbiddenException ||
            error instanceof ConflictException
          ))
            throw error;
        }
      }
      return households;
    });
  }

  private async currentCandidates(
    userId: string,
    at: Date,
    digestDueOnly = false,
  ) {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (
      !preference ||
      (digestDueOnly && preference.digestTime > localTime(at)) ||
      (!preference.lowStockAlertsEnabled && !preference.expiryAlertsEnabled)
    )
      return { candidates: [], preference };
    const households = await this.assessedHouseholds(userId, at);
    return {
      candidates: notificationCandidates(households, preference),
      preference,
    };
  }

  // Serialize candidate insertion with item deletion. Assessments are computed
  // before this transaction, so a deleted/archived item must be pruned here.
  private async lockAndPruneCandidates(
    tx: Prisma.TransactionClient,
    candidates: Candidate[],
  ): Promise<Candidate[]> {
    const householdIds = [
      ...new Set(
        candidates.flatMap((candidate) =>
          candidate.kind === 'IMMEDIATE_ITEM'
            ? [candidate.householdId!]
            : 'households' in candidate.content
              ? candidate.content.households.map((group) => group.householdId)
              : [],
        ),
      ),
    ].sort();
    if (!householdIds.length) return [];
    const activeHouseholds = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Household"
      WHERE "id" IN (${Prisma.join(householdIds)})
        AND "deletionRequestId" IS NULL
      ORDER BY "id" FOR SHARE
    `;
    const active = new Set(activeHouseholds.map((row) => row.id));
    if (!active.size) return [];
    const ids = [
      ...new Set(
        candidates.flatMap((candidate) =>
          candidate.kind === 'IMMEDIATE_ITEM'
            ? [candidate.itemId!]
            : candidate.content && 'households' in candidate.content
              ? candidate.content.households.flatMap((group) =>
                  group.items.map((item) => item.itemId),
                )
              : [],
        ),
      ),
    ].sort();
    if (!ids.length) return [];
    const rows = await tx.$queryRaw<Array<{ id: string; householdId: string }>>`
      SELECT "id", "householdId" FROM "InventoryItem"
      WHERE "id" IN (${Prisma.join(ids)}) AND "archivedAt" IS NULL
        AND "householdId" IN (${Prisma.join([...active])})
      ORDER BY "id" FOR SHARE
    `;
    const valid = new Set(rows.map((row) => `${row.householdId}:${row.id}`));
    return candidates.flatMap((candidate) => {
      if (candidate.kind === 'IMMEDIATE_ITEM')
        return active.has(candidate.householdId!) &&
          valid.has(`${candidate.householdId}:${candidate.itemId}`)
          ? [candidate]
          : [];
      if (!('households' in candidate.content)) return [];
      const households = candidate.content.households
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              active.has(group.householdId) &&
              valid.has(`${group.householdId}:${item.itemId}`),
          ),
        }))
        .filter((group) => group.items.length > 0);
      return households.length
        ? [{ ...candidate, content: { households } }]
        : [];
    });
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

  // Internal candidate evaluator; scheduled selection calls this after finding due users.
  async evaluateUser(
    userId: string,
    at = new Date(),
    kind?: 'IMMEDIATE_ITEM' | 'DAILY_DIGEST',
    requireDueTime = false,
  ) {
    const { candidates, preference } = await this.currentCandidates(
      userId,
      at,
      requireDueTime && kind === 'DAILY_DIGEST',
    );
    const selected = kind
      ? candidates.filter((candidate) => candidate.kind === kind)
      : candidates;
    if (!preference || !selected.length) return { created: 0 };
    const quietEnd = localQuietEnd(at, preference);
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndPruneCandidates(tx, selected);
      if (!current.length) return { created: 0 };
      const result = await tx.notificationIntent.createMany({
        data: current.map((candidate) => ({
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
    });
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

  // Run on each scheduler minute so a preference change takes effect without a restart.
  // The user/day/subject database key remains the final duplicate guard.
  async evaluateDueDigests(at = new Date()) {
    const day = localCalendarDate(at);
    const preferences = await this.prisma.notificationPreference.findMany({
      where: {
        dailyDigestEnabled: true,
        digestTime: { lte: localTime(at) },
        OR: [{ lowStockAlertsEnabled: true }, { expiryAlertsEnabled: true }],
        user: {
          notificationIntents: {
            none: {
              kind: 'DAILY_DIGEST',
              localDay: day,
              subjectKey: 'all',
            },
          },
        },
      },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    });
    for (const preference of preferences)
      await this.evaluateUser(preference.userId, at, 'DAILY_DIGEST', true);
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
      const replacement = await this.prisma.$transaction(async (tx) => {
        const current = await this.lockAndPruneCandidates(tx, [candidate]);
        if (!current.length) return null;
        await tx.notificationIntent.createMany({
          data: [
            {
              userId: intent.userId,
              kind: 'DAILY_DIGEST',
              status: 'PENDING',
              localDay: today,
              subjectKey: 'all',
              householdId: null,
              itemId: null,
              content: current[0].content,
              dueAt: at,
            },
          ],
          skipDuplicates: true,
        });
        return tx.notificationIntent.findUniqueOrThrow({
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
      });
      if (!replacement)
        return { ready: false, reason: 'STALE_CANDIDATE' as const };
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
