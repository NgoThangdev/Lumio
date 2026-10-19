import { StockIntelligenceService } from './stock-intelligence.service.js';

function setup() {
  const trips = [
    {
      householdId: 'home',
      status: 'DRAFT',
      plannedDate: new Date('2026-10-16T00:00:00.000Z'),
    },
    {
      householdId: 'home',
      status: 'RESTOCKED',
      plannedDate: new Date('2026-10-19T00:00:00.000Z'),
    },
    {
      householdId: 'other',
      status: 'DRAFT',
      plannedDate: new Date('2026-10-18T00:00:00.000Z'),
    },
    {
      householdId: 'home',
      status: 'SHOPPING',
      plannedDate: new Date('2026-10-22T00:00:00.000Z'),
    },
    {
      householdId: 'home',
      status: 'DRAFT',
      plannedDate: new Date('2026-10-20T00:00:00.000Z'),
    },
  ];
  const prisma = {
    membership: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            userId_householdId: { userId: string; householdId: string };
          };
        }) =>
          where.userId_householdId.userId === 'member'
            ? { userId: 'member' }
            : null,
      ),
    },
    shoppingTrip: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { householdId: string; plannedDate: { gte: Date } };
        }) =>
          trips
            .filter(
              (trip) =>
                trip.householdId === where.householdId &&
                trip.status !== 'RESTOCKED' &&
                trip.plannedDate >= where.plannedDate.gte,
            )
            .sort(
              (a, b) => a.plannedDate.getTime() - b.plannedDate.getTime(),
            )[0] ?? null,
      ),
    },
    household: {
      findUniqueOrThrow: vi.fn(
        async ({ where }: { where: { id: string } }) => ({
          defaultShoppingCycleDays: where.id === 'home' ? 14 : 3,
        }),
      ),
    },
    inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    service: new StockIntelligenceService(prisma as never),
    prisma,
    trips,
  };
}

describe('stock-intelligence shopping date resolution', () => {
  const at = new Date('2026-10-17T12:00:00.000Z');

  it('honors an explicit date before trips or cycle and keeps the 30-day bound', async () => {
    const { service, prisma } = setup();
    expect(
      (await service.assessHousehold('member', 'home', '2026-10-24', at))
        .shoppingDate,
    ).toBe('2026-10-24');
    expect(prisma.shoppingTrip.findFirst).not.toHaveBeenCalled();
    expect(prisma.household.findUniqueOrThrow).not.toHaveBeenCalled();
    await expect(
      service.assessHousehold('member', 'home', '2026-11-17', at),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('uses the earliest upcoming non-restocked trip in the same household', async () => {
    const { service, prisma } = setup();
    expect(
      (await service.assessHousehold('member', 'home', undefined, at))
        .shoppingDate,
    ).toBe('2026-10-20');
    expect(prisma.shoppingTrip.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId: 'home',
          status: { not: 'RESTOCKED' },
          plannedDate: { gte: new Date('2026-10-17T00:00:00.000Z') },
        },
        orderBy: [{ plannedDate: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(prisma.household.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('falls back to each household cycle in Ho Chi Minh local dates', async () => {
    const { service, trips } = setup();
    trips.length = 0;
    expect(
      (await service.assessHousehold('member', 'home', undefined, at))
        .shoppingDate,
    ).toBe('2026-10-31');
    expect(
      (await service.assessHousehold('member', 'other', undefined, at))
        .shoppingDate,
    ).toBe('2026-10-20');
    expect(
      (
        await service.assessHousehold(
          'member',
          'other',
          undefined,
          new Date('2026-10-17T17:01:00.000Z'),
        )
      ).shoppingDate,
    ).toBe('2026-10-21');
  });

  it('denies users without membership before reading trips or settings', async () => {
    const { service, prisma } = setup();
    await expect(
      service.assessHousehold('outsider', 'home', undefined, at),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.shoppingTrip.findFirst).not.toHaveBeenCalled();
    expect(prisma.household.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
