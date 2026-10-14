import { Prisma } from '../generated/prisma/browser.js';
import { InventoryUndoService } from './inventory-undo.service.js';

describe('Inventory Undo before migration', () => {
  const decimal = (value: string) => new Prisma.Decimal(value);

  it('credits the original two Use batches and records one reversal', async () => {
    const itemId = 'item';
    const actionId = 'use';
    const allocations = [
      {
        batchId: 'early',
        quantity: decimal('2'),
        quantityAfter: decimal('0'),
        batch: {
          id: 'early',
          itemId,
          quantity: decimal('0'),
          openedAt: null,
        },
      },
      {
        batchId: 'later',
        quantity: decimal('1'),
        quantityAfter: decimal('3'),
        batch: {
          id: 'later',
          itemId,
          quantity: decimal('3'),
          openedAt: null,
        },
      },
    ];
    const updateBatch = vi.fn().mockResolvedValue({ count: 1 });
    const createUndo = vi.fn().mockResolvedValue({
      id: 'undo',
      createdAt: new Date('2026-10-13T09:00:00Z'),
      postStockRevision: 4,
      inventoryActionId: actionId,
      stateActionId: null,
    });
    const tx = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'actor' }),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: itemId,
          stockRevision: 3,
          trackingMode: 'QUANTITY',
          openedTrackingEnabled: false,
        },
      ]),
      inventoryAction: {
        findFirst: vi.fn().mockResolvedValue({
          id: actionId,
          userId: 'actor',
          type: 'USE',
          quantity: decimal('3'),
          postStockRevision: 3,
          createdAt: new Date(),
          allocations,
          undo: null,
        }),
      },
      stockBatch: { updateMany: updateBatch },
      inventoryItem: {
        update: vi.fn().mockResolvedValue({ stockRevision: 4 }),
      },
      inventoryUndo: { create: createUndo },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new InventoryUndoService(prisma as never);

    const result = await service.undo('actor', 'household', itemId, {
      actionKind: 'INVENTORY',
      actionId,
    });
    expect(result).toMatchObject({
      undoId: 'undo',
      alreadyUndone: false,
      stockRevision: 4,
    });
    expect(updateBatch).toHaveBeenCalledTimes(2);
    expect(updateBatch).toHaveBeenCalledWith({
      where: { id: 'early', itemId, quantity: decimal('0') },
      data: { quantity: { increment: decimal('2') } },
    });
    expect(updateBatch).toHaveBeenCalledWith({
      where: { id: 'later', itemId, quantity: decimal('3') },
      data: { quantity: { increment: decimal('1') } },
    });
    expect(createUndo).toHaveBeenCalledOnce();
  });

  it('returns a prior reversal before checking its expired window or changed revision', async () => {
    const saved = {
      id: 'undo',
      createdAt: new Date('2026-10-13T09:00:00Z'),
      postStockRevision: 2,
      inventoryActionId: 'use',
      stateActionId: null,
    };
    const tx = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'actor' }),
      },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'item',
          stockRevision: 99,
          trackingMode: 'QUANTITY',
          openedTrackingEnabled: false,
        },
      ]),
      inventoryAction: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'use',
          userId: 'actor',
          createdAt: new Date('2000-01-01'),
          undo: saved,
        }),
      },
      stockBatch: { updateMany: vi.fn() },
      inventoryItem: { update: vi.fn() },
      inventoryUndo: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new InventoryUndoService(prisma as never);
    await expect(
      service.undo('actor', 'household', 'item', {
        actionKind: 'INVENTORY',
        actionId: 'use',
      }),
    ).resolves.toMatchObject({
      undoId: 'undo',
      alreadyUndone: true,
      stockRevision: 2,
    });
    expect(tx.stockBatch.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryUndo.create).not.toHaveBeenCalled();
  });
});
