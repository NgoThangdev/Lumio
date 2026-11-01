import { ShoppingService } from './shopping.service.js';

function setup(
  status = 'DRAFT',
  archivedAt: Date | null = null,
  blocking: string[] = [],
) {
  const update = vi.fn().mockResolvedValue({});
  const raw = vi
    .fn()
    .mockResolvedValueOnce([{ id: 'house', deletionRequestId: null }])
    .mockResolvedValueOnce([{ status, archivedAt }]);
  const tx = {
    membership: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
    $queryRaw: raw,
    shoppingEntry: {
      findMany: vi
        .fn()
        .mockResolvedValue(blocking.map((tripId) => ({ tripId }))),
    },
    shoppingTrip: { update, findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = {
    $transaction: (callback: (tx: typeof tx) => unknown) => callback(tx),
  };
  const service = new ShoppingService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(service, 'read').mockResolvedValue({ id: 'trip' } as never);
  return { service, tx, update, raw };
}

describe('Shopping Trip archive boundary', () => {
  it.each(['DRAFT', 'SHOPPING', 'RESTOCKED'])(
    'archives %s without changing status or stock',
    async (status) => {
      const { service, update } = setup(status);
      await service.archive('actor', 'house', 'trip');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'trip' },
        data: { archivedAt: expect.any(Date), archivedByUserId: 'actor' },
      });
    },
  );

  it('keeps a repeated archive idempotent', async () => {
    const { service, update } = setup('RESTOCKED', new Date());
    await service.archive('actor', 'house', 'trip');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a Draft targeted by an active MOVED entry before updating', async () => {
    const { service, update, tx, raw } = setup('DRAFT', null, ['source']);
    await expect(
      service.archive('actor', 'house', 'trip'),
    ).rejects.toMatchObject({
      response: { code: 'TRIP_MOVE_DESTINATION_IN_USE', tripIds: ['source'] },
    });
    expect(update).not.toHaveBeenCalled();
    expect(tx.shoppingEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          moveToTripId: 'trip',
          status: 'MOVED',
          trip: { status: 'SHOPPING', archivedAt: null },
        },
      }),
    );
    expect(String(raw.mock.calls[1]?.[0])).toContain('FOR UPDATE');
  });

  it('restores the original status and clears archive provenance', async () => {
    const { service, update } = setup('SHOPPING', new Date());
    await service.restore('actor', 'house', 'trip');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'trip' },
      data: { archivedAt: null, archivedByUserId: null },
    });
  });

  it('keeps a repeated restore idempotent and propagates update failures', async () => {
    const plain = setup('DRAFT');
    await plain.service.restore('actor', 'house', 'trip');
    expect(plain.update).not.toHaveBeenCalled();
    const failing = setup('DRAFT');
    failing.update.mockRejectedValueOnce(new Error('transaction failed'));
    await expect(
      failing.service.archive('actor', 'house', 'trip'),
    ).rejects.toThrow('transaction failed');
  });
});
