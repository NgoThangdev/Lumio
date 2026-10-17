import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { localCalendarDate } from '../inventory/plan-use.js';
import { NotificationEvaluatorService } from './notification-evaluator.service.js';
import { localQuietEnd } from './notification-rules.js';

export type DeliverySubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export interface PushTransport {
  // Acceptance is not a read receipt.
  isAvailable?(): boolean;
  send(subscription: DeliverySubscription, content: unknown): Promise<void>;
}

// Only a definite, pre-acceptance failure may be retried. An ambiguous throw
// leaves the claim unresolved and is later classified UNKNOWN.
export class RetryablePushError extends Error {}
export class PermanentPushError extends Error {}
export class InvalidPushSubscriptionError extends PermanentPushError {}

@Injectable()
export class DisabledPushTransport implements PushTransport {
  isAvailable() {
    return false;
  }

  async send(): Promise<void> {
    throw new Error('PUSH_TRANSPORT_DISABLED');
  }
}

const retryDelayMs = 5 * 60 * 1000;
const claimUnknownAfterMs = 5 * 60 * 1000;
const maxAttempts = 3;

function subscriptionKey(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

@Injectable()
export class NotificationDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: NotificationEvaluatorService,
    @Inject('PUSH_TRANSPORT') private readonly transport: PushTransport,
  ) {}

  // Read-only manual preflight. No endpoint, key, or stored content escapes.
  async preflightIntent(userId: string, intentId: string, at = new Date()) {
    const intent = await this.prisma.notificationIntent.findUnique({
      where: { id: intentId },
      select: { userId: true, kind: true, localDay: true, dueAt: true },
    });
    let destinationKind: 'ATTENTION' | 'ITEM' | null = null;
    let subscriptionCount = 0;
    const unavailable = (reason: string) => ({
      eligible: false,
      reason,
      subscriptionCount,
      destinationKind,
    });
    if (!intent || intent.userId !== userId) return unavailable('NOT_FOUND');
    destinationKind = intent.kind === 'DAILY_DIGEST' ? 'ATTENTION' : 'ITEM';
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { session: { userId, expiresAt: { gt: at } } },
      select: { endpoint: true },
    });
    subscriptionCount = subscriptions.length;
    if (intent.dueAt > at) return unavailable('NOT_DUE');
    // Revalidating a prior-day deferred digest can create a rollover intent.
    if (
      intent.kind === 'DAILY_DIGEST' &&
      intent.localDay !== localCalendarDate(at)
    )
      return unavailable('STALE_DAY');
    if (this.transport.isAvailable?.() === false)
      return unavailable('TRANSPORT_UNAVAILABLE');
    const validation = await this.evaluator.revalidateIntent(intentId, at);
    if (!validation.ready)
      return unavailable(validation.reason ?? 'STALE_CANDIDATE');
    if (subscriptions.length !== 1) return unavailable('SUBSCRIPTION_COUNT');
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: {
        intentId_subscriptionKey: {
          intentId,
          subscriptionKey: subscriptionKey(subscriptions[0].endpoint),
        },
      },
      select: { status: true, nextAttemptAt: true },
    });
    if (
      delivery &&
      delivery.status !== 'PENDING' &&
      !(
        delivery.status === 'RETRY' &&
        delivery.nextAttemptAt &&
        delivery.nextAttemptAt <= at
      )
    )
      return unavailable('ALREADY_ATTEMPTED');
    return {
      eligible: true,
      reason: 'READY',
      subscriptionCount: 1,
      destinationKind,
    };
  }

  // Internal manual send boundary. Call only after reviewing a fresh preflight.
  async dispatchIntentForUser(
    userId: string,
    intentId: string,
    at = new Date(),
  ) {
    const preflight = await this.preflightIntent(userId, intentId, at);
    if (!preflight.eligible)
      throw new Error(`SCOPED_DISPATCH_${preflight.reason}`);
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { session: { userId, expiresAt: { gt: at } } },
      select: { endpoint: true },
    });
    if (subscriptions.length !== 1)
      throw new Error('SCOPED_DISPATCH_SUBSCRIPTION_COUNT');
    return this.dispatch(at, {
      userId,
      intentId,
      endpoint: subscriptions[0].endpoint,
    });
  }

  // Internal only. No scheduler or public route invokes this boundary.
  async dispatchDue(at = new Date(), createdAtGte?: Date) {
    return this.dispatch(at, undefined, createdAtGte);
  }

  private async dispatch(
    at: Date,
    scope?: { userId: string; intentId: string; endpoint: string },
    createdAtGte?: Date,
  ) {
    const result = {
      accepted: 0,
      retry: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
      rolledOver: 0,
    };
    if (this.transport.isAvailable?.() === false) return result;
    if (!scope)
      await this.prisma.notificationDelivery.updateMany({
        where: {
          status: 'CLAIMED',
          claimedAt: { lte: new Date(at.getTime() - claimUnknownAfterMs) },
          ...(createdAtGte
            ? { intent: { createdAt: { gte: createdAtGte } } }
            : {}),
        },
        data: { status: 'UNKNOWN', lastErrorCode: 'UNKNOWN_ACK' },
      });
    const due = scope
      ? [{ id: scope.intentId }]
      : await this.prisma.notificationIntent.findMany({
          where: {
            dueAt: { lte: at },
            ...(createdAtGte ? { createdAt: { gte: createdAtGte } } : {}),
          },
          select: { id: true },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        });
    const queue = due.map((intent) => intent.id);
    const seen = new Set<string>();
    for (const intentId of queue) {
      if (seen.has(intentId)) continue;
      seen.add(intentId);
      if (scope && intentId !== scope.intentId) continue;
      // A rollover replacement can join the queue after the initial cutoff query.
      if (createdAtGte) {
        const activated = await this.prisma.notificationIntent.findFirst({
          where: { id: intentId, createdAt: { gte: createdAtGte } },
          select: { id: true },
        });
        if (!activated) continue;
      }
      const validation = await this.evaluator.revalidateIntent(intentId, at);
      if (!validation.ready) {
        if (validation.reason === 'ROLLED_OVER') {
          result.rolledOver++;
          queue.push(validation.replacementIntentId);
        }
        continue;
      }
      const intent = await this.prisma.notificationIntent.findUniqueOrThrow({
        where: { id: intentId },
        select: { userId: true },
      });
      if (scope && intent.userId !== scope.userId)
        throw new Error('SCOPED_DISPATCH_NOT_FOUND');
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: {
          session: { userId: intent.userId, expiresAt: { gt: at } },
        },
        select: { endpoint: true },
      });
      if (
        scope &&
        (subscriptions.length !== 1 ||
          subscriptions[0].endpoint !== scope.endpoint)
      )
        throw new Error('SCOPED_DISPATCH_SUBSCRIPTION_COUNT');
      await this.prisma.notificationDelivery.createMany({
        data: subscriptions.map((subscription) => ({
          intentId,
          subscriptionKey: subscriptionKey(subscription.endpoint),
        })),
        skipDuplicates: true,
      });
      for (const subscription of subscriptions) {
        const key = subscriptionKey(subscription.endpoint);
        const claimed = await this.prisma.notificationDelivery.updateMany({
          where: {
            intentId,
            subscriptionKey: key,
            OR: [
              { status: 'PENDING' },
              { status: 'RETRY', nextAttemptAt: { lte: at } },
            ],
          },
          data: {
            status: 'CLAIMED',
            claimedAt: at,
            attemptCount: { increment: 1 },
            lastErrorCode: null,
          },
        });
        if (!claimed.count) continue;
        const fresh = await this.evaluator.revalidateIntent(intentId, at);
        const current = await this.prisma.pushSubscription.findUnique({
          where: { endpoint: subscription.endpoint },
          select: {
            endpoint: true,
            p256dh: true,
            auth: true,
            sessionTokenHash: true,
            updatedAt: true,
            session: { select: { userId: true, expiresAt: true } },
          },
        });
        const scopedSubscriptions = scope
          ? await this.prisma.pushSubscription.findMany({
              where: {
                session: { userId: scope.userId, expiresAt: { gt: at } },
              },
              select: { endpoint: true },
            })
          : null;
        if (
          !current ||
          current.session.userId !== intent.userId ||
          current.session.expiresAt <= at ||
          (scope &&
            (scopedSubscriptions?.length !== 1 ||
              scopedSubscriptions[0].endpoint !== scope.endpoint)) ||
          !fresh.ready
        ) {
          const quietPreference =
            current &&
            current.session.userId === intent.userId &&
            current.session.expiresAt > at &&
            !fresh.ready &&
            fresh.reason === 'QUIET_HOURS'
              ? await this.prisma.notificationPreference.findUnique({
                  where: { userId: intent.userId },
                })
              : null;
          const quietEnd = quietPreference
            ? localQuietEnd(at, quietPreference)
            : null;
          await this.prisma.notificationDelivery.update({
            where: {
              intentId_subscriptionKey: { intentId, subscriptionKey: key },
            },
            data: quietEnd
              ? {
                  status: 'RETRY',
                  nextAttemptAt: quietEnd,
                  lastErrorCode: null,
                }
              : { status: 'SKIPPED', lastErrorCode: 'NO_LONGER_ELIGIBLE' },
          });
          if (quietEnd) result.retry++;
          else result.skipped++;
          if (!fresh.ready && fresh.reason === 'ROLLED_OVER')
            queue.push(fresh.replacementIntentId);
          continue;
        }
        let sendOutcome:
          'ACCEPTED' | 'RETRY' | 'FAILED' | 'INVALID_SUBSCRIPTION' | 'UNKNOWN' =
          'ACCEPTED';
        try {
          await this.transport.send(
            {
              endpoint: current.endpoint,
              p256dh: current.p256dh,
              auth: current.auth,
            },
            fresh.content,
          );
        } catch (error) {
          if (error instanceof InvalidPushSubscriptionError)
            sendOutcome = 'INVALID_SUBSCRIPTION';
          else if (error instanceof RetryablePushError) sendOutcome = 'RETRY';
          else if (error instanceof PermanentPushError) sendOutcome = 'FAILED';
          else sendOutcome = 'UNKNOWN';
        }
        if (sendOutcome === 'UNKNOWN') {
          result.unknown++;
          continue;
        }
        if (sendOutcome === 'ACCEPTED') {
          await this.prisma.notificationDelivery.update({
            where: {
              intentId_subscriptionKey: { intentId, subscriptionKey: key },
            },
            data: { status: 'ACCEPTED', acceptedAt: at, nextAttemptAt: null },
          });
          result.accepted++;
        } else if (sendOutcome === 'INVALID_SUBSCRIPTION') {
          await this.prisma.pushSubscription.deleteMany({
            where: {
              endpoint: current.endpoint,
              sessionTokenHash: current.sessionTokenHash,
              updatedAt: current.updatedAt,
              p256dh: current.p256dh,
              auth: current.auth,
            },
          });
          await this.prisma.notificationDelivery.update({
            where: {
              intentId_subscriptionKey: { intentId, subscriptionKey: key },
            },
            data: { status: 'FAILED', lastErrorCode: 'SUBSCRIPTION_INVALID' },
          });
          result.failed++;
        } else if (sendOutcome === 'FAILED') {
          await this.prisma.notificationDelivery.update({
            where: {
              intentId_subscriptionKey: { intentId, subscriptionKey: key },
            },
            data: { status: 'FAILED', lastErrorCode: 'PUSH_SERVICE_REJECTED' },
          });
          result.failed++;
        } else {
          const delivery =
            await this.prisma.notificationDelivery.findUniqueOrThrow({
              where: {
                intentId_subscriptionKey: { intentId, subscriptionKey: key },
              },
              select: { attemptCount: true },
            });
          const retry = delivery.attemptCount < maxAttempts;
          await this.prisma.notificationDelivery.update({
            where: {
              intentId_subscriptionKey: { intentId, subscriptionKey: key },
            },
            data: {
              status: retry ? 'RETRY' : 'FAILED',
              nextAttemptAt: retry
                ? new Date(at.getTime() + retryDelayMs)
                : null,
              lastErrorCode: 'TRANSPORT_ERROR',
            },
          });
          if (retry) result.retry++;
          else result.failed++;
        }
      }
    }
    return result;
  }
}
