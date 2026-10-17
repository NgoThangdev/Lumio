import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  NotificationDispatchService,
  RetryablePushError,
} from '../src/notifications/notification-dispatch.service.js';
import { NotificationEvaluatorService } from '../src/notifications/notification-evaluator.service.js';
import {
  NOTIFICATION_SCHEDULER_CONFIG,
  type NotificationSchedulerConfig,
} from '../src/notifications/notification-scheduler.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const morning = new Date('2026-10-14T02:00:00.000Z');
const quiet = new Date('2026-10-14T16:00:00.000Z');
const nextMorning = new Date('2026-10-15T00:00:00.000Z');

describe('Notification dispatch (database, fake transport)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let evaluator: NotificationEvaluatorService;
  let dispatcher: NotificationDispatchService;
  const transport = { send: vi.fn().mockResolvedValue(undefined) };
  const users: string[] = [];
  const households: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('PUSH_TRANSPORT')
      .useValue(transport)
      .compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    evaluator = app.get(NotificationEvaluatorService);
    dispatcher = app.get(NotificationDispatchService);
  });
  beforeEach(() => transport.send.mockReset().mockResolvedValue(undefined));
  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: households } },
      select: { id: true },
    });
    await prisma.stockBatch.deleteMany({
      where: { itemId: { in: items.map((item) => item.id) } },
    });
    await prisma.inventoryItem.deleteMany({
      where: { id: { in: items.map((item) => item.id) } },
    });
    await prisma.household.deleteMany({ where: { id: { in: households } } });
    await app.close();
  });

  async function fixture(
    devices = 2,
    options: { digest?: boolean; quiet?: boolean } = {},
  ) {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'fixture',
      },
    });
    users.push(user.id);
    const household = await prisma.household.create({
      data: { name: `Fixture ${randomUUID()}` },
    });
    households.push(household.id);
    await prisma.membership.create({
      data: { userId: user.id, householdId: household.id, role: 'MEMBER' },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        householdId: household.id,
        name: 'Essential',
        primaryUnit: 'box',
        neverRunOut: true,
      },
    });
    await prisma.notificationPreference.create({
      data: {
        userId: user.id,
        lowStockAlertsEnabled: true,
        dailyDigestEnabled: options.digest ?? false,
        quietHoursStart: options.quiet ? '22:00' : null,
        quietHoursEnd: options.quiet ? '07:00' : null,
      },
    });
    const endpoints: string[] = [];
    for (let index = 0; index < devices; index++) {
      const tokenHash = randomBytes(32).toString('hex');
      await prisma.userSession.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt: new Date('2026-10-20T00:00:00.000Z'),
        },
      });
      const endpoint = `https://push.example.invalid/${randomUUID()}`;
      endpoints.push(endpoint);
      await prisma.pushSubscription.create({
        data: {
          endpoint,
          p256dh: 'fake-public-key',
          auth: 'fake-auth',
          sessionTokenHash: tokenHash,
        },
      });
    }
    return {
      userId: user.id,
      householdId: household.id,
      itemId: item.id,
      endpoints,
    };
  }

  it('wires the scheduler disabled in the shared local environment', () => {
    expect(
      app.get<NotificationSchedulerConfig>(NOTIFICATION_SCHEDULER_CONFIG),
    ).toEqual({ enabled: false });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('preflights without writes and confines manual fake dispatch to one user and device', async () => {
    const alice = await fixture(1);
    const bob = await fixture(1);
    await evaluator.evaluateUser(alice.userId, morning);
    await evaluator.evaluateUser(bob.userId, morning);
    const aliceIntent = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: alice.userId },
    });
    const bobIntent = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: bob.userId },
    });
    expect(
      await dispatcher.preflightIntent(alice.userId, bobIntent.id, morning),
    ).toMatchObject({
      eligible: false,
      reason: 'NOT_FOUND',
      subscriptionCount: 0,
    });
    expect(
      await dispatcher.preflightIntent(alice.userId, aliceIntent.id, morning),
    ).toMatchObject({
      eligible: true,
      subscriptionCount: 1,
      destinationKind: 'ITEM',
    });
    expect(transport.send).not.toHaveBeenCalled();
    expect(
      await prisma.notificationDelivery.count({
        where: { intentId: aliceIntent.id },
      }),
    ).toBe(0);
    await dispatcher.dispatchIntentForUser(
      alice.userId,
      aliceIntent.id,
      morning,
    );
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(
      await prisma.notificationDelivery.count({
        where: { intentId: bobIntent.id },
      }),
    ).toBe(0);
    expect(
      await dispatcher.preflightIntent(alice.userId, aliceIntent.id, morning),
    ).toMatchObject({
      eligible: false,
      reason: 'ALREADY_ATTEMPTED',
    });
  });

  it('blocks manual fake dispatch for multiple devices or stale stock', async () => {
    const multiple = await fixture(2);
    const stale = await fixture(1);
    await evaluator.evaluateUser(multiple.userId, morning);
    await evaluator.evaluateUser(stale.userId, morning);
    const multipleIntent = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: multiple.userId },
    });
    const staleIntent = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: stale.userId },
    });
    expect(
      await dispatcher.preflightIntent(
        multiple.userId,
        multipleIntent.id,
        morning,
      ),
    ).toMatchObject({
      eligible: false,
      reason: 'SUBSCRIPTION_COUNT',
      subscriptionCount: 2,
    });
    await expect(
      dispatcher.dispatchIntentForUser(
        multiple.userId,
        multipleIntent.id,
        morning,
      ),
    ).rejects.toThrow('SCOPED_DISPATCH_SUBSCRIPTION_COUNT');
    await prisma.stockBatch.create({
      data: { itemId: stale.itemId, quantity: '1' },
    });
    expect(
      await dispatcher.preflightIntent(stale.userId, staleIntent.id, morning),
    ).toMatchObject({
      eligible: false,
      reason: 'STALE_CANDIDATE',
    });
    await expect(
      dispatcher.dispatchIntentForUser(stale.userId, staleIntent.id, morning),
    ).rejects.toThrow('SCOPED_DISPATCH_STALE_CANDIDATE');
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('sends to two devices once across concurrent and repeated dispatch', async () => {
    const row = await fixture();
    await evaluator.evaluateUser(row.userId, morning);
    await Promise.all(
      Array.from({ length: 4 }, () => dispatcher.dispatchDue(morning)),
    );
    await dispatcher.dispatchDue(morning);
    const intent = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: row.userId },
    });
    expect(
      transport.send.mock.calls.filter(([subscription]) =>
        row.endpoints.includes(subscription.endpoint as string),
      ),
    ).toHaveLength(2);
    expect(
      await prisma.notificationDelivery.count({
        where: { intentId: intent.id, status: 'ACCEPTED' },
      }),
    ).toBe(2);
  });

  it('retries a definite pre-acceptance failure without duplicating an accepted device', async () => {
    const row = await fixture(1);
    await evaluator.evaluateUser(row.userId, morning);
    transport.send.mockRejectedValueOnce(
      new RetryablePushError('test failure'),
    );
    await dispatcher.dispatchDue(morning);
    expect(
      await prisma.notificationDelivery.count({
        where: { status: 'RETRY', intent: { userId: row.userId } },
      }),
    ).toBe(1);
    await dispatcher.dispatchDue(new Date(morning.getTime() + 5 * 60_000));
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(
      await prisma.notificationDelivery.count({
        where: { status: 'ACCEPTED', intent: { userId: row.userId } },
      }),
    ).toBe(1);
  });

  it('blocks stale stock and removed or expired subscriptions', async () => {
    const row = await fixture(2);
    await evaluator.evaluateUser(row.userId, morning);
    await prisma.stockBatch.create({
      data: { itemId: row.itemId, quantity: '1' },
    });
    await dispatcher.dispatchDue(morning);
    expect(transport.send).not.toHaveBeenCalled();
    await prisma.stockBatch.deleteMany({ where: { itemId: row.itemId } });
    const removed = await prisma.pushSubscription.findUniqueOrThrow({
      where: { endpoint: row.endpoints[0] },
    });
    await prisma.userSession.delete({
      where: { tokenHash: removed.sessionTokenHash },
    });
    const expired = await prisma.pushSubscription.findUniqueOrThrow({
      where: { endpoint: row.endpoints[1] },
    });
    await prisma.userSession.update({
      where: { tokenHash: expired.sessionTokenHash },
      data: { expiresAt: morning },
    });
    await dispatcher.dispatchDue(morning);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('never dispatches a pre-activation pending intent in the automated cutoff scan', async () => {
    const old = await fixture(1);
    const current = await fixture(1);
    await evaluator.evaluateUser(old.userId, morning, 'IMMEDIATE_ITEM');
    await evaluator.evaluateUser(current.userId, morning, 'IMMEDIATE_ITEM');
    const oldIntent = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: old.userId },
    });
    const currentIntent = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: current.userId },
    });
    // Future fixture timestamps isolate this scan from shared local intents.
    const activation = new Date('2099-01-01T00:00:00.000Z');
    await prisma.notificationIntent.update({
      where: { id: oldIntent.id },
      data: { createdAt: new Date('2098-12-31T23:59:59.000Z') },
    });
    await prisma.notificationIntent.update({
      where: { id: currentIntent.id },
      data: { createdAt: activation },
    });
    await dispatcher.dispatchDue(morning, activation);
    expect(
      transport.send.mock.calls.filter(([subscription]) =>
        old.endpoints.includes(subscription.endpoint as string),
      ),
    ).toHaveLength(0);
    expect(
      transport.send.mock.calls.filter(([subscription]) =>
        current.endpoints.includes(subscription.endpoint as string),
      ),
    ).toHaveLength(1);
    expect(
      await prisma.notificationDelivery.count({
        where: { intentId: oldIntent.id },
      }),
    ).toBe(0);
  });

  it('does not deliver a pre-activation digest found as an overnight rollover replacement', async () => {
    const row = await fixture(1, { digest: true, quiet: true });
    await evaluator.evaluateUser(row.userId, quiet, 'DAILY_DIGEST');
    await evaluator.evaluateUser(row.userId, nextMorning, 'DAILY_DIGEST');
    const old = await prisma.notificationIntent.findFirstOrThrow({
      where: {
        userId: row.userId,
        kind: 'DAILY_DIGEST',
        localDay: '2026-10-14',
      },
    });
    const replacement = await prisma.notificationIntent.findFirstOrThrow({
      where: {
        userId: row.userId,
        kind: 'DAILY_DIGEST',
        localDay: '2026-10-15',
      },
    });
    const activation = new Date('2099-02-01T00:00:00.000Z');
    await prisma.notificationIntent.update({
      where: { id: old.id },
      data: { createdAt: activation },
    });
    await prisma.notificationIntent.update({
      where: { id: replacement.id },
      data: { createdAt: new Date('2099-01-31T23:59:59.000Z') },
    });
    await dispatcher.dispatchDue(nextMorning, activation);
    expect(
      transport.send.mock.calls.filter(([subscription]) =>
        row.endpoints.includes(subscription.endpoint as string),
      ),
    ).toHaveLength(0);
    expect(
      await prisma.notificationDelivery.count({
        where: { intentId: { in: [old.id, replacement.id] } },
      }),
    ).toBe(0);
  });

  it('rolls an overnight digest to today and uses current stock and membership', async () => {
    const row = await fixture(1, { digest: true, quiet: true });
    await evaluator.evaluateUser(row.userId, quiet);
    const old = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: row.userId, kind: 'DAILY_DIGEST' },
    });
    await prisma.membership.delete({
      where: {
        userId_householdId: {
          userId: row.userId,
          householdId: row.householdId,
        },
      },
    });
    await dispatcher.dispatchDue(nextMorning);
    expect(
      transport.send.mock.calls.filter(([subscription]) =>
        row.endpoints.includes(subscription.endpoint as string),
      ),
    ).toHaveLength(0);
    expect(
      await prisma.notificationDelivery.count({ where: { intentId: old.id } }),
    ).toBe(0);
    expect(
      await prisma.notificationIntent.count({
        where: {
          userId: row.userId,
          kind: 'DAILY_DIGEST',
          localDay: '2026-10-15',
        },
      }),
    ).toBe(0);
    await prisma.membership.create({
      data: {
        userId: row.userId,
        householdId: row.householdId,
        role: 'MEMBER',
      },
    });
    await Promise.all([
      dispatcher.dispatchDue(nextMorning),
      dispatcher.dispatchDue(nextMorning),
    ]);
    const today = await prisma.notificationIntent.findFirstOrThrow({
      where: {
        userId: row.userId,
        kind: 'DAILY_DIGEST',
        localDay: '2026-10-15',
      },
    });
    expect(
      await prisma.notificationDelivery.count({ where: { intentId: old.id } }),
    ).toBe(0);
    expect(
      await prisma.notificationDelivery.count({
        where: { intentId: today.id, status: 'ACCEPTED' },
      }),
    ).toBe(1);
    expect(
      await prisma.notificationIntent.count({
        where: {
          userId: row.userId,
          kind: 'DAILY_DIGEST',
          localDay: '2026-10-15',
        },
      }),
    ).toBe(1);
  });
});
