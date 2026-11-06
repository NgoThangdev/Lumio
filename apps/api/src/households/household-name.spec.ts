import { HouseholdsService } from './households.service.js';

function setup(role: 'ADMIN' | 'MEMBER' = 'ADMIN', pending = false) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'home' }]),
    membership: {
      findUnique: vi.fn().mockResolvedValue({ role }),
    },
    household: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ deletionRequestId: pending ? 'request' : null }),
      update: vi.fn().mockImplementation(async ({ data }) => ({
        id: 'home',
        name: data.name,
      })),
    },
  };
  const prisma = { $transaction: (run: (db: typeof tx) => unknown) => run(tx) };
  return { service: new HouseholdsService(prisma as never, {} as never), tx };
}

describe('household rename', () => {
  it('trims and saves a name for an Admin', async () => {
    const { service, tx } = setup();
    await expect(
      service.rename('admin', 'home', { name: '  New home  ' }),
    ).resolves.toEqual({
      id: 'home',
      name: 'New home',
    });
    expect(tx.household.update).toHaveBeenCalledWith({
      where: { id: 'home' },
      data: { name: 'New home' },
      select: { id: true, name: true },
    });
  });

  it('rejects members and pending deletion requests', async () => {
    const member = setup('MEMBER');
    await expect(
      member.service.rename('member', 'home', { name: 'New' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(member.tx.household.update).not.toHaveBeenCalled();
    const pending = setup('ADMIN', true);
    await expect(
      pending.service.rename('admin', 'home', { name: 'New' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(pending.tx.household.update).not.toHaveBeenCalled();
  });

  it('rejects malformed and oversized names', async () => {
    const { service, tx } = setup();
    for (const body of [
      {},
      { name: ' ' },
      { name: 1 },
      { name: 'x'.repeat(121) },
      { name: 'New', extra: true },
    ])
      await expect(service.rename('admin', 'home', body)).rejects.toMatchObject(
        { status: 400 },
      );
    expect(tx.household.update).not.toHaveBeenCalled();
  });
});
