import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { tokenHash } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Item Detail stock correction (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const householdIds: string[] = [];
  const userIds: string[] = [];

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
    const itemIds = items.map((item) => item.id);
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true },
    });
    const trips = await prisma.shoppingTrip.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    await prisma.locationStockCheck.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.shoppingEntry.deleteMany({
      where: { tripId: { in: trips.map((trip) => trip.id) } },
    });
    await prisma.shoppingTrip.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.actionBatchAllocation.deleteMany({
      where: { actionId: { in: actions.map((action) => action.id) } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryStateAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.category.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.location.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.membership.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.household.deleteMany({
      where: { id: { in: householdIds } },
    });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  async function fixture() {
    const userId = randomUUID();
    const householdId = randomUUID();
    const token = randomBytes(32).toString('hex');
    userIds.push(userId);
    householdIds.push(householdId);
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.invalid`,
        passwordHash: 'fixture',
      },
    });
    await prisma.household.create({
      data: { id: householdId, name: 'Item correction fixture' },
    });
    await prisma.membership.create({
      data: { userId, householdId, role: 'MEMBER' },
    });
    await prisma.userSession.create({
      data: {
        userId,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    const category = await prisma.category.create({
      data: { householdId, name: 'Fixture', nameKey: randomUUID() },
    });
    const location = await prisma.location.create({
      data: { householdId, name: 'Shelf', nameKey: randomUUID() },
    });
    const other = await prisma.location.create({
      data: { householdId, name: 'Pantry', nameKey: randomUUID() },
    });
    return {
      userId,
      householdId,
      categoryId: category.id,
      locationId: location.id,
      otherLocationId: other.id,
      cookie: `lumio_session=${token}`,
    };
  }

  async function addItem(
    scope: Awaited<ReturnType<typeof fixture>>,
    name: string,
    trackingMode: 'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP',
    initialStock: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .post(`/api/households/${scope.householdId}/items`)
      .set('Cookie', scope.cookie)
      .send({
        name,
        primaryUnit: 'piece',
        trackingMode,
        categoryId: scope.categoryId,
        locationId: scope.locationId,
        tagIds: [],
        initialStock,
      })
      .expect(201);
  }

  function correctionUrl(
    scope: Awaited<ReturnType<typeof fixture>>,
    itemId: string,
  ) {
    return `/api/households/${scope.householdId}/locations/${scope.locationId}/stock-check/${itemId}`;
  }

  it('corrects Add Item 12 to 8 after a fresh read without rewriting initial stock or shopping snapshots', async () => {
    const f = await fixture();
    const created = await addItem(f, 'Eggs', 'QUANTITY', { quantity: '12' });
    const itemId = created.body.id as string;
    const trip = await prisma.shoppingTrip.create({
      data: {
        householdId: f.householdId,
        createdByUserId: f.userId,
        store: 'Fixture store',
        plannedDate: new Date('2026-10-24T00:00:00.000Z'),
        suggestionsImportedAt: new Date(),
      },
    });
    await prisma.shoppingEntry.create({
      data: {
        tripId: trip.id,
        itemId,
        status: 'PENDING',
        source: 'SUGGESTED',
        priority: 'MUST_BUY',
        suggestedQuantity: '5',
        suggestedReason: 'Original snapshot',
      },
    });
    const before = await request(app.getHttpServer())
      .get(`/api/households/${f.householdId}/items/${itemId}`)
      .set('Cookie', f.cookie)
      .expect(200);
    expect(before.body.batches[0].quantity).toBe('12');
    expect(before.body.stockRevision).toBe(1);

    const saved = await request(app.getHttpServer())
      .put(correctionUrl(f, itemId))
      .set('Cookie', f.cookie)
      .send({ decision: 'CORRECT', expectedRevision: 1, quantity: '8' })
      .expect(200);
    expect(saved.body).toMatchObject({
      changed: true,
      item: { stockRevision: 2, stock: { quantity: '8' } },
    });
    const reloaded = await request(app.getHttpServer())
      .get(`/api/households/${f.householdId}/items/${itemId}`)
      .set('Cookie', f.cookie)
      .expect(200);
    expect(reloaded.body.batches[0].quantity).toBe('8');
    expect(reloaded.body.actions).toMatchObject([
      { type: 'INITIAL_STOCK', quantity: '12' },
    ]);
    expect(reloaded.body.actions[0].allocations[0].quantity).toBe('12');
    expect(reloaded.body.locationStockChecks[0].history[0]).toMatchObject({
      decision: 'CORRECT',
      userId: f.userId,
      before: { quantity: '12' },
      after: { quantity: '8' },
    });
    expect(
      reloaded.body.locationStockChecks[0].history[0].before.batches[0],
    ).toMatchObject({
      quantity: '12',
    });
    expect(
      reloaded.body.locationStockChecks[0].history[0].after.batches[0],
    ).toMatchObject({
      quantity: '8',
    });
    expect(
      await prisma.inventoryAction.count({
        where: { itemId, type: { in: ['USE', 'RESTOCK'] } },
      }),
    ).toBe(0);
    const assessed = await request(app.getHttpServer())
      .get(`/api/households/${f.householdId}/stock-intelligence`)
      .set('Cookie', f.cookie)
      .expect(200);
    expect(assessed.body.assessments[0].physicalStock).toBe('8');
    expect(assessed.body.assessments[0].prediction.usedIn14Days).toBe('0');
    const snapshot = await request(app.getHttpServer())
      .get(`/api/households/${f.householdId}/trips/${trip.id}`)
      .set('Cookie', f.cookie)
      .expect(200);
    expect(snapshot.body.entries[0]).toMatchObject({
      suggestedQuantity: '5',
      suggestedReason: 'Original snapshot',
    });
  });

  it('creates observed stock from zero and corrects both state modes, including fewer backups', async () => {
    const f = await fixture();
    const zero = await addItem(f, 'Empty shelf', 'QUANTITY', { quantity: '0' });
    const zeroId = zero.body.id as string;
    expect(zero.body.actions).toHaveLength(0);
    const listed = await request(app.getHttpServer())
      .get(
        `/api/households/${f.householdId}/locations/${f.locationId}/stock-check`,
      )
      .set('Cookie', f.cookie)
      .expect(200);
    expect(
      listed.body.items.find(
        (item: { itemId: string }) => item.itemId === zeroId,
      ),
    ).toMatchObject({
      stockRevision: 0,
      stock: { quantity: '0', batches: [] },
    });
    await request(app.getHttpServer())
      .put(correctionUrl(f, zeroId))
      .set('Cookie', f.cookie)
      .send({ decision: 'CORRECT', expectedRevision: 0, quantity: '4' })
      .expect(200);
    const zeroReloaded = await request(app.getHttpServer())
      .get(`/api/households/${f.householdId}/items/${zeroId}`)
      .set('Cookie', f.cookie)
      .expect(200);
    expect(zeroReloaded.body.batches).toMatchObject([
      { quantity: '4', locationId: f.locationId },
    ]);
    expect(zeroReloaded.body.actions).toHaveLength(0);
    expect(zeroReloaded.body.locationStockChecks[0].history[0]).toMatchObject({
      userId: f.userId,
      before: { quantity: '0', batches: [] },
      after: { quantity: '4' },
    });

    const level = await addItem(f, 'Level item', 'FIVE_LEVEL', {
      level: 'FULL',
      backupCount: 3,
    });
    const presence = await addItem(f, 'Presence item', 'PRESENCE_BACKUP', {
      present: true,
      backupCount: 2,
    });
    await request(app.getHttpServer())
      .put(correctionUrl(f, level.body.id))
      .set('Cookie', f.cookie)
      .send({
        decision: 'CORRECT',
        expectedRevision: 0,
        currentLevel: 'INVALID',
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(correctionUrl(f, presence.body.id))
      .set('Cookie', f.cookie)
      .send({ decision: 'CORRECT', expectedRevision: 0, backupCount: -1 })
      .expect(400);
    expect(
      await prisma.locationStockCheck.count({
        where: { itemId: { in: [level.body.id, presence.body.id] } },
      }),
    ).toBe(0);
    await request(app.getHttpServer())
      .put(correctionUrl(f, level.body.id))
      .set('Cookie', f.cookie)
      .send({
        decision: 'CORRECT',
        expectedRevision: 0,
        currentLevel: 'HALF',
        backupCount: 1,
      })
      .expect(200);
    await request(app.getHttpServer())
      .put(correctionUrl(f, presence.body.id))
      .set('Cookie', f.cookie)
      .send({
        decision: 'CORRECT',
        expectedRevision: 0,
        isPresent: false,
        backupCount: 0,
      })
      .expect(200);
    const [levelRead, presenceRead] = await Promise.all(
      [level.body.id, presence.body.id].map((id: string) =>
        request(app.getHttpServer())
          .get(`/api/households/${f.householdId}/items/${id}`)
          .set('Cookie', f.cookie)
          .expect(200),
      ),
    );
    expect(levelRead.body).toMatchObject({
      currentLevel: 'HALF',
      backupCount: 1,
    });
    expect(levelRead.body.stateActions[0]).toMatchObject({
      type: 'INITIALIZE',
      afterBackupCount: 3,
    });
    expect(levelRead.body.locationStockChecks[0].history[0]).toMatchObject({
      userId: f.userId,
      before: { currentLevel: 'FULL', backupCount: 3 },
      after: { currentLevel: 'HALF', backupCount: 1 },
    });
    expect(presenceRead.body).toMatchObject({
      isPresent: false,
      backupCount: 0,
    });
    expect(presenceRead.body.stateActions[0]).toMatchObject({
      type: 'INITIALIZE',
      afterBackupCount: 2,
    });
    expect(presenceRead.body.locationStockChecks[0].history[0]).toMatchObject({
      userId: f.userId,
      before: { isPresent: true, backupCount: 2 },
      after: { isPresent: false, backupCount: 0 },
    });
  });

  it('rejects invalid, foreign, stale, and racing corrections without partial history', async () => {
    const f = await fixture();
    const foreign = await fixture();
    const created = await addItem(f, 'Shared stock', 'QUANTITY', {
      quantity: '12',
    });
    const itemId = created.body.id as string;
    const elsewhere = await prisma.stockBatch.create({
      data: { itemId, locationId: f.otherLocationId, quantity: '7' },
    });
    const url = correctionUrl(f, itemId);
    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', foreign.cookie)
      .send({ decision: 'CORRECT', expectedRevision: 1, quantity: '8' })
      .expect(403);
    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', f.cookie)
      .send({ decision: 'CORRECT', expectedRevision: 1, quantity: '-1' })
      .expect(400);
    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', f.cookie)
      .send({ decision: 'CORRECT', expectedRevision: 1, quantity: '1.1234567' })
      .expect(400);
    await request(app.getHttpServer())
      .put(url)
      .set('Cookie', f.cookie)
      .send({ decision: 'CORRECT', expectedRevision: 0, quantity: '8' })
      .expect(409);
    expect(await prisma.locationStockCheck.count({ where: { itemId } })).toBe(
      0,
    );
    const responses = await Promise.all([
      request(app.getHttpServer())
        .put(url)
        .set('Cookie', f.cookie)
        .send({ decision: 'CORRECT', expectedRevision: 1, quantity: '8' }),
      request(app.getHttpServer())
        .put(url)
        .set('Cookie', f.cookie)
        .send({ decision: 'CORRECT', expectedRevision: 1, quantity: '7' }),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([200, 409]);
    const check = await prisma.locationStockCheck.findUniqueOrThrow({
      where: { locationId_itemId: { locationId: f.locationId, itemId } },
    });
    expect(check.history).toHaveLength(1);
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({
          where: { id: elsewhere.id },
        })
      ).quantity.toString(),
    ).toBe('7');
    expect(
      (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } }))
        .stockRevision,
    ).toBe(2);

    const packages = await prisma.inventoryItem.create({
      data: {
        householdId: f.householdId,
        name: 'Whole packages',
        primaryUnit: 'box',
        trackingMode: 'QUANTITY',
        openedTrackingEnabled: true,
        preferredRestockLocationId: f.locationId,
      },
    });
    await prisma.stockBatch.create({
      data: { itemId: packages.id, locationId: f.locationId, quantity: '2' },
    });
    await request(app.getHttpServer())
      .put(correctionUrl(f, packages.id))
      .set('Cookie', f.cookie)
      .send({ decision: 'CORRECT', expectedRevision: 0, quantity: '1.5' })
      .expect(400);
    expect(
      await prisma.locationStockCheck.count({ where: { itemId: packages.id } }),
    ).toBe(0);
  });
});
