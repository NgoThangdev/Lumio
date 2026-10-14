import { ShoppingService } from './shopping.service.js';

function service(tx: Record<string, unknown>) {
  const prisma = {
    membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'actor' }) },
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
    shoppingTrip: {
      findFirst: vi.fn().mockResolvedValue({ id: 'source', entries: [] }),
    },
  };
  return new ShoppingService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('Shopping Move transaction boundary', () => {
  it('saves MOVED intent with a locked Draft destination and clears purchase fields', async () => {
    const update = vi.fn();
    const lock = vi
      .fn()
      .mockResolvedValueOnce([{ status: 'SHOPPING' }])
      .mockResolvedValueOnce([{ id: 'next', status: 'DRAFT' }]);
    const tx = {
      $queryRaw: lock,
      shoppingEntry: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry',
          itemId: 'item',
          locationId: null,
          item: { trackingMode: 'QUANTITY' },
        }),
        update,
      },
    };
    await service(tx).decideEntry(
      'actor',
      'house',
      'source',
      'entry',
      'MOVED',
      undefined,
      undefined,
      undefined,
      'next',
    );
    expect(lock).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'entry' },
      data: {
        status: 'MOVED',
        actualQuantity: null,
        expiryDate: null,
        locationId: null,
        moveToTripId: 'next',
      },
    });
  });

  it('rejects a destination that stopped being Draft before changing the entry', async () => {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ status: 'SHOPPING' }])
        .mockResolvedValueOnce([{ id: 'next', status: 'SHOPPING' }]),
      shoppingEntry: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry',
          itemId: 'item',
          locationId: null,
          item: { trackingMode: 'QUANTITY' },
        }),
        update,
      },
    };
    await expect(
      service(tx).decideEntry(
        'actor',
        'house',
        'source',
        'entry',
        'MOVED',
        undefined,
        undefined,
        undefined,
        'next',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ message: 'DESTINATION_NOT_DRAFT' }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('revalidates destinations before purchases and inserts carried entries without replacing snapshots', async () => {
    const createMany = vi.fn();
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ status: 'SHOPPING' }])
        .mockResolvedValueOnce([{ id: 'next', status: 'DRAFT' }]),
      shoppingEntry: {
        findMany: vi.fn().mockResolvedValue([
          {
            itemId: 'item',
            status: 'MOVED',
            moveToTripId: 'next',
            priority: 'MUST_BUY',
          },
        ]),
        createMany,
        updateMany: vi.fn(),
      },
      shoppingTrip: { update: vi.fn() },
    };
    await service(tx).finish('actor', 'house', 'source');
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          tripId: 'next',
          itemId: 'item',
          status: 'PENDING',
          source: 'MANUAL',
          priority: 'MUST_BUY',
        },
      ],
      skipDuplicates: true,
    });
    expect(tx.shoppingTrip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RESTOCKED',
          completedByUserId: 'actor',
        }),
      }),
    );
  });

  it('does not overwrite the first finisher on a repeated Finish', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ status: 'RESTOCKED' }]),
      shoppingEntry: { findMany: vi.fn(), updateMany: vi.fn() },
      shoppingTrip: { update: vi.fn() },
    };
    await service(tx).finish('later-actor', 'house', 'source');
    expect(tx.shoppingEntry.findMany).not.toHaveBeenCalled();
    expect(tx.shoppingEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.shoppingTrip.update).not.toHaveBeenCalled();
  });
});
