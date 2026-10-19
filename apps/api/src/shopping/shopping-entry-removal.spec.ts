import { ShoppingService } from './shopping.service.js';

function setup(status = 'DRAFT') {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ status }]),
    shoppingEntry: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'member' }) },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new ShoppingService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const read = vi
    .spyOn(service, 'read')
    .mockResolvedValue({ entries: [] } as never);
  return { service, tx, prisma, read };
}

describe('unfinished Shopping entry removal', () => {
  it.each(['DRAFT', 'SHOPPING'])(
    'removes only the selected entry from a %s trip',
    async (status) => {
      const { service, tx, read } = setup(status);
      await service.removeEntry('member', 'home', 'trip', 'entry');
      expect(tx.shoppingEntry.deleteMany).toHaveBeenCalledWith({
        where: { id: 'entry', tripId: 'trip' },
      });
      expect(read).toHaveBeenCalledWith('member', 'home', 'trip');
    },
  );

  it('refuses a completed trip and leaves its entries intact', async () => {
    const { service, tx } = setup('RESTOCKED');
    await expect(
      service.removeEntry('member', 'home', 'trip', 'entry'),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.shoppingEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('requires membership and a matching trip entry', async () => {
    const { service, tx, prisma } = setup();
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.removeEntry('outsider', 'home', 'trip', 'entry'),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.shoppingEntry.deleteMany).not.toHaveBeenCalled();
    tx.shoppingEntry.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.removeEntry('member', 'home', 'trip', 'other'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
