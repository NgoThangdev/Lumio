import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { tokenHash } from '../src/auth/auth.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { WebPushConfiguration } from '../src/notifications/web-push-transport.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const keys = {
  p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString(
    'base64url',
  ),
  auth: Buffer.alloc(16, 2).toString('base64url'),
};

describe('Notification settings and Push Subscription HTTP (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let emails: string[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
  });
  beforeEach(() => {
    emails = [];
  });
  afterEach(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  afterAll(async () => app.close());

  async function register() {
    const email = `${randomUUID()}@example.invalid`;
    emails.push(email);
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'fixture-password-123' })
      .expect(201);
    const cookie = (response.headers['set-cookie'] as string[])[0].split(
      ';',
    )[0];
    return { id: response.body.id as string, email, cookie };
  }

  async function signIn(email: string) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email, password: 'fixture-password-123' })
      .expect(201);
    return (response.headers['set-cookie'] as string[])[0].split(';')[0];
  }

  function sessionHash(cookie: string) {
    return tokenHash(cookie.split('=')[1]);
  }

  it('protects the public-key endpoint and exposes only the configured public state', async () => {
    const user = await register();
    const url = '/api/me/push-public-key';
    await request(app.getHttpServer()).get(url).expect(401);
    const response = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(response.body).toEqual(app.get(WebPushConfiguration).publicState());
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).not.toContain('privateKey');
  });

  it('reports only this validated session’s subscription status across devices and account switch', async () => {
    const alice = await register();
    const otherDevice = await signIn(alice.email);
    const bob = await register();
    const endpoint = `https://push.example.invalid/${randomUUID()}`;
    const statusUrl = '/api/me/push-subscription/status';
    const registration = { endpoint, keys };
    const check = (cookie: string) =>
      request(app.getHttpServer())
        .post(statusUrl)
        .set('Cookie', cookie)
        .send({ endpoint });

    await request(app.getHttpServer())
      .post(statusUrl)
      .send({ endpoint })
      .expect(401);
    expect((await check(alice.cookie).expect(200)).body).toEqual({
      registered: false,
    });
    await request(app.getHttpServer())
      .put('/api/me/push-subscription')
      .set('Cookie', alice.cookie)
      .send(registration)
      .expect(200);
    const owned = await check(alice.cookie).expect(200);
    expect(owned.body).toEqual({ registered: true });
    expect(owned.headers['cache-control']).toBe('no-store');
    expect(owned.text).not.toContain(endpoint);
    expect(owned.text).not.toContain(keys.auth);
    expect((await check(otherDevice).expect(200)).body).toEqual({
      registered: false,
    });
    expect((await check(bob.cookie).expect(200)).body).toEqual({
      registered: false,
    });

    const switched = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .set('Cookie', alice.cookie)
      .send({ email: bob.email, password: 'fixture-password-123' })
      .expect(201);
    const bobBrowser = (switched.headers['set-cookie'] as string[])[0].split(
      ';',
    )[0];
    await check(alice.cookie).expect(401);
    expect((await check(bobBrowser).expect(200)).body).toEqual({
      registered: false,
    });
    await request(app.getHttpServer())
      .put('/api/me/push-subscription')
      .set('Cookie', bobBrowser)
      .send(registration)
      .expect(200);
    expect((await check(bobBrowser).expect(200)).body).toEqual({
      registered: true,
    });
    expect((await check(bob.cookie).expect(200)).body).toEqual({
      registered: false,
    });
    expect((await check(otherDevice).expect(200)).body).toEqual({
      registered: false,
    });

    await request(app.getHttpServer())
      .delete('/api/me/push-subscription')
      .set('Cookie', bobBrowser)
      .send({ endpoint })
      .expect(200);
    expect((await check(bobBrowser).expect(200)).body).toEqual({
      registered: false,
    });
  });

  it('rejects malformed status input and expired sessions without leaking endpoint data', async () => {
    const alice = await register();
    const endpoint = `https://push.example.invalid/${randomUUID()}`;
    const statusUrl = '/api/me/push-subscription/status';
    for (const body of [
      {},
      { endpoint: 'http://push.example.invalid/device' },
      { endpoint: 'https://push.example.invalid/device#fragment' },
      { endpoint, userId: alice.id },
      { endpoint: 42 },
    ]) {
      const response = await request(app.getHttpServer())
        .post(statusUrl)
        .set('Cookie', alice.cookie)
        .send(body)
        .expect(400);
      expect(response.body.message).toBe('INVALID_PUSH_SUBSCRIPTION');
      expect(JSON.stringify(response.body)).not.toContain(endpoint);
    }
    await request(app.getHttpServer())
      .put('/api/me/push-subscription')
      .set('Cookie', alice.cookie)
      .send({ endpoint, keys })
      .expect(200);
    await prisma.userSession.update({
      where: { tokenHash: sessionHash(alice.cookie) },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .post(statusUrl)
      .set('Cookie', alice.cookie)
      .send({ endpoint })
      .expect(401);
  });

  it('keeps defaults and updates global preferences isolated by user', async () => {
    const alice = await register();
    const bob = await register();
    const url = '/api/me/notification-preferences';
    await request(app.getHttpServer()).get(url).expect(401);
    const initial = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', alice.cookie)
      .expect(200);
    expect(initial.body).toEqual({
      expiryAlertsEnabled: false,
      lowStockAlertsEnabled: false,
      shoppingRemindersEnabled: false,
      dailyDigestEnabled: false,
      householdEventsEnabled: false,
      quietHours: null,
      timezone: 'Asia/Ho_Chi_Minh',
    });
    await request(app.getHttpServer())
      .patch(url)
      .set('Cookie', alice.cookie)
      .send({
        expiryAlertsEnabled: true,
        quietHours: { start: '22:00', end: '07:00' },
      })
      .expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(url)
          .set('Cookie', bob.cookie)
          .expect(200)
      ).body,
    ).toEqual(initial.body);
    expect(
      (
        await request(app.getHttpServer())
          .get(url)
          .set('Cookie', alice.cookie)
          .expect(200)
      ).body,
    ).toMatchObject({
      expiryAlertsEnabled: true,
      quietHours: { start: '22:00', end: '07:00' },
    });
    await request(app.getHttpServer())
      .patch(url)
      .set('Cookie', alice.cookie)
      .send({ dailyDigestEnabled: 'yes' })
      .expect(400);
  });

  it('supports multiple sessions, endpoint reassignment, sign-out, and expired-session exclusion', async () => {
    const alice = await register();
    const aliceSecond = await signIn(alice.email);
    const bob = await register();
    const url = '/api/me/push-subscription';
    const first = {
      endpoint: `https://push.example.invalid/${randomUUID()}`,
      keys,
    };
    const second = {
      endpoint: `https://push.example.invalid/${randomUUID()}`,
      keys,
    };
    const fixtureSubscriptions = () =>
      prisma.pushSubscription.count({
        where: { endpoint: { in: [first.endpoint, second.endpoint] } },
      });
    await request(app.getHttpServer()).put(url).send(first).expect(401);
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        (
          await request(app.getHttpServer())
            .put(url)
            .set('Cookie', alice.cookie)
            .send(first)
            .expect(200)
        ).body,
      ).toEqual({ registered: true });
    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', aliceSecond)
      .send(second)
      .expect(200);
    expect(await fixtureSubscriptions()).toBe(2);
    expect(
      (await notifications.deliverySubscriptions(alice.id))
        .map((row) => row.endpoint)
        .sort(),
    ).toEqual([first.endpoint, second.endpoint].sort());

    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', bob.cookie)
      .send(first)
      .expect(200);
    expect(
      (
        await prisma.pushSubscription.findUniqueOrThrow({
          where: { endpoint: first.endpoint },
        })
      ).sessionTokenHash,
    ).toBe(sessionHash(bob.cookie));
    expect(await notifications.deliverySubscriptions(alice.id)).toHaveLength(1);
    expect(
      (
        await request(app.getHttpServer())
          .delete(url)
          .set('Cookie', alice.cookie)
          .send({ endpoint: first.endpoint })
          .expect(200)
      ).body,
    ).toEqual({ removed: false });
    await request(app.getHttpServer())
      .post('/api/auth/sign-out')
      .set('Cookie', alice.cookie)
      .expect(201);
    expect(await fixtureSubscriptions()).toBe(2);
    await request(app.getHttpServer())
      .post('/api/auth/sign-out')
      .set('Cookie', aliceSecond)
      .expect(201);
    expect(await fixtureSubscriptions()).toBe(1);

    await prisma.userSession.update({
      where: { tokenHash: sessionHash(bob.cookie) },
      data: { expiresAt: new Date(0) },
    });
    expect(await notifications.deliverySubscriptions(bob.id)).toEqual([]);
    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', bob.cookie)
      .send(first)
      .expect(401);
  });

  it('rejects malformed subscriptions and removes only this session endpoint', async () => {
    const alice = await register();
    const otherSession = await signIn(alice.email);
    const url = '/api/me/push-subscription';
    const endpoint = `https://push.example.invalid/${randomUUID()}`;
    for (const body of [
      { endpoint: 'http://push.example.invalid/a', keys },
      {
        endpoint,
        keys: { ...keys, auth: 'bad' },
      },
      { endpoint, keys, userId: alice.id },
    ])
      await request(app.getHttpServer())
        .put(url)
        .set('Cookie', alice.cookie)
        .send(body)
        .expect(400);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(
      0,
    );
    const subscription = { endpoint, keys };
    const registered = await request(app.getHttpServer())
      .put(url)
      .set('Cookie', otherSession)
      .send(subscription)
      .expect(200);
    expect(JSON.stringify(registered.body)).not.toContain(
      subscription.endpoint,
    );
    expect(JSON.stringify(registered.body)).not.toContain(keys.auth);
    expect(
      (
        await request(app.getHttpServer())
          .delete(url)
          .set('Cookie', alice.cookie)
          .send({ endpoint: subscription.endpoint })
          .expect(200)
      ).body,
    ).toEqual({ removed: false });
    expect(
      (
        await request(app.getHttpServer())
          .delete(url)
          .set('Cookie', otherSession)
          .send({ endpoint: subscription.endpoint })
          .expect(200)
      ).body,
    ).toEqual({ removed: true });
  });

  it('switches A to B on one browser while preserving A on another device', async () => {
    const alice = await register();
    const otherDevice = await signIn(alice.email);
    const bob = await register();
    const browserEndpoint = `https://push.example.invalid/${randomUUID()}`;
    const otherEndpoint = `https://push.example.invalid/${randomUUID()}`;
    const url = '/api/me/push-subscription';
    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', alice.cookie)
      .send({ endpoint: browserEndpoint, keys })
      .expect(200);
    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', otherDevice)
      .send({ endpoint: otherEndpoint, keys })
      .expect(200);

    const switched = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .set('Cookie', alice.cookie)
      .send({ email: bob.email, password: 'fixture-password-123' })
      .expect(201);
    const bobBrowser = (switched.headers['set-cookie'] as string[])[0].split(
      ';',
    )[0];
    expect(switched.body.id).toBe(bob.id);
    expect(
      await prisma.userSession.findUnique({
        where: { tokenHash: sessionHash(alice.cookie) },
      }),
    ).toBeNull();
    expect(
      await prisma.pushSubscription.findUnique({
        where: { endpoint: browserEndpoint },
      }),
    ).toBeNull();
    expect(
      await prisma.userSession.findUnique({
        where: { tokenHash: sessionHash(otherDevice) },
      }),
    ).toMatchObject({ userId: alice.id });
    expect(
      (
        await prisma.pushSubscription.findUniqueOrThrow({
          where: { endpoint: otherEndpoint },
        })
      ).sessionTokenHash,
    ).toBe(sessionHash(otherDevice));
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', alice.cookie)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', otherDevice)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', bobBrowser)
      .expect(200);

    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', bobBrowser)
      .send({ endpoint: browserEndpoint, keys })
      .expect(200);
    expect(
      (
        await prisma.pushSubscription.findUniqueOrThrow({
          where: { endpoint: browserEndpoint },
        })
      ).sessionTokenHash,
    ).toBe(sessionHash(bobBrowser));
    expect(
      (await notifications.deliverySubscriptions(alice.id)).map(
        (row) => row.endpoint,
      ),
    ).toEqual([otherEndpoint]);
  });

  it('keeps the old session and subscription when sign-in credentials are rejected', async () => {
    const alice = await register();
    const bob = await register();
    const endpoint = `https://push.example.invalid/${randomUUID()}`;
    await request(app.getHttpServer())
      .put('/api/me/push-subscription')
      .set('Cookie', alice.cookie)
      .send({ endpoint, keys })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .set('Cookie', alice.cookie)
      .send({ email: bob.email, password: 'wrong-password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Cookie', alice.cookie)
      .send({ email: bob.email, password: 'fixture-password-123' })
      .expect(409);
    expect(
      await prisma.userSession.findUnique({
        where: { tokenHash: sessionHash(alice.cookie) },
      }),
    ).toMatchObject({ userId: alice.id });
    expect(
      (await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } }))
        .sessionTokenHash,
    ).toBe(sessionHash(alice.cookie));
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', alice.cookie)
      .expect(200);
  });

  it('replaces the previous browser session on successful registration', async () => {
    const alice = await register();
    const otherDevice = await signIn(alice.email);
    const endpoint = `https://push.example.invalid/${randomUUID()}`;
    await request(app.getHttpServer())
      .put('/api/me/push-subscription')
      .set('Cookie', alice.cookie)
      .send({ endpoint, keys })
      .expect(200);
    const email = `${randomUUID()}@example.invalid`;
    emails.push(email);
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Cookie', alice.cookie)
      .send({ email, password: 'fixture-password-123' })
      .expect(201);
    expect(response.body.id).not.toBe(alice.id);
    expect(
      await prisma.userSession.findUnique({
        where: { tokenHash: sessionHash(alice.cookie) },
      }),
    ).toBeNull();
    expect(
      await prisma.pushSubscription.findUnique({ where: { endpoint } }),
    ).toBeNull();
    expect(
      await prisma.userSession.findUnique({
        where: { tokenHash: sessionHash(otherDevice) },
      }),
    ).toMatchObject({ userId: alice.id });
  });
});
