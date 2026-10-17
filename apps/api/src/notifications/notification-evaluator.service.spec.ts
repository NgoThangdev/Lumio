import { NotificationEvaluatorService } from './notification-evaluator.service.js';

const at = new Date('2026-10-14T02:00:00.000Z');
const preference = {
  lowStockAlertsEnabled: true,
  expiryAlertsEnabled: false,
  dailyDigestEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
};
const out = {
  itemId: 'item',
  neverRunOut: true,
  lowStockRisk: 'OUT',
  useTodayQuantity: '0',
  expiryRisk: 'NONE',
};

function setup() {
  const prisma = {
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(preference),
      findMany: vi.fn().mockResolvedValue([{ userId: 'user' }]),
    },
    membership: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { householdId: 'house', household: { name: 'Home' } },
        ]),
    },
    notificationIntent: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({
        id: 'intent',
        userId: 'user',
        kind: 'IMMEDIATE_ITEM',
        localDay: '2026-10-14',
        subjectKey: 'house:item',
        content: { signal: 'OUT', householdId: 'house', itemId: 'item' },
        dueAt: new Date('2026-10-14T01:00:00.000Z'),
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'today' }),
    },
  };
  const intelligence = {
    assessHousehold: vi.fn().mockResolvedValue({ assessments: [out] }),
  };
  const service = new NotificationEvaluatorService(
    prisma as never,
    intelligence as never,
  );
  return { service, prisma, intelligence };
}

describe('Notification evaluator revalidation', () => {
  it('keeps urgent and digest evaluation separate for scheduled runs', async () => {
    const { service, prisma } = setup();
    prisma.notificationPreference.findUnique.mockResolvedValue({
      ...preference,
      dailyDigestEnabled: true,
    });
    await service.evaluateEligibleUsers(at, 'IMMEDIATE_ITEM');
    expect(prisma.notificationIntent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ kind: 'IMMEDIATE_ITEM' })],
      skipDuplicates: true,
    });
    prisma.notificationIntent.createMany.mockClear();
    await service.evaluateEligibleUsers(at, 'DAILY_DIGEST');
    expect(prisma.notificationIntent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ kind: 'DAILY_DIGEST' })],
      skipDuplicates: true,
    });
  });

  it('creates a candidate through stock intelligence and rejects it after stock or membership changes', async () => {
    const { service, prisma, intelligence } = setup();
    expect(await service.evaluateUser('user', at)).toEqual({ created: 1 });
    expect(intelligence.assessHousehold).toHaveBeenCalledWith(
      'user',
      'house',
      undefined,
      at,
    );
    expect(prisma.notificationIntent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          kind: 'IMMEDIATE_ITEM',
          subjectKey: 'house:item',
          status: 'PENDING',
          localDay: '2026-10-14',
        }),
      ],
      skipDuplicates: true,
    });
    expect(await service.revalidateIntent('intent', at)).toMatchObject({
      ready: true,
      content: { signal: 'OUT', itemId: 'item' },
    });
    intelligence.assessHousehold.mockResolvedValue({
      assessments: [{ ...out, lowStockRisk: 'OK' }],
    });
    expect(await service.revalidateIntent('intent', at)).toEqual({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    intelligence.assessHousehold.mockResolvedValue({ assessments: [out] });
    prisma.membership.findMany.mockResolvedValue([]);
    expect(await service.revalidateIntent('intent', at)).toEqual({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    prisma.membership.findMany.mockResolvedValue([
      { householdId: 'house', household: { name: 'Home' } },
    ]);
    prisma.notificationPreference.findUnique.mockResolvedValue({
      ...preference,
      lowStockAlertsEnabled: false,
    });
    expect(await service.revalidateIntent('intent', at)).toEqual({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
  });

  it('defers in quiet hours and rechecks quiet hours before release', async () => {
    const { service, prisma } = setup();
    prisma.notificationPreference.findUnique.mockResolvedValue({
      ...preference,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });
    const quietAt = new Date('2026-10-14T16:00:00.000Z');
    await service.evaluateUser('user', quietAt);
    expect(prisma.notificationIntent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          status: 'DEFERRED',
          dueAt: new Date('2026-10-15T00:00:00.000Z'),
        }),
      ],
      skipDuplicates: true,
    });
    expect(await service.revalidateIntent('intent', quietAt)).toEqual({
      ready: false,
      reason: 'QUIET_HOURS',
    });
  });

  it('rolls an overnight digest onto the current-day key without releasing the old intent', async () => {
    const { service, prisma } = setup();
    prisma.notificationPreference.findUnique.mockResolvedValue({
      ...preference,
      dailyDigestEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });
    prisma.notificationIntent.findUnique.mockResolvedValue({
      id: 'old',
      userId: 'user',
      kind: 'DAILY_DIGEST',
      status: 'DEFERRED',
      localDay: '2026-10-14',
      subjectKey: 'all',
      dueAt: new Date('2026-10-15T00:00:00.000Z'),
      content: { households: [{ householdId: 'stale-house', items: [] }] },
    });
    const due = new Date('2026-10-15T00:00:00.000Z');
    expect(await service.revalidateIntent('old', due)).toEqual({
      ready: false,
      reason: 'ROLLED_OVER',
      replacementIntentId: 'today',
    });
    expect(prisma.notificationIntent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          kind: 'DAILY_DIGEST',
          localDay: '2026-10-15',
          subjectKey: 'all',
          status: 'PENDING',
          content: {
            households: [
              {
                householdId: 'house',
                items: [{ itemId: 'item', signals: ['LOW_STOCK'] }],
              },
            ],
          },
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('does not release a previous-day Use Today immediate alert', async () => {
    const { service, prisma, intelligence } = setup();
    prisma.notificationIntent.findUnique.mockResolvedValue({
      id: 'old-expiry',
      userId: 'user',
      kind: 'IMMEDIATE_ITEM',
      localDay: '2026-10-14',
      subjectKey: 'house:item',
      dueAt: new Date('2026-10-15T00:00:00.000Z'),
      content: { signal: 'USE_TODAY', householdId: 'house', itemId: 'item' },
    });
    expect(
      await service.revalidateIntent(
        'old-expiry',
        new Date('2026-10-15T00:00:00.000Z'),
      ),
    ).toEqual({ ready: false, reason: 'STALE_DAY' });
    expect(intelligence.assessHousehold).not.toHaveBeenCalled();
  });

  it('returns current attention independent of push opt-in and stored intents', async () => {
    const { service, prisma, intelligence } = setup();
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    intelligence.assessHousehold.mockResolvedValue({
      assessments: [
        {
          ...out,
          name: 'Milk',
          trackingMode: 'QUANTITY',
        },
      ],
    });
    expect(await service.attention('user', at)).toEqual({
      asOf: at.toISOString(),
      households: [
        {
          householdId: 'house',
          name: 'Home',
          items: [
            {
              itemId: 'item',
              name: 'Milk',
              trackingMode: 'QUANTITY',
              signals: ['LOW_STOCK'],
              lowStockRisk: 'OUT',
              expiryRisk: 'NONE',
            },
          ],
        },
      ],
    });
    expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prisma.notificationIntent.findUnique).not.toHaveBeenCalled();
  });
});
