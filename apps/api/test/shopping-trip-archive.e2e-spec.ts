import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Shopping Trip archive (database; pending migration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const users: string[] = [];
  const homes: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.tripStockCheck.deleteMany({
      where: { trip: { householdId: { in: homes } } },
    });
    await prisma.shoppingEntry.deleteMany({
      where: { trip: { householdId: { in: homes } } },
    });
    await prisma.shoppingTrip.deleteMany({
      where: { householdId: { in: homes } },
    });
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: homes } },
      select: { id: true },
    });
    const itemIds = items.map(({ id }) => id);
    await prisma.actionBatchAllocation.deleteMany({
      where: { action: { householdId: { in: homes } } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { householdId: { in: homes } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.membership.deleteMany({
      where: { householdId: { in: homes } },
    });
    await prisma.household.deleteMany({ where: { id: { in: homes } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  });

  async function fixture() {
    const registration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: randomUUID() + '@example.invalid',
        password: 'fixture-password-123',
      })
      .expect(201);
    const userId = registration.body.id as string;
    users.push(userId);
    const cookies = registration.headers['set-cookie'] as string | string[];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies).split(
      ';',
    )[0];
    const home = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: 'Trip archive fixture ' + randomUUID() })
      .expect(201);
    homes.push(home.body.id as string);
    return { userId, cookie, householdId: home.body.id as string };
  }

  async function trip(
    home: { userId: string; householdId: string },
    status: 'DRAFT' | 'SHOPPING' | 'RESTOCKED',
  ) {
    return prisma.shoppingTrip.create({
      data: {
        householdId: home.householdId,
        createdByUserId: home.userId,
        store: 'Fixture market',
        plannedDate: new Date('2026-10-30T00:00:00.000Z'),
        status,
        ...(status === 'RESTOCKED'
          ? { completedAt: new Date(), completedByUserId: home.userId }
          : {}),
      },
    });
  }

  it.each(['DRAFT', 'SHOPPING', 'RESTOCKED'] as const)(
    'archives and restores %s without changing status or history',
    async (status) => {
      const home = await fixture();
      const row = await trip(home, status);
      const item = await prisma.inventoryItem.create({
        data: {
          householdId: home.householdId,
          name: 'Beans',
          primaryUnit: 'can',
        },
      });
      const entry = await prisma.shoppingEntry.create({
        data: {
          tripId: row.id,
          itemId: item.id,
          source: 'MANUAL',
          priority: 'OPTIONAL',
          status: status === 'RESTOCKED' ? 'PURCHASED' : 'PENDING',
          ...(status === 'RESTOCKED' ? { actualQuantity: '2' } : {}),
        },
      });
      const batch =
        status === 'RESTOCKED'
          ? await prisma.stockBatch.create({
              data: { itemId: item.id, quantity: '2' },
            })
          : null;
      const action =
        status === 'RESTOCKED'
          ? await prisma.inventoryAction.create({
              data: {
                householdId: home.householdId,
                itemId: item.id,
                userId: home.userId,
                type: 'RESTOCK',
                quantity: '2',
                postStockRevision: 1,
              },
            })
          : null;
      if (batch && action)
        await prisma.actionBatchAllocation.create({
          data: {
            actionId: action.id,
            batchId: batch.id,
            quantity: '2',
            quantityAfter: '2',
          },
        });
      if (status === 'DRAFT')
        await prisma.tripStockCheck.create({
          data: {
            tripId: row.id,
            itemId: item.id,
            userId: home.userId,
            revision: 0,
            decision: 'CORRECT',
            checkedAt: new Date(),
            before: { quantity: '12' },
            after: { quantity: '8' },
          },
        });
      const base = `/api/households/${home.householdId}/trips`;
      const archived = await request(app.getHttpServer())
        .delete(`${base}/${row.id}`)
        .set('Cookie', home.cookie)
        .expect(200);
      expect(archived.body).toMatchObject({
        id: row.id,
        status,
        archivedByUserId: home.userId,
      });
      expect(archived.body.archivedAt).toBeTruthy();
      if (status === 'RESTOCKED') {
        expect(archived.body.completedByUserId).toBe(home.userId);
        expect(new Date(archived.body.completedAt).toISOString()).toBe(
          row.completedAt?.toISOString(),
        );
      }
      await request(app.getHttpServer())
        .delete(`${base}/${row.id}`)
        .set('Cookie', home.cookie)
        .expect(200)
        .expect(({ body }) =>
          expect(body.archivedAt).toBe(archived.body.archivedAt),
        );
      const normal = await request(app.getHttpServer())
        .get(base)
        .set('Cookie', home.cookie)
        .expect(200);
      expect(
        normal.body.some((trip: { id: string }) => trip.id === row.id),
      ).toBe(false);
      const hidden = await request(app.getHttpServer())
        .get(`${base}/archived`)
        .set('Cookie', home.cookie)
        .expect(200);
      expect(
        hidden.body.some((trip: { id: string }) => trip.id === row.id),
      ).toBe(true);
      await request(app.getHttpServer())
        .get(`${base}/${row.id}`)
        .set('Cookie', home.cookie)
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${row.id}/finish`)
        .set('Cookie', home.cookie)
        .expect(409);
      await request(app.getHttpServer())
        .post(`${base}/${row.id}/entries`)
        .set('Cookie', home.cookie)
        .send({ itemId: item.id })
        .expect(409);
      if (status === 'DRAFT') {
        await request(app.getHttpServer())
          .post(`${base}/${row.id}/start`)
          .set('Cookie', home.cookie)
          .expect(409);
        await request(app.getHttpServer())
          .post(`${base}/${row.id}/suggestions`)
          .set('Cookie', home.cookie)
          .expect(409);
        await request(app.getHttpServer())
          .get(`${base}/${row.id}/stock-check`)
          .set('Cookie', home.cookie)
          .expect(409);
        await request(app.getHttpServer())
          .put(`${base}/${row.id}/stock-check/${item.id}`)
          .set('Cookie', home.cookie)
          .send({ decision: 'CONFIRM', expectedRevision: 0 })
          .expect(409);
      }
      if (status === 'SHOPPING') {
        await request(app.getHttpServer())
          .patch(`${base}/${row.id}/entries/${entry.id}`)
          .set('Cookie', home.cookie)
          .send({ status: 'SKIPPED' })
          .expect(409);
      }
      expect(
        await prisma.shoppingEntry.findUnique({ where: { id: entry.id } }),
      ).not.toBeNull();
      if (batch)
        expect(
          (
            await prisma.stockBatch.findUnique({ where: { id: batch.id } })
          )?.quantity.toString(),
        ).toBe('2');
      if (action)
        expect(
          await prisma.inventoryAction.findUnique({ where: { id: action.id } }),
        ).not.toBeNull();
      if (status === 'DRAFT')
        expect(
          await prisma.tripStockCheck.count({ where: { tripId: row.id } }),
        ).toBe(1);
      const restored = await request(app.getHttpServer())
        .post(`${base}/${row.id}/restore`)
        .set('Cookie', home.cookie)
        .expect(201);
      expect(restored.body).toMatchObject({
        id: row.id,
        status,
        archivedAt: null,
        archivedByUserId: null,
      });
    },
  );

  it('rejects an active MOVED destination and isolates households', async () => {
    const home = await fixture();
    const outsider = await fixture();
    const destination = await trip(home, 'DRAFT');
    const source = await trip(home, 'SHOPPING');
    const item = await prisma.inventoryItem.create({
      data: { householdId: home.householdId, name: 'Rice', primaryUnit: 'bag' },
    });
    await prisma.shoppingEntry.create({
      data: {
        tripId: source.id,
        itemId: item.id,
        source: 'MANUAL',
        priority: 'OPTIONAL',
        status: 'MOVED',
        moveToTripId: destination.id,
      },
    });
    const url = `/api/households/${home.householdId}/trips/${destination.id}`;
    await request(app.getHttpServer())
      .delete(url)
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .delete(url)
      .set('Cookie', home.cookie)
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('TRIP_MOVE_DESTINATION_IN_USE'),
      );
    expect(
      (await prisma.shoppingTrip.findUnique({ where: { id: destination.id } }))
        ?.archivedAt,
    ).toBeNull();
  });

  it('serializes Move against Archive on the destination trip', async () => {
    const home = await fixture();
    const destination = await trip(home, 'DRAFT');
    const source = await trip(home, 'SHOPPING');
    const item = await prisma.inventoryItem.create({
      data: { householdId: home.householdId, name: 'Oats', primaryUnit: 'box' },
    });
    const entry = await prisma.shoppingEntry.create({
      data: {
        tripId: source.id,
        itemId: item.id,
        source: 'MANUAL',
        priority: 'OPTIONAL',
        status: 'PENDING',
      },
    });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "ShoppingTrip" WHERE "id" = $1 FOR UPDATE',
          destination.id,
        );
        locked();
        await hold;
      },
      { timeout: 15000 },
    );
    await ready;
    const base = `/api/households/${home.householdId}/trips`;
    const move = request(app.getHttpServer())
      .patch(`${base}/${source.id}/entries/${entry.id}`)
      .set('Cookie', home.cookie)
      .send({ status: 'MOVED', destinationTripId: destination.id })
      .then((response) => response);
    const archive = request(app.getHttpServer())
      .delete(`${base}/${destination.id}`)
      .set('Cookie', home.cookie)
      .then((response) => response);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      release();
    }
    await blocker;
    const [moveResult, archiveResult] = await Promise.all([move, archive]);
    expect(
      [moveResult.status, archiveResult.status].sort((a, b) => a - b),
    ).toEqual([200, 409]);
    const currentDestination = await prisma.shoppingTrip.findUniqueOrThrow({
      where: { id: destination.id },
    });
    const currentEntry = await prisma.shoppingEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(
      Boolean(currentDestination.archivedAt && currentEntry.status === 'MOVED'),
    ).toBe(false);
  });
});
