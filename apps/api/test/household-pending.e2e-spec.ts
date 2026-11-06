import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { NotificationEvaluatorService } from '../src/notifications/notification-evaluator.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Pending household access (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const householdIds: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    const itemIds = items.map((row) => row.id);
    await prisma.notificationIntent.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.inventoryItemChange.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryItemTag.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.shoppingTrip.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.householdInvitation.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.category.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.location.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.tag.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.membership.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationPreference.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  async function actor() {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `${randomUUID()}@example.invalid`,
        password: 'fixture-password-123',
      })
      .expect(201);
    userIds.push(response.body.id as string);
    const cookies = response.headers['set-cookie'] as string | string[];
    return {
      id: response.body.id as string,
      cookie: (Array.isArray(cookies) ? cookies[0] : cookies).split(';')[0],
    };
  }

  async function household(cookie: string) {
    const response = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: `Pending fixture ${randomUUID()}` })
      .expect(201);
    householdIds.push(response.body.id as string);
    return response.body.id as string;
  }

  async function pending(id: string) {
    const requestedAt = new Date();
    await prisma.household.update({
      where: { id },
      data: {
        deletionRequestId: randomUUID(),
        deletionRequestedAt: requestedAt,
        deletionDueAt: new Date(requestedAt.getTime() + 7 * 24 * 60 * 60_000),
      },
    });
  }

  it('hides pending selection and blocks ordinary reads, writes, and archived-item actions while another household works', async () => {
    const admin = await actor();
    const hidden = await household(admin.cookie);
    const active = await household(admin.cookie);
    const created = await request(app.getHttpServer())
      .post(`/api/households/${hidden}/items`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Archived fixture', primaryUnit: 'box' })
      .expect(201);
    const location = await prisma.location.create({
      data: {
        householdId: hidden,
        name: 'Pending shelf',
        nameKey: randomUUID(),
      },
    });
    const plannedDate = new Date(Date.now() + 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    const trip = await request(app.getHttpServer())
      .post(`/api/households/${hidden}/trips`)
      .set('Cookie', admin.cookie)
      .send({ store: 'Store', plannedDate })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/households/${hidden}/items/${created.body.id}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    await pending(hidden);
    const selection = await request(app.getHttpServer())
      .get('/api/households')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(selection.body.map((row: { id: string }) => row.id)).toContain(
      active,
    );
    expect(selection.body.map((row: { id: string }) => row.id)).not.toContain(
      hidden,
    );
    for (const path of [
      `/api/households/${hidden}/shopping-settings`,
      `/api/households/${hidden}/members`,
      `/api/households/${hidden}/invitations`,
      `/api/households/${hidden}/categories`,
      `/api/households/${hidden}/locations`,
      `/api/households/${hidden}/tags`,
      `/api/households/${hidden}/items`,
      `/api/households/${hidden}/items/archived`,
      `/api/households/${hidden}/items/${created.body.id}`,
      `/api/households/${hidden}/stock-intelligence`,
      `/api/households/${hidden}/home/needs-attention`,
      `/api/households/${hidden}/home/activity`,
      `/api/households/${hidden}/trips`,
      `/api/households/${hidden}/trips/${trip.body.id}`,
      `/api/households/${hidden}/trips/${trip.body.id}/stock-check`,
      `/api/households/${hidden}/locations/${location.id}/stock-check`,
    ]) {
      const result = await request(app.getHttpServer())
        .get(path)
        .set('Cookie', admin.cookie)
        .expect(409);
      expect(result.body.message).toBe('HOUSEHOLD_PENDING_DELETION');
    }
    await request(app.getHttpServer())
      .post(`/api/households/${hidden}/items`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Blocked', primaryUnit: 'box' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/households/${hidden}/items/${created.body.id}/restore`)
      .set('Cookie', admin.cookie)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/households/${hidden}/categories`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Blocked' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/households/${hidden}/trips`)
      .set('Cookie', admin.cookie)
      .send({ store: 'Store', plannedDate })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/households/${hidden}/trips/${trip.body.id}/suggestions`)
      .set('Cookie', admin.cookie)
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/api/households/${hidden}/items/${created.body.id}`)
      .set('Cookie', admin.cookie)
      .send({ confirmName: 'Archived fixture' })
      .expect(409);
    await request(app.getHttpServer())
      .get(`/api/households/${active}/shopping-settings`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(
      await prisma.inventoryItem.count({ where: { householdId: hidden } }),
    ).toBe(1);
  });

  it('reveals no pending household name through invitation preview or acceptance', async () => {
    const admin = await actor();
    const invitee = await actor();
    const home = await household(admin.cookie);
    const invite = await request(app.getHttpServer())
      .post(`/api/households/${home}/invitations`)
      .set('Cookie', admin.cookie)
      .expect(201);
    const secret = (invite.body.invitePath as string).split('/').at(-1)!;
    await pending(home);
    const preview = await request(app.getHttpServer())
      .get(`/api/invitations/${secret}`)
      .expect(410);
    expect(JSON.stringify(preview.body)).not.toContain('Pending fixture');
    const outsider = await request(app.getHttpServer())
      .get(`/api/households/${home}/items`)
      .set('Cookie', invitee.cookie)
      .expect(403);
    expect(JSON.stringify(outsider.body)).not.toContain(
      'HOUSEHOLD_PENDING_DELETION',
    );
    await request(app.getHttpServer())
      .post(`/api/invitations/${secret}/accept`)
      .set('Cookie', invitee.cookie)
      .expect(410);
    expect(
      await prisma.membership.count({
        where: { householdId: home, userId: invitee.id },
      }),
    ).toBe(0);
  });

  it('rejects a stock write that waits behind the pending-state update', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const item = await request(app.getHttpServer())
      .post(`/api/households/${home}/items`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Race fixture', primaryUnit: 'box' })
      .expect(201);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const change = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = ${home} FOR UPDATE`;
        locked();
        await hold;
        await tx.household.update({
          where: { id: home },
          data: {
            deletionRequestId: randomUUID(),
            deletionRequestedAt: new Date(),
            deletionDueAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
          },
        });
      },
      { timeout: 15_000 },
    );
    await ready;
    const action = request(app.getHttpServer())
      .post(`/api/households/${home}/items/${item.body.id}/use`)
      .set('Cookie', admin.cookie)
      .send({ quantity: '1' });
    const response = action.then((value) => value);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await change;
    expect((await response).status).toBe(409);
    expect(
      await prisma.inventoryAction.count({ where: { itemId: item.body.id } }),
    ).toBe(0);
  });

  it('rejects a read waiting behind pending FOR UPDATE, while another household remains readable', async () => {
    const admin = await actor();
    const hidden = await household(admin.cookie);
    const active = await household(admin.cookie);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const change = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = ${hidden} FOR UPDATE`;
        locked();
        await hold;
        const requestedAt = new Date();
        await tx.household.update({
          where: { id: hidden },
          data: {
            deletionRequestId: randomUUID(),
            deletionRequestedAt: requestedAt,
            deletionDueAt: new Date(
              requestedAt.getTime() + 7 * 24 * 60 * 60_000,
            ),
          },
        });
      },
      { timeout: 15_000 },
    );
    await ready;
    let settled = false;
    const read = request(app.getHttpServer())
      .get(`/api/households/${hidden}/items`)
      .set('Cookie', admin.cookie)
      .then((result) => {
        settled = true;
        return result;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(settled).toBe(false);
      await request(app.getHttpServer())
        .get(`/api/households/${active}/items`)
        .set('Cookie', admin.cookie)
        .expect(200);
    } finally {
      release();
    }
    await change;
    const result = await read;
    expect(result.status).toBe(409);
    expect(result.body.message).toBe('HOUSEHOLD_PENDING_DELETION');
  });

  it('excludes pending households from attention and notification candidates', async () => {
    const admin = await actor();
    const hidden = await household(admin.cookie);
    const active = await household(admin.cookie);
    await prisma.notificationPreference.create({
      data: {
        userId: admin.id,
        lowStockAlertsEnabled: true,
        dailyDigestEnabled: true,
      },
    });
    for (const householdId of [hidden, active]) {
      const item = await request(app.getHttpServer())
        .post(`/api/households/${householdId}/items`)
        .set('Cookie', admin.cookie)
        .send({ name: `Alert ${householdId}`, primaryUnit: 'box' })
        .expect(201);
      await prisma.inventoryItem.update({
        where: { id: item.body.id },
        data: {
          neverRunOut: true,
          buyThreshold: '1',
          lowStockThreshold: '2',
          targetStock: '3',
        },
      });
    }
    await pending(hidden);
    const attention = await request(app.getHttpServer())
      .get('/api/me/attention')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(
      attention.body.households.map(
        (group: { householdId: string }) => group.householdId,
      ),
    ).toEqual([active]);
    await app.get(NotificationEvaluatorService).evaluateUser(admin.id);
    const intents = await prisma.notificationIntent.findMany({
      where: { userId: admin.id },
    });
    expect(intents.length).toBeGreaterThan(0);
    expect(
      intents.every(
        (intent) => !JSON.stringify(intent.content).includes(hidden),
      ),
    ).toBe(true);
  });
});
