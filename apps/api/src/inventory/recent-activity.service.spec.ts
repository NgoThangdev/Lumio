import { Prisma } from '../generated/prisma/client.js';
import { RecentActivityService } from './recent-activity.service.js';

const item = { id: 'item', name: 'Milk', primaryUnit: 'box' };
const at = (minute: number) =>
  new Date(`2026-10-14T10:${String(minute).padStart(2, '0')}:00.000Z`);

function database() {
  return {
    membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'viewer' }) },
    inventoryAction: { findMany: vi.fn().mockResolvedValue([]) },
    inventoryStateAction: { findMany: vi.fn().mockResolvedValue([]) },
    inventoryUndo: { findMany: vi.fn().mockResolvedValue([]) },
    shoppingTrip: { findMany: vi.fn().mockResolvedValue([]) },
    tripStockCheck: { findMany: vi.fn().mockResolvedValue([]) },
    locationStockCheck: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe('Recent household activity', () => {
  it('orders events, attributes actions, and marks undone consumption with its reversal', async () => {
    const prisma = database();
    prisma.inventoryAction.findMany.mockResolvedValue([
      {
        id: 'use',
        type: 'USE',
        createdAt: at(1),
        userId: 'member-a',
        item,
        quantity: new Prisma.Decimal(2),
        undo: { createdAt: at(4) },
      },
    ]);
    prisma.inventoryStateAction.findMany.mockResolvedValue([
      {
        id: 'level',
        type: 'UPDATE_LEVEL',
        createdAt: at(2),
        userId: 'member-b',
        item,
        beforeLevel: 'FULL',
        afterLevel: 'HALF',
        beforePresent: null,
        afterPresent: null,
        beforeBackupCount: 1,
        afterBackupCount: 1,
        undo: null,
      },
    ]);
    prisma.inventoryUndo.findMany.mockResolvedValue([
      {
        id: 'reversal',
        createdAt: at(4),
        userId: 'member-a',
        item,
        inventoryAction: {
          id: 'use',
          type: 'USE',
          quantity: new Prisma.Decimal(2),
        },
        stateAction: null,
      },
    ]);
    prisma.shoppingTrip.findMany.mockResolvedValue([
      {
        id: 'trip',
        store: 'Market',
        completedAt: at(3),
        completedByUserId: 'member-b',
      },
    ]);
    prisma.tripStockCheck.findMany.mockResolvedValue([
      {
        itemId: item.id,
        item,
        trip: { id: 'trip', store: 'Market' },
        history: [
          {
            decision: 'CORRECT',
            userId: 'member-b',
            checkedAt: at(5).toISOString(),
            before: { quantity: '4' },
            after: { quantity: 3 },
          },
          {
            decision: 'CONFIRM',
            userId: 'member-b',
            checkedAt: at(6).toISOString(),
          },
          { decision: 'CORRECT', checkedAt: at(7).toISOString() },
        ],
      },
    ]);
    prisma.locationStockCheck.findMany.mockResolvedValue([
      {
        itemId: item.id,
        item,
        location: { id: 'shelf', name: 'Shelf' },
        history: [
          {
            decision: 'CORRECT',
            userId: 'member-a',
            checkedAt: at(5).toISOString(),
            before: { backupCount: 2 },
            after: { backupCount: 1 },
          },
        ],
      },
    ]);

    const result = await new RecentActivityService(prisma as never).list(
      'viewer',
      'household',
    );
    expect(result.items.map((event) => event.id)).toEqual([
      'trip-check:trip:item:0',
      'location-check:shelf:item:0',
      'undo:reversal',
      'trip:trip',
      'state:level',
      'inventory:use',
    ]);
    expect(
      result.items.find((event) => event.id === 'inventory:use'),
    ).toMatchObject({
      actorId: 'member-a',
      quantity: '2',
      isUndone: true,
      undoneAt: at(4),
    });
    expect(
      result.items.find((event) => event.id === 'undo:reversal'),
    ).toMatchObject({
      type: 'UNDO',
      actorId: 'member-a',
      quantity: '2',
      reversesEventId: 'inventory:use',
      reversesType: 'USE',
    });
    expect(
      result.items.find((event) => event.id === 'trip:trip'),
    ).toMatchObject({
      type: 'SHOPPING_TRIP_COMPLETED',
      actorId: 'member-b',
      trip: { id: 'trip', store: 'Market' },
    });
    expect(
      result.items.find((event) => event.id === 'trip-check:trip:item:0'),
    ).toMatchObject({
      actorId: 'member-b',
      change: { before: { quantity: '4' }, after: { quantity: '3' } },
    });
    expect(prisma.inventoryAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: 'household' },
        take: 20,
      }),
    );
  });

  it('shows an undone state action and its inverse state change', async () => {
    const prisma = database();
    prisma.inventoryStateAction.findMany.mockResolvedValue([
      {
        id: 'level',
        type: 'UPDATE_LEVEL',
        createdAt: at(1),
        userId: 'member',
        item,
        beforeLevel: 'FULL',
        afterLevel: 'HALF',
        beforePresent: null,
        afterPresent: null,
        beforeBackupCount: 1,
        afterBackupCount: 1,
        undo: { createdAt: at(2) },
      },
    ]);
    prisma.inventoryUndo.findMany.mockResolvedValue([
      {
        id: 'undo-level',
        createdAt: at(2),
        userId: 'member',
        item,
        inventoryAction: null,
        stateAction: {
          id: 'level',
          type: 'UPDATE_LEVEL',
          beforeLevel: 'FULL',
          afterLevel: 'HALF',
          beforePresent: null,
          afterPresent: null,
          beforeBackupCount: 1,
          afterBackupCount: 1,
        },
      },
    ]);
    const result = await new RecentActivityService(prisma as never).list(
      'viewer',
      'household',
    );
    expect(result.items[0]).toMatchObject({
      type: 'UNDO',
      reversesEventId: 'state:level',
      reversesType: 'UPDATE_LEVEL',
      change: {
        before: { currentLevel: 'HALF' },
        after: { currentLevel: 'FULL' },
      },
    });
    expect(result.items[1]).toMatchObject({
      type: 'UPDATE_LEVEL',
      isUndone: true,
      undoneAt: at(2),
    });
  });

  it('preserves null finisher attribution for a legacy completed trip', async () => {
    const prisma = database();
    prisma.shoppingTrip.findMany.mockResolvedValue([
      {
        id: 'legacy-trip',
        store: 'Market',
        completedAt: at(3),
        completedByUserId: null,
      },
    ]);
    const result = await new RecentActivityService(prisma as never).list(
      'viewer',
      'household',
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'trip:legacy-trip',
        type: 'SHOPPING_TRIP_COMPLETED',
        actorId: null,
      }),
    ]);
    expect(prisma.shoppingTrip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ householdId: 'household' }),
      }),
    );
  });

  it('rejects a non-member before reading events and limits the merged response', async () => {
    const prisma = database();
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    const service = new RecentActivityService(prisma as never);
    await expect(service.list('outsider', 'household')).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.inventoryAction.findMany).not.toHaveBeenCalled();

    prisma.inventoryAction.findMany.mockResolvedValue(
      Array.from({ length: 22 }, (_, index) => ({
        id: String(index).padStart(2, '0'),
        type: 'RESTOCK',
        createdAt: new Date(1_000_000 + index),
        userId: 'viewer',
        item,
        quantity: new Prisma.Decimal(1),
        undo: null,
      })),
    );
    const result = await service.list('viewer', 'household');
    expect(result.items).toHaveLength(20);
    expect(result.items[0].id).toBe('inventory:21');
    expect(result.items.at(-1)?.id).toBe('inventory:02');
  });
});
