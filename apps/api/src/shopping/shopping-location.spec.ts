import { InventoryService } from '../inventory/inventory.service.js';
import { ShoppingService } from './shopping.service.js';

describe('Shopping Finish location resolution', () => {
  it('rolls back all writes if one purchased item needs a location', async () => {
    const writtenBatches: unknown[] = [];
    const writtenActions: unknown[] = [];
    const tripUpdates = vi.fn();
    const items = {
      first: { preferredRestockLocationId: 'pantry' },
      missing: { preferredRestockLocationId: null },
    };
    const entries = [
      {
        id: 'entry-first',
        itemId: 'first',
        status: 'PURCHASED',
        actualQuantity: { toString: () => '2' },
        expiryDate: null,
        locationId: null,
        item: { trackingMode: 'QUANTITY' },
      },
      {
        id: 'entry-missing',
        itemId: 'missing',
        status: 'PURCHASED',
        actualQuantity: { toString: () => '1' },
        expiryDate: null,
        locationId: null,
        item: { trackingMode: 'QUANTITY' },
      },
    ];
    const tx = {
      membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'user' }) },
      $queryRaw: vi.fn(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (strings.join('').includes('ShoppingTrip')) {
            return [{ status: 'SHOPPING' }];
          }
          const itemId = values[0] as keyof typeof items;
          return [
            {
              id: itemId,
              trackingMode: 'QUANTITY',
              openedTrackingEnabled: false,
              preferredRestockLocationId:
                items[itemId].preferredRestockLocationId,
            },
          ];
        },
      ),
      shoppingEntry: {
        findMany: vi.fn().mockResolvedValue(entries),
        updateMany: vi.fn(),
      },
      shoppingTrip: { update: tripUpdates },
      stockBatch: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: { data: unknown }) => {
          writtenBatches.push(data);
          return { id: `batch-${writtenBatches.length}` };
        }),
      },
      inventoryAction: {
        create: vi.fn(async ({ data }: { data: unknown }) => {
          writtenActions.push(data);
          return { id: `action-${writtenActions.length}` };
        }),
      },
      inventoryItem: { update: vi.fn().mockResolvedValue({}) },
      location: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'pantry' ? { id: 'pantry' } : null,
        ),
      },
    };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'user' }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => {
        const batchesBefore = writtenBatches.length;
        const actionsBefore = writtenActions.length;
        try {
          return await callback(tx);
        } catch (error) {
          writtenBatches.length = batchesBefore;
          writtenActions.length = actionsBefore;
          throw error;
        }
      }),
    };
    const inventory = new InventoryService(prisma as never);
    const service = new ShoppingService(
      prisma as never,
      inventory,
      {} as never,
      {} as never,
    );

    await expect(
      service.finish('user', 'household', 'trip'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'LOCATION_REQUIRED',
        itemId: 'missing',
      }),
    });
    expect(writtenBatches).toEqual([]);
    expect(writtenActions).toEqual([]);
    expect(tripUpdates).not.toHaveBeenCalled();
  });

  it('persists a household-validated explicit purchase location on the entry', async () => {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ status: 'SHOPPING' }]),
      shoppingEntry: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry',
          itemId: 'item',
          locationId: null,
          item: { trackingMode: 'QUANTITY' },
        }),
        update,
      },
      location: {
        findFirst: vi.fn().mockResolvedValue({ id: 'pantry' }),
      },
    };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'user' }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      shoppingTrip: { findFirst: vi.fn().mockResolvedValue({ id: 'trip' }) },
    };
    const service = new ShoppingService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.decideEntry(
      'user',
      'household',
      'trip',
      'entry',
      'PURCHASED',
      '2',
      undefined,
      'pantry',
    );

    expect(tx.location.findFirst).toHaveBeenCalledWith({
      where: { id: 'pantry', householdId: 'household' },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'entry' },
      data: {
        status: 'PURCHASED',
        actualQuantity: expect.anything(),
        expiryDate: null,
        locationId: 'pantry',
        moveToTripId: null,
      },
    });
  });
});
