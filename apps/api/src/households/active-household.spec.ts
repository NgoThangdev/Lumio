import {
  checkActiveHousehold,
  requireActiveHousehold,
} from './active-household.js';

function setup(role: 'ADMIN' | 'MEMBER' | null = 'MEMBER', pending = false) {
  const tx = {
    membership: {
      findUnique: vi.fn().mockResolvedValue(role ? { role } : null),
    },
    household: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ deletionRequestId: pending ? 'request' : null }),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { id: 'home', deletionRequestId: pending ? 'request' : null },
      ]),
  };
  return tx;
}

describe('active household boundary', () => {
  it('checks membership before exposing pending state', async () => {
    const outsider = setup(null, true);
    await expect(
      requireActiveHousehold(outsider as never, 'other', 'home'),
    ).rejects.toMatchObject({ status: 403 });
    expect(outsider.$queryRaw).not.toHaveBeenCalled();
    expect(outsider.household.findUnique).not.toHaveBeenCalled();
    const member = setup('MEMBER', true);
    await expect(
      requireActiveHousehold(member as never, 'member', 'home'),
    ).rejects.toMatchObject({
      status: 409,
      response: { message: 'HOUSEHOLD_PENDING_DELETION' },
    });
    await expect(
      checkActiveHousehold(member as never, 'member', 'home'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('preserves active access and household-scoped Admin permissions', async () => {
    const member = setup();
    expect(
      await requireActiveHousehold(member as never, 'member', 'home'),
    ).toEqual({ role: 'MEMBER' });
    await expect(
      requireActiveHousehold(member as never, 'member', 'home', 'ADMIN'),
    ).rejects.toMatchObject({ status: 403 });
    const admin = setup('ADMIN');
    expect(
      await requireActiveHousehold(admin as never, 'admin', 'home', 'ADMIN'),
    ).toEqual({ role: 'ADMIN' });
  });

  it('rechecks membership after waiting for the household lock', async () => {
    const tx = setup('MEMBER');
    tx.membership.findUnique
      .mockResolvedValueOnce({ role: 'MEMBER' })
      .mockResolvedValueOnce(null);
    await expect(
      requireActiveHousehold(tx as never, 'member', 'home'),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.membership.findUnique).toHaveBeenCalledTimes(2);
  });
});
