import { HouseholdsService } from './households.service.js';

function setup() {
  const settings = new Map([
    [
      'home',
      { defaultShoppingCycleDays: 7, defaultStore: null as string | null },
    ],
    [
      'other',
      { defaultShoppingCycleDays: 7, defaultStore: null as string | null },
    ],
  ]);
  const roles = new Map([
    ['admin:home', 'ADMIN'],
    ['admin:other', 'MEMBER'],
    ['member:home', 'MEMBER'],
    ['other-admin:other', 'ADMIN'],
  ]);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'home' }]),
    membership: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            userId_householdId: { userId: string; householdId: string };
          };
        }) => {
          const role = roles.get(
            `${where.userId_householdId.userId}:${where.userId_householdId.householdId}`,
          );
          return role
            ? { role, userId: where.userId_householdId.userId }
            : null;
        },
      ),
    },
    household: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
        settings.get(where.id),
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const next = { ...settings.get(where.id)!, ...data } as {
            defaultShoppingCycleDays: number;
            defaultStore: string | null;
          };
          settings.set(where.id, next);
          return next;
        },
      ),
    },
    shoppingTrip: { updateMany: vi.fn() },
  };
  const prisma = { $transaction: (run: (db: typeof tx) => unknown) => run(tx) };
  return { service: new HouseholdsService(prisma as never), tx, settings };
}

describe('household shopping settings', () => {
  it('allows member read and household Admin update without changing trips', async () => {
    const { service, tx } = setup();
    expect(await service.shoppingSettings('member', 'home')).toEqual({
      defaultShoppingCycleDays: 7,
      defaultStore: null,
    });
    expect(
      await service.updateShoppingSettings('admin', 'home', {
        defaultShoppingCycleDays: 14,
        defaultStore: '  Market  ',
      }),
    ).toEqual({ defaultShoppingCycleDays: 14, defaultStore: 'Market' });
    expect(await service.shoppingSettings('member', 'home')).toEqual({
      defaultShoppingCycleDays: 14,
      defaultStore: 'Market',
    });
    expect(await service.shoppingSettings('other-admin', 'other')).toEqual({
      defaultShoppingCycleDays: 7,
      defaultStore: null,
    });
    expect(
      await service.updateShoppingSettings('admin', 'home', {
        defaultStore: null,
      }),
    ).toEqual({ defaultShoppingCycleDays: 14, defaultStore: null });
    expect(tx.shoppingTrip.updateMany).not.toHaveBeenCalled();
  });

  it('enforces Admin permissions per household', async () => {
    const { service, tx } = setup();
    await expect(
      service.shoppingSettings('outsider', 'home'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.updateShoppingSettings('member', 'home', {
        defaultShoppingCycleDays: 8,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.updateShoppingSettings('admin', 'other', {
        defaultShoppingCycleDays: 8,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.household.update).not.toHaveBeenCalled();
  });

  it('validates the 30-day cycle and optional store', async () => {
    const { service, tx } = setup();
    for (const body of [
      {},
      { unknown: true },
      { defaultShoppingCycleDays: 0 },
      { defaultShoppingCycleDays: 31 },
      { defaultShoppingCycleDays: 1.5 },
      { defaultShoppingCycleDays: '7' },
      { defaultStore: '' },
      { defaultStore: 'x'.repeat(121) },
    ])
      await expect(
        service.updateShoppingSettings('admin', 'home', body),
      ).rejects.toMatchObject({ status: 400 });
    expect(tx.household.update).not.toHaveBeenCalled();
  });
});
