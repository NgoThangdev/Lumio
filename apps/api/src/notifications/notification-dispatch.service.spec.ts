import {
  InvalidPushSubscriptionError,
  NotificationDispatchService,
  RetryablePushError,
} from './notification-dispatch.service.js';

const at = new Date('2026-10-15T00:00:00.000Z');
const content = {
  households: [
    {
      householdId: 'home',
      items: [{ itemId: 'item', signals: ['LOW_STOCK'] }],
    },
  ],
};

function setup(
  endpoints = ['https://push.invalid/a', 'https://push.invalid/b'],
) {
  const records = new Map<
    string,
    {
      intentId: string;
      subscriptionKey: string;
      status: string;
      attemptCount: number;
      nextAttemptAt: Date | null;
      claimedAt: Date | null;
    }
  >();
  const sessions = new Map(
    endpoints.map((endpoint) => [
      endpoint,
      {
        endpoint,
        p256dh: 'public',
        auth: 'secret',
        sessionTokenHash: 'session',
        updatedAt: at,
        session: {
          userId: 'user',
          expiresAt: new Date('2026-10-16T00:00:00.000Z'),
        },
      },
    ]),
  );
  const intents = [
    {
      id: 'digest',
      userId: 'user',
      kind: 'DAILY_DIGEST',
      localDay: '2026-10-15',
      dueAt: at,
    },
  ];
  const prisma = {
    notificationIntent: {
      findMany: vi.fn(async () => intents.map(({ id }) => ({ id }))),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          intents.find((i) => i.id === where.id) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          intents.find((i) => i.id === where.id) ?? null,
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
        intents.find((i) => i.id === where.id),
      ),
    },
    notificationPreference: { findUnique: vi.fn() },
    pushSubscription: {
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            endpoint: string;
            sessionTokenHash: string;
            updatedAt: Date;
          };
        }) => {
          const current = sessions.get(where.endpoint);
          if (
            current &&
            current.sessionTokenHash === where.sessionTokenHash &&
            current.updatedAt === where.updatedAt
          ) {
            sessions.delete(where.endpoint);
            return { count: 1 };
          }
          return { count: 0 };
        },
      ),
      findMany: vi.fn(async () =>
        [...sessions.values()]
          .filter((s) => s.session.expiresAt > at)
          .map(({ endpoint }) => ({ endpoint })),
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { endpoint: string } }) =>
          sessions.get(where.endpoint) ?? null,
      ),
    },
    notificationDelivery: {
      findUnique: vi.fn().mockResolvedValue(null),
      createMany: vi.fn(
        async ({
          data,
        }: {
          data: { intentId: string; subscriptionKey: string }[];
        }) => {
          for (const row of data) {
            const key = `${row.intentId}:${row.subscriptionKey}`;
            if (!records.has(key))
              records.set(key, {
                ...row,
                status: 'PENDING',
                attemptCount: 0,
                nextAttemptAt: null,
                claimedAt: null,
              });
          }
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            intentId?: string;
            subscriptionKey?: string;
            status?: string;
            OR?: { status: string; nextAttemptAt?: { lte: Date } }[];
            claimedAt?: { lte: Date };
          };
          data: {
            status: string;
            claimedAt?: Date;
            attemptCount?: { increment: number };
            nextAttemptAt?: Date;
            lastErrorCode?: string;
          };
        }) => {
          let count = 0;
          for (const row of records.values()) {
            if (where.intentId && row.intentId !== where.intentId) continue;
            if (
              where.subscriptionKey &&
              row.subscriptionKey !== where.subscriptionKey
            )
              continue;
            if (where.status && row.status !== where.status) continue;
            if (
              where.claimedAt?.lte &&
              (!row.claimedAt || row.claimedAt > where.claimedAt.lte)
            )
              continue;
            if (
              where.OR &&
              !where.OR.some(
                (condition) =>
                  row.status === condition.status &&
                  (!condition.nextAttemptAt ||
                    (row.nextAttemptAt !== null &&
                      row.nextAttemptAt <= condition.nextAttemptAt.lte)),
              )
            )
              continue;
            row.status = data.status;
            if (data.claimedAt) row.claimedAt = data.claimedAt;
            if (data.attemptCount)
              row.attemptCount += data.attemptCount.increment;
            if (data.nextAttemptAt) row.nextAttemptAt = data.nextAttemptAt;
            count++;
          }
          return { count };
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            intentId_subscriptionKey: {
              intentId: string;
              subscriptionKey: string;
            };
          };
          data: { status: string; nextAttemptAt?: Date | null };
        }) => {
          const { intentId, subscriptionKey } = where.intentId_subscriptionKey;
          const row = records.get(`${intentId}:${subscriptionKey}`)!;
          row.status = data.status;
          if ('nextAttemptAt' in data)
            row.nextAttemptAt = data.nextAttemptAt ?? null;
          return row;
        },
      ),
      findUniqueOrThrow: vi.fn(
        async ({
          where,
        }: {
          where: {
            intentId_subscriptionKey: {
              intentId: string;
              subscriptionKey: string;
            };
          };
        }) => {
          const { intentId, subscriptionKey } = where.intentId_subscriptionKey;
          return records.get(`${intentId}:${subscriptionKey}`)!;
        },
      ),
    },
  };
  const evaluator = {
    revalidateIntent: vi.fn().mockResolvedValue({ ready: true, content }),
  };
  const transport = {
    isAvailable: vi.fn().mockReturnValue(true),
    send: vi.fn().mockResolvedValue(undefined),
  };
  const service = new NotificationDispatchService(
    prisma as never,
    evaluator as never,
    transport,
  );
  return { service, prisma, evaluator, transport, records, sessions, intents };
}

