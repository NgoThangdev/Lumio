import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { addCalendarDays } from '../src/inventory/stock-intelligence.js';
import { localCalendarDate } from '../src/inventory/plan-use.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Recent Household Activity HTTP (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let emails: string[];
  let householdIds: string[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => {
    emails = [];
    householdIds = [];
  });
  afterEach(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
    const trips = await prisma.shoppingTrip.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    const tripIds = trips.map((trip) => trip.id);
    await prisma.tripStockCheck.deleteMany({
      where: { tripId: { in: tripIds } },
    });
    await prisma.locationStockCheck.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.inventoryUndo.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryStateAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.shoppingEntry.deleteMany({
      where: { tripId: { in: tripIds } },
    });
    await prisma.shoppingTrip.deleteMany({ where: { id: { in: tripIds } } });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.membership.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.location.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
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
    const cookies: string | string[] = response.headers['set-cookie'];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies).split(
      ';',
    )[0];
    return { id: response.body.id as string, cookie };
  }

  async function household(cookie: string) {
    const response = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: `Activity fixture ${randomUUID()}` })
      .expect(201);
    householdIds.push(response.body.id as string);
    return response.body.id as string;
  }

  it('orders household events with real actors, Undo, trip completion, and corrections', async () => {
    const owner = await register();
    const member = await register();
    const outsider = await register();
    const householdId = await household(owner.cookie);
    const otherHouseholdId = await household(outsider.cookie);
    await prisma.membership.create({
      data: { householdId, userId: member.id, role: 'MEMBER' },
    });
    const quantity = await prisma.inventoryItem.create({
      data: { householdId, name: 'Milk', primaryUnit: 'box' },
    });
    const state = await prisma.inventoryItem.create({
      data: {
        householdId,
        name: 'Soap',
        primaryUnit: 'bottle',
        trackingMode: 'FIVE_LEVEL',
        currentLevel: 'HALF',
        backupCount: 1,
      },
    });
    const foreign = await prisma.inventoryItem.create({
      data: {
        householdId: otherHouseholdId,
        name: 'Foreign',
        primaryUnit: 'box',
      },
    });
    const location = await prisma.location.create({
      data: { householdId, name: 'Shelf', nameKey: `shelf-${randomUUID()}` },
    });
    const now = Date.now();
    const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000);
    const use = await prisma.inventoryAction.create({
      data: {
        householdId,
        itemId: quantity.id,
        userId: owner.id,
        type: 'USE',
        quantity: '2',
        createdAt: at(60),
      },
    });
    await prisma.inventoryUndo.create({
      data: {
        householdId,
        itemId: quantity.id,
        userId: owner.id,
        inventoryActionId: use.id,
        postStockRevision: 1,
        createdAt: at(30),
      },
    });
    await prisma.inventoryStateAction.create({
      data: {
        householdId,
        itemId: state.id,
        userId: member.id,
        type: 'UPDATE_LEVEL',
        beforeLevel: 'FULL',
        afterLevel: 'HALF',
        beforeBackupCount: 1,
        afterBackupCount: 1,
        createdAt: at(50),
      },
    });
    await prisma.inventoryAction.create({
      data: {
        householdId: otherHouseholdId,
        itemId: foreign.id,
        userId: outsider.id,
        type: 'RESTOCK',
        quantity: '99',
        createdAt: at(1),
      },
    });
    const foreignTrip = await prisma.shoppingTrip.create({
      data: {
        householdId: otherHouseholdId,
        createdByUserId: outsider.id,
        completedByUserId: outsider.id,
        store: 'Elsewhere',
        plannedDate: at(5),
        status: 'RESTOCKED',
        completedAt: at(5),
      },
    });
    const createdTrip = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/trips`)
      .set('Cookie', owner.cookie)
      .send({
        store: 'Market',
        plannedDate: addCalendarDays(localCalendarDate(new Date()), 7),
      })
      .expect(201);
    const tripId = createdTrip.body.id as string;
    const tripUrl = `/api/households/${householdId}/trips/${tripId}`;
    await request(app.getHttpServer())
      .post(`${tripUrl}/start`)
      .set('Cookie', owner.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .post(`${tripUrl}/finish`)
      .set('Cookie', member.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .post(`${tripUrl}/finish`)
      .set('Cookie', owner.cookie)
      .expect(201);
    const trip = await prisma.shoppingTrip.update({
      where: { id: tripId },
      data: { completedAt: at(40) },
    });
    expect(trip.createdByUserId).toBe(owner.id);
    expect(trip.completedByUserId).toBe(member.id);
    await prisma.tripStockCheck.create({
      data: {
        tripId: trip.id,
        itemId: quantity.id,
        userId: member.id,
        decision: 'CORRECT',
        revision: 1,
        checkedAt: at(20),
        history: [
          {
            decision: 'CORRECT',
            userId: member.id,
            checkedAt: at(20).toISOString(),
            before: { quantity: '4' },
            after: { quantity: '3' },
          },
        ],
      },
    });
    await prisma.locationStockCheck.create({
      data: {
        householdId,
        locationId: location.id,
        itemId: quantity.id,
        userId: owner.id,
        decision: 'CORRECT',
        revision: 1,
        checkedAt: at(10),
        history: [
          {
            decision: 'CORRECT',
            userId: owner.id,
            checkedAt: at(10).toISOString(),
            before: { quantity: '3' },
            after: { quantity: '2' },
          },
        ],
      },
    });

    const url = `/api/households/${householdId}/home/activity`;
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer())
      .get(url)
      .set('Cookie', outsider.cookie)
      .expect(403);
    const response = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', member.cookie)
      .expect(200);
    const events = response.body.items as Array<Record<string, unknown>>;
    expect(events.map((event) => event.type)).toEqual([
      'LOCATION_STOCK_CORRECTED',
      'TRIP_STOCK_CORRECTED',
      'UNDO',
      'SHOPPING_TRIP_COMPLETED',
      'UPDATE_LEVEL',
      'USE',
    ]);
    expect(
      events.every(
        (event) => (event.item as { id?: string } | null)?.id !== foreign.id,
      ),
    ).toBe(true);
    expect(events.every((event) => event.id !== `trip:${foreignTrip.id}`)).toBe(
      true,
    );
    expect(events.find((event) => event.type === 'USE')).toMatchObject({
      actorId: owner.id,
      quantity: '2',
      isUndone: true,
    });
    expect(events.find((event) => event.type === 'UNDO')).toMatchObject({
      actorId: owner.id,
      reversesEventId: `inventory:${use.id}`,
      reversesType: 'USE',
    });
    expect(events.find((event) => event.type === 'UPDATE_LEVEL')).toMatchObject(
      {
        actorId: member.id,
        change: {
          before: { currentLevel: 'FULL' },
          after: { currentLevel: 'HALF' },
        },
      },
    );
    expect(
      events.find((event) => event.type === 'SHOPPING_TRIP_COMPLETED'),
    ).toMatchObject({
      actorId: member.id,
      trip: { id: trip.id, store: 'Market' },
    });
    expect(
      events.find((event) => event.type === 'TRIP_STOCK_CORRECTED'),
    ).toMatchObject({
      actorId: member.id,
      change: { before: { quantity: '4' }, after: { quantity: '3' } },
    });
    expect(
      events.find((event) => event.type === 'LOCATION_STOCK_CORRECTED'),
    ).toMatchObject({
      actorId: owner.id,
      location: { id: location.id, name: 'Shelf' },
    });
  });

  it('leaves historical trip completion unattributed', async () => {
    const owner = await register();
    const householdId = await household(owner.cookie);
    const trip = await prisma.shoppingTrip.create({
      data: {
        householdId,
        createdByUserId: owner.id,
        store: 'Legacy market',
        plannedDate: new Date(),
        status: 'RESTOCKED',
        completedAt: new Date(),
      },
    });
    const response = await request(app.getHttpServer())
      .get(`/api/households/${householdId}/home/activity`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(response.body.items).toContainEqual(
      expect.objectContaining({
        id: `trip:${trip.id}`,
        type: 'SHOPPING_TRIP_COMPLETED',
        actorId: null,
      }),
    );
  });
});
