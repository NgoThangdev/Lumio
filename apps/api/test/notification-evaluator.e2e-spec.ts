import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { NotificationEvaluatorService } from '../src/notifications/notification-evaluator.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const at = new Date('2026-10-14T02:00:00.000Z'); // 09:00 in Ho Chi Minh City
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('Notification evaluator (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let evaluator: NotificationEvaluatorService;
  let userIds: string[];
  let householdIds: string[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    evaluator = app.get(NotificationEvaluatorService);
  });
  beforeEach(() => {
    userIds = [];
    householdIds = [];
  });
  afterEach(async () => {
    await prisma.notificationIntent.deleteMany({
      where: { userId: { in: userIds } },
    });
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.membership.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  afterAll(async () => app.close());

  async function user() {
    const row = await prisma.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'fixture',
      },
    });
    userIds.push(row.id);
    return row.id;
  }
  async function household(...members: string[]) {
    const row = await prisma.household.create({
      data: { name: `Fixture ${randomUUID()}` },
    });
    householdIds.push(row.id);
    for (const userId of members)
      await prisma.membership.create({
        data: { userId, householdId: row.id, role: 'MEMBER' },
      });
    return row.id;
  }
  async function item(
    householdId: string,
    name: string,
    options: {
      neverRunOut?: boolean;
      lowStockThreshold?: string;
      expiry?: string;
      openedUseBy?: string;
      quantity?: string;
    } = {},
  ) {
    const row = await prisma.inventoryItem.create({
      data: {
        householdId,
        name,
        primaryUnit: 'box',
        neverRunOut: options.neverRunOut ?? false,
        lowStockThreshold: options.lowStockThreshold,
        openedTrackingEnabled: Boolean(options.openedUseBy),
      },
    });
    if (options.quantity)
      await prisma.stockBatch.create({
        data: {
          itemId: row.id,
          quantity: options.quantity,
          expiryDate: options.expiry ? day(options.expiry) : null,
          openedAt: options.openedUseBy ? at : null,
          openedUseByDate: options.openedUseBy
            ? day(options.openedUseBy)
            : null,
        },
      });
    return row.id;
  }

  it('deduplicates concurrent evaluations and groups one digest across active households', async () => {
    const recipient = await user();
    const optedOut = await user();
    const first = await household(recipient, optedOut);
    const second = await household(recipient);
    const essential = await item(first, 'Essential', { neverRunOut: true });
    const soon = await item(first, 'Soon', {
      quantity: '1',
      expiry: '2026-10-16',
    });
    const opened = await item(second, 'Opened today', {
      quantity: '1',
      expiry: '2026-10-30',
      openedUseBy: '2026-10-14',
    });
    const low = await item(second, 'Low', {
      quantity: '2',
      lowStockThreshold: '3',
    });
    await prisma.inventoryAction.create({
      data: {
        householdId: second,
        itemId: low,
        userId: recipient,
        type: 'USE',
        quantity: '1',
      },
    });
    await prisma.notificationPreference.create({
      data: {
        userId: recipient,
        lowStockAlertsEnabled: true,
        expiryAlertsEnabled: true,
        dailyDigestEnabled: true,
      },
    });
    await Promise.all(
      Array.from({ length: 6 }, () => evaluator.evaluateUser(recipient, at)),
    );
    expect(await evaluator.evaluateUser(optedOut, at)).toEqual({ created: 0 });
    const intents = await prisma.notificationIntent.findMany({
      where: { userId: recipient },
      orderBy: [{ kind: 'asc' }, { subjectKey: 'asc' }],
    });
    expect(intents).toHaveLength(3);
    expect(
      intents
        .filter((intent) => intent.kind === 'IMMEDIATE_ITEM')
        .map((intent) => intent.itemId)
        .sort((left, right) => (left ?? '').localeCompare(right ?? '')),
    ).toEqual(
      [essential, opened].sort((left, right) => left.localeCompare(right)),
    );
    expect(intents.every((intent) => intent.localDay === '2026-10-14')).toBe(
      true,
    );
    const digest = intents.find((intent) => intent.kind === 'DAILY_DIGEST')!;
    expect(digest.subjectKey).toBe('all');
    expect(digest.content).toMatchObject({
      households: expect.arrayContaining([
        {
          householdId: first,
          items: expect.arrayContaining([
            { itemId: essential, signals: ['LOW_STOCK'] },
            { itemId: soon, signals: ['USE_SOON'] },
          ]),
        },
        {
          householdId: second,
          items: expect.arrayContaining([
            { itemId: low, signals: ['LOW_STOCK'] },
            { itemId: opened, signals: ['USE_SOON'] },
          ]),
        },
      ]),
    });
    expect(
      await prisma.notificationIntent.count({ where: { userId: optedOut } }),
    ).toBe(0);
    const nextDay = new Date('2026-10-15T02:00:00.000Z');
    await evaluator.evaluateUser(recipient, nextDay);
    expect(
      await prisma.notificationIntent.count({
        where: {
          userId: recipient,
          kind: 'DAILY_DIGEST',
        },
      }),
    ).toBe(2);
    expect(await evaluator.revalidateIntent(digest.id, nextDay)).toMatchObject({
      ready: false,
      reason: 'STALE_DAY',
    });
  });

  it('defers in quiet hours and rechecks stock, membership, and preference before delivery', async () => {
    const recipient = await user();
    const home = await household(recipient);
    const essential = await item(home, 'Essential', { neverRunOut: true });
    await prisma.notificationPreference.create({
      data: {
        userId: recipient,
        lowStockAlertsEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    });
    const quietAt = new Date('2026-10-14T16:00:00.000Z'); // 23:00 local
    await evaluator.evaluateUser(recipient, quietAt);
    const intent = await prisma.notificationIntent.findFirstOrThrow({
      where: { userId: recipient },
    });
    expect(intent).toMatchObject({
      kind: 'IMMEDIATE_ITEM',
      status: 'DEFERRED',
      localDay: '2026-10-14',
      dueAt: new Date('2026-10-15T00:00:00.000Z'),
    });
    expect(await evaluator.revalidateIntent(intent.id, quietAt)).toMatchObject({
      ready: false,
      reason: 'NOT_DUE',
    });
    const due = new Date('2026-10-15T00:01:00.000Z');
    expect(await evaluator.revalidateIntent(intent.id, due)).toMatchObject({
      ready: true,
      content: { itemId: essential, signal: 'OUT' },
    });
    const batch = await prisma.stockBatch.create({
      data: { itemId: essential, quantity: '1' },
    });
    expect(await evaluator.revalidateIntent(intent.id, due)).toMatchObject({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    await prisma.stockBatch.delete({ where: { id: batch.id } });
    await prisma.membership.delete({
      where: {
        userId_householdId: {
          userId: recipient,
          householdId: home,
        },
      },
    });
    expect(await evaluator.revalidateIntent(intent.id, due)).toMatchObject({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    await prisma.membership.create({
      data: { userId: recipient, householdId: home, role: 'MEMBER' },
    });
    await prisma.notificationPreference.update({
      where: { userId: recipient },
      data: { lowStockAlertsEnabled: false },
    });
    expect(await evaluator.revalidateIntent(intent.id, due)).toMatchObject({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
  });

  it('rolls 23:00 digest onto one fresh 07:00 intent across concurrent evaluation', async () => {
    const recipient = await user();
    const first = await household(recipient);
    const second = await household(recipient);
    const oldOut = await item(first, 'Old out', { neverRunOut: true });
    const removed = await item(second, 'Removed household low', {
      quantity: '1',
      lowStockThreshold: '2',
    });
    await prisma.notificationPreference.create({
      data: {
        userId: recipient,
        lowStockAlertsEnabled: true,
        dailyDigestEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    });
    const quietAt = new Date('2026-10-14T16:00:00.000Z');
    await evaluator.evaluateUser(recipient, quietAt);
    const old = await prisma.notificationIntent.findFirstOrThrow({
      where: {
        userId: recipient,
        kind: 'DAILY_DIGEST',
        localDay: '2026-10-14',
      },
    });
    expect(old).toMatchObject({
      status: 'DEFERRED',
      dueAt: new Date('2026-10-15T00:00:00.000Z'),
    });
    expect(old.content).toEqual({
      households: expect.arrayContaining([
        {
          householdId: first,
          items: expect.arrayContaining([
            expect.objectContaining({ itemId: oldOut }),
          ]),
        },
        {
          householdId: second,
          items: expect.arrayContaining([
            expect.objectContaining({ itemId: removed }),
          ]),
        },
      ]),
    });

    await prisma.stockBatch.create({ data: { itemId: oldOut, quantity: '1' } });
    await prisma.membership.delete({
      where: {
        userId_householdId: {
          userId: recipient,
          householdId: second,
        },
      },
    });
    const freshLow = await item(first, 'Fresh low', {
      quantity: '1',
      lowStockThreshold: '2',
    });
    const due = new Date('2026-10-15T00:00:00.000Z');
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () =>
        evaluator.revalidateIntent(old.id, due),
      ),
      ...Array.from({ length: 4 }, () =>
        evaluator.evaluateUser(recipient, due),
      ),
    ]);
    const rollovers = results.filter((result) => 'reason' in result);
    expect(rollovers).toHaveLength(4);
    expect(rollovers.every((result) => result.reason === 'ROLLED_OVER')).toBe(
      true,
    );
    const today = await prisma.notificationIntent.findMany({
      where: {
        userId: recipient,
        kind: 'DAILY_DIGEST',
        localDay: '2026-10-15',
      },
    });
    expect(today).toHaveLength(1);
    expect(
      rollovers.every(
        (result) =>
          'replacementIntentId' in result &&
          result.replacementIntentId === today[0].id,
      ),
    ).toBe(true);
    expect(today[0].content).toEqual({
      households: [
        {
          householdId: first,
          items: [{ itemId: freshLow, signals: ['LOW_STOCK'] }],
        },
      ],
    });
    expect(await evaluator.revalidateIntent(today[0].id, due)).toMatchObject({
      ready: true,
      content: today[0].content,
    });
    expect(
      await prisma.notificationIntent.count({
        where: {
          userId: recipient,
          kind: 'DAILY_DIGEST',
          localDay: '2026-10-15',
        },
      }),
    ).toBe(1);
  });

  it('makes no current-day digest when stock recovers or membership is removed overnight', async () => {
    const recipient = await user();
    const home = await household(recipient);
    const essential = await item(home, 'Essential', { neverRunOut: true });
    await prisma.notificationPreference.create({
      data: {
        userId: recipient,
        lowStockAlertsEnabled: true,
        dailyDigestEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    });
    await evaluator.evaluateUser(
      recipient,
      new Date('2026-10-14T16:00:00.000Z'),
    );
    const old = await prisma.notificationIntent.findFirstOrThrow({
      where: {
        userId: recipient,
        kind: 'DAILY_DIGEST',
      },
    });
    const due = new Date('2026-10-15T00:01:00.000Z');
    const batch = await prisma.stockBatch.create({
      data: { itemId: essential, quantity: '1' },
    });
    expect(await evaluator.revalidateIntent(old.id, due)).toMatchObject({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    await prisma.stockBatch.delete({ where: { id: batch.id } });
    await prisma.membership.delete({
      where: {
        userId_householdId: {
          userId: recipient,
          householdId: home,
        },
      },
    });
    expect(await evaluator.revalidateIntent(old.id, due)).toMatchObject({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    expect(
      await prisma.notificationIntent.count({
        where: {
          userId: recipient,
          kind: 'DAILY_DIGEST',
          localDay: '2026-10-15',
        },
      }),
    ).toBe(0);
  });

  it('does not revive yesterday’s expiring immediate alert at quiet-hours end', async () => {
    const recipient = await user();
    const home = await household(recipient);
    const expiring = await item(home, 'Expires today', {
      quantity: '1',
      expiry: '2026-10-14',
    });
    await prisma.notificationPreference.create({
      data: {
        userId: recipient,
        expiryAlertsEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      },
    });
    await evaluator.evaluateUser(
      recipient,
      new Date('2026-10-14T16:00:00.000Z'),
    );
    const old = await prisma.notificationIntent.findFirstOrThrow({
      where: {
        userId: recipient,
        kind: 'IMMEDIATE_ITEM',
        itemId: expiring,
      },
    });
    expect(
      await evaluator.revalidateIntent(
        old.id,
        new Date('2026-10-15T00:00:00.000Z'),
      ),
    ).toEqual({ ready: false, reason: 'STALE_DAY' });
    expect(
      await prisma.notificationIntent.count({
        where: {
          userId: recipient,
          kind: 'IMMEDIATE_ITEM',
        },
      }),
    ).toBe(1);
  });
});
