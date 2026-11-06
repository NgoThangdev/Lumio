import { HouseholdsService } from './households.service.js';

describe('household inventory defaults', () => {
  it('allows Admin to change defaults without rewriting existing items', async () => {
    const current = {
      deletionRequestId: null,
      defaultTrackingMode: null,
      defaultPrimaryUnit: null,
      defaultLowStockThreshold: null,
      defaultBuyThreshold: null,
      defaultTargetStock: null,
      defaultSafetyBuffer: { toString: () => '1.2' },
      defaultExpiryReminderDays: 3,
    };
    const itemUpdate = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'home' }]),
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'ADMIN' }) },
      household: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(current),
        update: vi
          .fn()
          .mockImplementation(async ({ data }) => ({ ...current, ...data })),
      },
      category: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryItem: { updateMany: itemUpdate },
    };
    const prisma = {
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
    };
    const service = new HouseholdsService(prisma as never, {} as never);
    const result = await service.updateInventoryDefaults('admin', 'home', {
      defaultTrackingMode: 'QUANTITY',
      defaultPrimaryUnit: 'box',
      defaultBuyThreshold: '2',
      defaultLowStockThreshold: '4',
      defaultTargetStock: '8',
    });
    expect(result.defaultBuyThreshold.toString()).toBe('2');
    expect(tx.household.update).toHaveBeenCalledOnce();
    expect(itemUpdate).not.toHaveBeenCalled();
  });

  it('blocks a member from changing defaults', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'home' }]),
      membership: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
    };
    const prisma = {
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
    };
    await expect(
      new HouseholdsService(
        prisma as never,
        {} as never,
      ).updateInventoryDefaults('member', 'home', {
        defaultExpiryReminderDays: 5,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
