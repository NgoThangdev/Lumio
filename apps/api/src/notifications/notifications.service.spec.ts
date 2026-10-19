import { tokenHash } from '../auth/auth.service.js';
import { NotificationsService } from './notifications.service.js';

const p256dh = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString(
  'base64url',
);
const auth = Buffer.alloc(16, 2).toString('base64url');
const push = (endpoint = 'https://push.example.invalid/device') => ({
  endpoint,
  keys: { p256dh, auth },
});

function database() {
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  const subscriptions = new Map<
    string,
    { sessionTokenHash: string; p256dh: string; auth: string }
  >();
  const preferences = new Map<string, Record<string, unknown>>();
  const tx = {
    userSession: {
      findUnique: vi.fn(
        async ({ where }: { where: { tokenHash: string } }) =>
          sessions.get(where.tokenHash) ?? null,
      ),
    },
    pushSubscription: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { endpoint: string };
          create: { sessionTokenHash: string; p256dh: string; auth: string };
          update: { sessionTokenHash: string; p256dh: string; auth: string };
        }) => {
          subscriptions.set(
            where.endpoint,
            subscriptions.has(where.endpoint) ? update : create,
          );
        },
      ),
    },
  };
  const prisma = {
    notificationPreference: {
      findUnique: vi.fn(
        async ({ where }: { where: { userId: string } }) =>
          preferences.get(where.userId) ?? null,
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const row = {
            expiryAlertsEnabled: false,
            lowStockAlertsEnabled: false,
            shoppingRemindersEnabled: false,
            dailyDigestEnabled: false,
            digestTime: '08:00',
            householdEventsEnabled: false,
            quietHoursStart: null,
            quietHoursEnd: null,
            ...preferences.get(where.userId),
            ...(preferences.has(where.userId) ? update : create),
          };
          preferences.set(where.userId, row);
          return row;
        },
      ),
    },
    pushSubscription: {
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: { endpoint: string; sessionTokenHash: string };
        }) => {
          const row = subscriptions.get(where.endpoint);
          if (row?.sessionTokenHash !== where.sessionTokenHash)
            return { count: 0 };
          subscriptions.delete(where.endpoint);
          return { count: 1 };
        },
      ),
      findMany: vi.fn(),
    },
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  };
  return { prisma, sessions, subscriptions, preferences, tx };
}

describe('Notification preferences and subscriptions', () => {
  it('defaults all categories off and updates only the signed-in user', async () => {
    const db = database();
    const service = new NotificationsService(db.prisma as never);
    expect(await service.preferences('alice')).toEqual({
      expiryAlertsEnabled: false,
      lowStockAlertsEnabled: false,
      shoppingRemindersEnabled: false,
      dailyDigestEnabled: false,
      digestTime: '08:00',
      householdEventsEnabled: false,
      quietHours: null,
      timezone: 'Asia/Ho_Chi_Minh',
    });
    expect(
      await service.updatePreferences('alice', {
        expiryAlertsEnabled: true,
        dailyDigestEnabled: true,
        digestTime: '09:30',
        quietHours: { start: '22:00', end: '07:00' },
      }),
    ).toMatchObject({
      expiryAlertsEnabled: true,
      dailyDigestEnabled: true,
      digestTime: '09:30',
      quietHours: { start: '22:00', end: '07:00' },
    });
    expect(await service.preferences('bob')).toMatchObject({
      expiryAlertsEnabled: false,
      dailyDigestEnabled: false,
      digestTime: '08:00',
    });
    expect(
      await service.updatePreferences('alice', { quietHours: null }),
    ).toMatchObject({
      expiryAlertsEnabled: true,
      quietHours: null,
    });
  });

  it('rejects malformed preference updates', async () => {
    const service = new NotificationsService(database().prisma as never);
    for (const body of [
      {},
      { userId: 'bob' },
      { dailyDigestEnabled: 'yes' },
      { digestTime: '8:00' },
      { digestTime: '24:00' },
      { digestTime: '08:60' },
      { digestTime: null },
      { quietHours: { start: '22:00', end: '22:00' } },
      { quietHours: { start: '99:00', end: '07:00' } },
    ]) {
      await expect(
        service.updatePreferences('alice', body),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('supports multiple sessions, idempotent registration, and endpoint reassignment', async () => {
    const db = database();
    const service = new NotificationsService(db.prisma as never);
    for (const [token, userId] of [
      ['a', 'alice'],
      ['b', 'alice'],
      ['c', 'bob'],
    ])
      db.sessions.set(tokenHash(token), {
        userId,
        expiresAt: new Date(Date.now() + 60_000),
      });
    await service.register('alice', 'a', push());
    await service.register('alice', 'a', push());
    expect(db.subscriptions.size).toBe(1);
    await service.register(
      'alice',
      'b',
      push('https://push.example.invalid/second'),
    );
    expect(db.subscriptions.size).toBe(2);
    await service.register('bob', 'c', push());
    expect(db.subscriptions.get(push().endpoint)?.sessionTokenHash).toBe(
      tokenHash('c'),
    );
    expect(await service.remove('a', { endpoint: push().endpoint })).toEqual({
      removed: false,
    });
    expect(await service.remove('c', { endpoint: push().endpoint })).toEqual({
      removed: true,
    });
    expect(db.subscriptions.size).toBe(1);
  });

  it('rejects expired or mismatched sessions and filters delivery to active user sessions', async () => {
    const db = database();
    const service = new NotificationsService(db.prisma as never);
    db.sessions.set(tokenHash('expired'), {
      userId: 'alice',
      expiresAt: new Date(0),
    });
    db.sessions.set(tokenHash('valid'), {
      userId: 'alice',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      service.register('alice', 'expired', push()),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.register('bob', 'valid', push()),
    ).rejects.toMatchObject({ status: 401 });
    expect(db.tx.pushSubscription.upsert).not.toHaveBeenCalled();
    await service.deliverySubscriptions('alice', new Date());
    expect(db.prisma.pushSubscription.findMany).toHaveBeenCalledWith({
      where: {
        session: { userId: 'alice', expiresAt: { gt: expect.any(Date) } },
      },
      select: { endpoint: true, p256dh: true, auth: true },
    });
  });

  it('rejects malformed subscriptions without storing secrets', async () => {
    const db = database();
    const service = new NotificationsService(db.prisma as never);
    for (const body of [
      { ...push(), endpoint: 'http://push.example.invalid/device' },
      { ...push(), endpoint: 'https://user:pass@push.example.invalid/device' },
      {
        ...push(),
        endpoint: 'https://push.example.invalid/' + 'x'.repeat(2100),
      },
      { ...push(), endpoint: 'https://push.example.invalid/é' },
      { ...push(), keys: { p256dh: 'bad', auth } },
      { ...push(), keys: { p256dh, auth: 'bad' } },
      { ...push(), userId: 'bob' },
    ])
      await expect(service.register('alice', 'a', body)).rejects.toMatchObject({
        status: 400,
      });
    expect(db.tx.pushSubscription.upsert).not.toHaveBeenCalled();
  });
});