describe('Notification delivery lifecycle (fake transport)', () => {
  it('limits automated due scans and claim recovery to post-activation intents', async () => {
    const { service, prisma, evaluator, transport } = setup();
    const cutoff = new Date('2026-10-15T00:00:00.000Z');
    evaluator.revalidateIntent.mockResolvedValue({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    await service.dispatchDue(at, cutoff);
    expect(prisma.notificationIntent.findMany).toHaveBeenCalledWith({
      where: { dueAt: { lte: at }, createdAt: { gte: cutoff } },
      select: { id: true },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'CLAIMED',
        claimedAt: { lte: expect.any(Date) },
        intent: { createdAt: { gte: cutoff } },
      },
      data: { status: 'UNKNOWN', lastErrorCode: 'UNKNOWN_ACK' },
    });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('does not follow rollover to a pre-activation replacement intent', async () => {
    const { service, prisma, evaluator, transport, intents } = setup([
      'https://push.invalid/a',
    ]);
    const cutoff = new Date('2026-10-15T00:00:00.000Z');
    intents.unshift({
      id: 'overnight',
      userId: 'user',
      kind: 'DAILY_DIGEST',
      localDay: '2026-10-14',
      dueAt: at,
    });
    prisma.notificationIntent.findFirst.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === 'overnight' ? { id: 'overnight' } : null,
    );
    evaluator.revalidateIntent.mockImplementation(async (id: string) =>
      id === 'overnight'
        ? { ready: false, reason: 'ROLLED_OVER', replacementIntentId: 'digest' }
        : { ready: true, content },
    );
    await service.dispatchDue(at, cutoff);
    expect(evaluator.revalidateIntent).toHaveBeenCalledWith('overnight', at);
    expect(evaluator.revalidateIntent).not.toHaveBeenCalledWith('digest', at);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('preflights one device without a send or delivery write', async () => {
    const { service, prisma, transport } = setup(['https://push.invalid/a']);
    expect(await service.preflightIntent('user', 'digest', at)).toEqual({
      eligible: true,
      reason: 'READY',
      subscriptionCount: 1,
      destinationKind: 'ATTENTION',
    });
    expect(transport.send).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.updateMany).not.toHaveBeenCalled();
    expect(prisma.notificationIntent.findMany).not.toHaveBeenCalled();
  });

  it('fails closed for another user, multiple devices, and stale conditions', async () => {
    const { service, prisma, evaluator, transport } = setup();
    expect(
      await service.preflightIntent('other-user', 'digest', at),
    ).toMatchObject({
      eligible: false,
      reason: 'NOT_FOUND',
      subscriptionCount: 0,
    });
    expect(await service.preflightIntent('user', 'digest', at)).toMatchObject({
      eligible: false,
      reason: 'SUBSCRIPTION_COUNT',
      subscriptionCount: 2,
    });
    await expect(
      service.dispatchIntentForUser('user', 'digest', at),
    ).rejects.toThrow('SCOPED_DISPATCH_SUBSCRIPTION_COUNT');
    evaluator.revalidateIntent.mockResolvedValue({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    expect(await service.preflightIntent('user', 'digest', at)).toMatchObject({
      eligible: false,
      reason: 'STALE_CANDIDATE',
    });
    expect(transport.send).not.toHaveBeenCalled();
    expect(prisma.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('scopes a manual fake send to the named intent and sole device', async () => {
    const { service, prisma, transport } = setup(['https://push.invalid/a']);
    expect(
      (await service.dispatchIntentForUser('user', 'digest', at)).accepted,
    ).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(prisma.notificationIntent.findMany).not.toHaveBeenCalled();
    await expect(
      service.dispatchIntentForUser('other-user', 'digest', at),
    ).rejects.toThrow('SCOPED_DISPATCH_NOT_FOUND');
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('does not send if a second device appears after the scoped claim', async () => {
    const { service, prisma, transport, records } = setup([
      'https://push.invalid/a',
    ]);
    let reads = 0;
    prisma.pushSubscription.findMany.mockImplementation(async () => {
      reads++;
      const one = [{ endpoint: 'https://push.invalid/a' }];
      return reads < 4 ? one : [...one, { endpoint: 'https://push.invalid/b' }];
    });
    expect(
      (await service.dispatchIntentForUser('user', 'digest', at)).skipped,
    ).toBe(1);
    expect(transport.send).not.toHaveBeenCalled();
    expect([...records.values()][0].status).toBe('SKIPPED');
  });

  it('claims each device once across repeated and concurrent dispatch', async () => {
    const { service, transport, records } = setup();
    await Promise.all(Array.from({ length: 4 }, () => service.dispatchDue(at)));
    await service.dispatchDue(at);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect([...records.values()].map((row) => row.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
    ]);
  });

  it('retries a definite failure after five minutes and does not retry an unknown acknowledgement', async () => {
    const { service, transport, records } = setup(['https://push.invalid/a']);
    transport.send.mockRejectedValueOnce(
      new RetryablePushError('before acceptance'),
    );
    expect((await service.dispatchDue(at)).retry).toBe(1);
    expect([...records.values()][0].status).toBe('RETRY');
    await service.dispatchDue(new Date(at.getTime() + 4 * 60_000));
    expect(transport.send).toHaveBeenCalledTimes(1);
    await service.dispatchDue(new Date(at.getTime() + 5 * 60_000));
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect([...records.values()][0].status).toBe('ACCEPTED');
  });

  it('does not send a stale intent or a subscription whose session is gone', async () => {
    const { service, evaluator, transport, sessions } = setup();
    evaluator.revalidateIntent.mockResolvedValueOnce({
      ready: false,
      reason: 'STALE_CANDIDATE',
    });
    expect((await service.dispatchDue(at)).accepted).toBe(0);
    sessions.delete('https://push.invalid/a');
    await service.dispatchDue(at);
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('excludes expired sessions and leaves an ambiguous acknowledgement unresent', async () => {
    const { service, transport, sessions, records } = setup();
    sessions.get('https://push.invalid/b')!.session.expiresAt = at;
    transport.send.mockRejectedValueOnce(new Error('unknown acknowledgement'));
    expect((await service.dispatchDue(at)).unknown).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(1);
    await service.dispatchDue(new Date(at.getTime() + 6 * 60_000));
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect([...records.values()][0].status).toBe('UNKNOWN');
  });

  it('revalidates after claim and respects quiet hours that began meanwhile', async () => {
    const { service, evaluator, prisma, transport, records } = setup([
      'https://push.invalid/a',
    ]);
    evaluator.revalidateIntent
      .mockResolvedValueOnce({ ready: true, content })
      .mockResolvedValueOnce({ ready: false, reason: 'QUIET_HOURS' });
    prisma.notificationPreference.findUnique.mockResolvedValue({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });
    await service.dispatchDue(new Date('2026-10-14T16:00:00.000Z'));
    expect(transport.send).not.toHaveBeenCalled();
    expect([...records.values()][0].status).toBe('RETRY');
  });

  it('dispatches only the fresh replacement for an overnight digest', async () => {
    const { service, evaluator, transport, records, intents } = setup([
      'https://push.invalid/a',
    ]);
    intents.unshift({
      id: 'yesterday',
      userId: 'user',
      kind: 'DAILY_DIGEST',
      localDay: '2026-10-14',
      dueAt: at,
    });
    evaluator.revalidateIntent.mockImplementation(async (id: string) =>
      id === 'yesterday'
        ? { ready: false, reason: 'ROLLED_OVER', replacementIntentId: 'digest' }
        : { ready: true, content },
    );
    expect((await service.dispatchDue(at)).rolledOver).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect([...records.values()].map((row) => row.intentId)).toEqual([
      'digest',
    ]);
  });

  it('removes only a permanently invalid subscription and delivers to the other device', async () => {
    const { service, transport, prisma, sessions, records } = setup();
    transport.send.mockRejectedValueOnce(
      new InvalidPushSubscriptionError('SUBSCRIPTION_INVALID'),
    );
    expect(await service.dispatchDue(at)).toMatchObject({
      accepted: 1,
      failed: 1,
    });
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledTimes(1);
    expect(sessions.has('https://push.invalid/a')).toBe(false);
    expect(sessions.has('https://push.invalid/b')).toBe(true);
    expect([...records.values()].map((row) => row.status)).toEqual([
      'FAILED',
      'ACCEPTED',
    ]);
  });

  it('does not claim deliveries when the transport is unavailable', async () => {
    const { service, prisma, transport } = setup();
    transport.isAvailable = vi.fn().mockReturnValue(false);
    expect((await service.dispatchDue(at)).accepted).toBe(0);
    expect(prisma.notificationIntent.findMany).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });
});
