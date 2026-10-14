import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LocationStockCheckService } from './location-stock-check.service.js';

function service(tx: Record<string, unknown>) {
  const prisma = {
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  };
  return new LocationStockCheckService(prisma as unknown as PrismaService);
}

function quantityItem(
  name: string,
  stockRevision: number,
  batches: object[] = [],
) {
  return {
    id: name,
    name,
    householdId: 'house',
    trackingMode: 'QUANTITY',
    openedTrackingEnabled: false,
    stockRevision,
    preferredRestockLocationId: 'shelf',
    currentLocationId: null,
    backupLocationId: null,
    currentLevel: null,
    isPresent: null,
    backupCount: 0,
    batches,
    stateActions: [],
    locationStockChecks: [],
  };
}

describe('Location stock check service', () => {
  it('ranks uncertain location stock first without treating recent low stock as uncertainty', async () => {
    const recent = quantityItem('Recent low', 0, [
      {
        id: 'b1',
        quantity: new Prisma.Decimal(1),
        createdAt: new Date(),
        expiryDate: null,
        openedAt: null,
        openedUseByDate: null,
      },
    ]);
    const unknown = quantityItem('Unknown', 0);
    const tx = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'actor' }),
      },
      location: {
        findFirst: vi.fn().mockResolvedValue({ id: 'shelf', name: 'Shelf' }),
      },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([recent, unknown]) },
    };
    const result = await service(tx).list('actor', 'house', 'shelf');
    expect(result.items.map((item) => item.itemId)).toEqual([
      'Unknown',
      'Recent low',
    ]);
    expect(result.items[0]).toMatchObject({
      status: 'PENDING',
      reason: 'NO_STOCK_RECORD',
      stock: { quantity: '0' },
    });
    expect(result.items[1]).toMatchObject({
      reason: 'RECENT_RECORD',
      stock: { quantity: '1' },
    });
    expect(tx.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ householdId: 'house' }),
      }),
    );
  });

  it('returns the saved same-actor confirmation without another history write, but rejects a stale revision', async () => {
    const checkedAt = new Date();
    const item = {
      ...quantityItem('Milk', 2),
      locationStockChecks: [
        { decision: 'CONFIRM', revision: 2, userId: 'actor', checkedAt },
      ],
    };
    const tx = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'actor' }),
      },
      location: {
        findFirst: vi.fn().mockResolvedValue({ id: 'shelf', name: 'Shelf' }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'Milk' }]),
      inventoryItem: { findFirst: vi.fn().mockResolvedValue(item) },
      locationStockCheck: { upsert: vi.fn() },
    };
    const checks = service(tx);
    const repeated = await checks.save('actor', 'house', 'shelf', 'Milk', {
      decision: 'CONFIRM',
      expectedRevision: 2,
    });
    expect(repeated.changed).toBe(false);
    expect(repeated.item.checkedAt).toEqual(checkedAt);
    expect(tx.locationStockCheck.upsert).not.toHaveBeenCalled();
    await expect(
      checks.save('actor', 'house', 'shelf', 'Milk', {
        decision: 'CONFIRM',
        expectedRevision: 1,
      }),
    ).rejects.toThrow('STOCK_CHANGED');
  });
});
