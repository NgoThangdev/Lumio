import { StockCheckService } from './stock-check.service.js';

describe('Stock check confirmation', () => {
  function fixture() {
    const update = vi.fn();
    const tx = {
      membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'user' }) },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'trip', status: 'DRAFT', suggestionsImportedAt: null },
        ])
        .mockResolvedValueOnce([{ id: 'item' }]),
      shoppingEntry: { count: vi.fn().mockResolvedValue(0) },
      tripStockCheck: {
        findUnique: vi.fn().mockResolvedValue({
          decision: 'CONFIRM',
          revision: 1,
          userId: 'user',
        }),
        update,
      },
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue({ stockRevision: 1 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new StockCheckService(prisma as never);
    const view = vi
      .spyOn(
        service as unknown as {
          view: (...args: unknown[]) => Promise<unknown>;
        },
        'view',
      )
      .mockResolvedValue({ tripId: 'trip', items: [] });
    return { service, update, view };
  }

  it('returns a repeated current CONFIRM without writing history', async () => {
    const { service, update, view } = fixture();
    await expect(
      service.save('user', 'household', 'trip', 'item', {
        decision: 'CONFIRM',
        expectedRevision: 1,
      }),
    ).resolves.toEqual({ tripId: 'trip', items: [], changed: false });
    expect(update).not.toHaveBeenCalled();
    expect(view).toHaveBeenCalledOnce();
  });

  it('rejects a stale revision before considering a repeated CONFIRM', async () => {
    const { service, update } = fixture();
    await expect(
      service.save('user', 'household', 'trip', 'item', {
        decision: 'CONFIRM',
        expectedRevision: 0,
      }),
    ).rejects.toThrow('STOCK_CHANGED');
    expect(update).not.toHaveBeenCalled();
  });
});
