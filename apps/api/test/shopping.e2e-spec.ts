import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { InventoryStateService } from '../src/inventory/inventory-state.service.js';
import { StockIntelligenceService } from '../src/inventory/stock-intelligence.service.js';
import { addCalendarDays } from '../src/inventory/stock-intelligence.js';
import { localCalendarDate } from '../src/inventory/plan-use.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Shopping Trip HTTP flow (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let state: InventoryStateService;
  let emails: string[];
  let householdIds: string[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    inventory = app.get(InventoryService);
    state = app.get(InventoryStateService);
  });
  beforeEach(() => {
    emails = [];
    householdIds = [];
  });
  afterEach(async () => {
    vi.restoreAllMocks();
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
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true },
    });
    const trips = await prisma.shoppingTrip.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    await prisma.actionBatchAllocation.deleteMany({
      where: { actionId: { in: actions.map((action) => action.id) } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryStateAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.shoppingEntry.deleteMany({
      where: { tripId: { in: trips.map((trip) => trip.id) } },
    });
    await prisma.shoppingTrip.deleteMany({
      where: { id: { in: trips.map((trip) => trip.id) } },
    });
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
    expect(
      await prisma.shoppingTrip.count({
        where: { id: { in: trips.map((trip) => trip.id) } },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryItem.count({ where: { id: { in: itemIds } } }),
    ).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: userIds } } })).toBe(0);
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
    return { cookie, id: response.body.id as string };
  }
  async function household(cookie: string) {
    const response = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: `Shopping fixture ${randomUUID()}` })
      .expect(201);
    householdIds.push(response.body.id as string);
    return response.body.id as string;
  }
  async function item(
    cookie: string,
    householdId: string,
    name: string,
    trackingMode?: 'FIVE_LEVEL' | 'PRESENCE_BACKUP',
  ) {
    const response = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/items`)
      .set('Cookie', cookie)
      .send({ name, primaryUnit: 'box', trackingMode })
      .expect(201);
    if (!trackingMode) {
      const location = await prisma.location.create({
        data: { householdId, name: 'Fixture shelf', nameKey: randomUUID() },
      });
      await prisma.inventoryItem.update({
        where: { id: response.body.id as string },
        data: { preferredRestockLocationId: location.id },
      });
    }
    return response.body.id as string;
  }
  async function trip(cookie: string, householdId: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/trips`)
      .set('Cookie', cookie)
      .send({
        store: 'Winmart',
        plannedDate: addCalendarDays(localCalendarDate(new Date()), 7),
      })
      .expect(201);
    return response.body.id as string;
  }
  async function decide(
    cookie: string,
    base: string,
    entryId: string,
    status: string,
    quantity?: string,
  ) {
    return request(app.getHttpServer())
      .patch(`${base}/entries/${entryId}`)
      .set('Cookie', cookie)
      .send({ status, actualQuantity: quantity })
      .expect(200);
  }

  it('imports purchasable whole-package gaps for normal and skipped Optional suggestions', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const normal = await item(actor.cookie, householdId, 'Normal package');
    const optional = await item(actor.cookie, householdId, 'Skipped package');
    const whole = await item(actor.cookie, householdId, 'Whole package gap');
    const ordinary = await item(
      actor.cookie,
      householdId,
      'Fractional ordinary',
    );
    for (const itemId of [normal, optional, whole]) {
      await request(app.getHttpServer())
        .put(`/api/households/${householdId}/items/${itemId}/opening-config`)
        .set('Cookie', actor.cookie)
        .send({
          enabled: true,
          recommendedDaysAfterOpening: null,
          packageCountConfirmed: true,
        })
        .expect(200);
    }
    for (const [itemId, buyThreshold] of [
      [normal, '1.5'],
      [optional, '1'],
      [whole, '1'],
      [ordinary, '1.5'],
    ]) {
      await request(app.getHttpServer())
        .put(`/api/households/${householdId}/items/${itemId}/config`)
        .set('Cookie', actor.cookie)
        .send({
          minimumStock: null,
          buyThreshold,
          lowStockThreshold: null,
          targetStock: '2',
          neverRunOut: false,
          predictionEnabled: false,
        })
        .expect(200);
    }
    const openedAt = new Date();
    await prisma.stockBatch.createMany({
      data: [
        { itemId: normal, quantity: '1' },
        { itemId: normal, quantity: '0.5', openedAt },
        { itemId: optional, quantity: '1' },
        { itemId: optional, quantity: '0.5', openedAt },
        { itemId: whole, quantity: '1' },
        { itemId: ordinary, quantity: '1.5' },
      ],
    });
    const sourceId = await trip(actor.cookie, householdId);
    const sourceBase = `/api/households/${householdId}/trips/${sourceId}`;
    await request(app.getHttpServer())
      .post(`${sourceBase}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: optional })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${sourceBase}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .post(`${sourceBase}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);

    const destId = await trip(actor.cookie, householdId);
    const imported = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/trips/${destId}/suggestions`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const entry = (itemId: string) =>
      imported.body.entries.find(
        (value: { itemId: string }) => value.itemId === itemId,
      );
    expect(entry(normal)).toMatchObject({
      priority: 'SHOULD_BUY',
      suggestedQuantity: '1',
    });
    expect(entry(normal).suggestedReason).toContain(
      'Buy 1 box to meet or exceed the target of 2.',
    );
    expect(entry(optional)).toMatchObject({
      priority: 'OPTIONAL',
      suggestedQuantity: '1',
    });
    expect(entry(optional).suggestedReason).toContain(
      'Skipped on the previous trip. Buy 1 box to meet or exceed the target of 2.',
    );
    expect(entry(whole)).toMatchObject({ suggestedQuantity: '1' });
    expect(entry(ordinary)).toMatchObject({ suggestedQuantity: '0.5' });
    expect(entry(ordinary).suggestedReason).toContain(
      'Buy 0.5 box to reach the target of 2.',
    );
  });

  it('reassesses the previous trip skips across all modes and preserves an existing manual entry', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const optional = await item(actor.cookie, householdId, 'Optional boxes');
    const normal = await item(actor.cookie, householdId, 'Urgent boxes');
    const recovered = await item(actor.cookie, householdId, 'Recovered boxes');
    const untargeted = await item(
      actor.cookie,
      householdId,
      'Untargeted boxes',
    );
    const five = await item(actor.cookie, householdId, 'Refill', 'FIVE_LEVEL');
    const presence = await item(
      actor.cookie,
      householdId,
      'Spare',
      'PRESENCE_BACKUP',
    );
    const manualPresence = await item(
      actor.cookie,
      householdId,
      'Manual spare',
      'PRESENCE_BACKUP',
    );
    for (const [itemId, targetStock] of [
      [optional, '10'],
      [normal, '4'],
      [recovered, '5'],
      [untargeted, null],
    ]) {
      await request(app.getHttpServer())
        .put(`/api/households/${householdId}/items/${itemId}/config`)
        .set('Cookie', actor.cookie)
        .send({
          minimumStock: null,
          buyThreshold: '1',
          lowStockThreshold: null,
          targetStock,
          neverRunOut: false,
          predictionEnabled: false,
        })
        .expect(200);
    }
    for (const [itemId, quantity] of [
      [optional, '6'],
      [recovered, '5'],
      [untargeted, '1'],
    ]) {
      await request(app.getHttpServer())
        .post(`/api/households/${householdId}/items/${itemId}/restock`)
        .set('Cookie', actor.cookie)
        .send({ quantity })
        .expect(201);
    }
    const sourceId = await trip(actor.cookie, householdId);
    const sourceBase = `/api/households/${householdId}/trips/${sourceId}`;
    for (const itemId of [
      optional,
      normal,
      recovered,
      untargeted,
      five,
      presence,
      manualPresence,
    ]) {
      await request(app.getHttpServer())
        .post(`${sourceBase}/entries`)
        .set('Cookie', actor.cookie)
        .send({ itemId })
        .expect(201);
    }
    const started = await request(app.getHttpServer())
      .post(`${sourceBase}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    for (const entry of started.body.entries.filter(
      (entry: { itemId: string }) => entry.itemId !== manualPresence,
    )) {
      await decide(actor.cookie, sourceBase, entry.id, 'SKIPPED');
    }
    const finished = await request(app.getHttpServer())
      .post(`${sourceBase}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(
      finished.body.entries.find(
        (entry: { itemId: string }) => entry.itemId === manualPresence,
      ).status,
    ).toBe('SKIPPED');

    const destId = await trip(actor.cookie, householdId);
    const destBase = `/api/households/${householdId}/trips/${destId}`;
    await request(app.getHttpServer())
      .post(`${destBase}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: manualPresence })
      .expect(201);
    const imported = await request(app.getHttpServer())
      .post(`${destBase}/suggestions`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const byId = new Map<
      string,
      {
        source: string;
        priority: string;
        suggestedQuantity: string | null;
        suggestedReason: string | null;
      }
    >(
      imported.body.entries.map(
        (entry: {
          itemId: string;
          source: string;
          priority: string;
          suggestedQuantity: string | null;
          suggestedReason: string | null;
        }) => [entry.itemId, entry],
      ),
    );
    expect(byId.get(optional)).toMatchObject({
      source: 'SUGGESTED',
      priority: 'OPTIONAL',
      suggestedQuantity: '4',
    });
    expect(byId.get(optional)?.suggestedReason).toContain(
      'Skipped on the previous trip.',
    );
    expect(byId.get(normal)).toMatchObject({
      priority: 'MUST_BUY',
      suggestedQuantity: '4',
    });
    expect(byId.get(normal)?.suggestedReason).toContain(
      'Skipped on the previous trip.',
    );
    expect(byId.get(five)).toMatchObject({
      priority: 'MUST_BUY',
      suggestedQuantity: null,
    });
    expect(byId.get(five)?.suggestedReason).toContain(
      'Skipped on the previous trip.',
    );
    expect(byId.get(presence)).toMatchObject({
      source: 'SUGGESTED',
      priority: 'MUST_BUY',
      suggestedQuantity: null,
    });
    expect(byId.get(presence)?.suggestedReason).toContain(
      'Skipped on the previous trip.',
    );
    expect(byId.get(manualPresence)).toMatchObject({
      source: 'MANUAL',
      priority: 'OPTIONAL',
      suggestedReason: null,
    });
    expect(byId.has(recovered)).toBe(false);
    expect(byId.has(untargeted)).toBe(false);
    expect(imported.body.entries).toHaveLength(5);
    const [repeated, concurrent] = await Promise.all([
      request(app.getHttpServer())
        .post(`${destBase}/suggestions`)
        .set('Cookie', actor.cookie)
        .expect(201),
      request(app.getHttpServer())
        .post(`${destBase}/suggestions`)
        .set('Cookie', actor.cookie)
        .expect(201),
    ]);
    expect(repeated.body.entries).toEqual(imported.body.entries);
    expect(concurrent.body.entries).toEqual(imported.body.entries);
  });

  it('uses only the latest eligible finished trip and keeps zero-entry imports one-shot', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const itemId = await item(actor.cookie, householdId, 'Skipped boxes');
    await request(app.getHttpServer())
      .put(`/api/households/${householdId}/items/${itemId}/config`)
      .set('Cookie', actor.cookie)
      .send({
        minimumStock: null,
        buyThreshold: '1',
        lowStockThreshold: null,
        targetStock: '10',
        neverRunOut: false,
        predictionEnabled: false,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/households/${householdId}/items/${itemId}/restock`)
      .set('Cookie', actor.cookie)
      .send({ quantity: '6' })
      .expect(201);
    const olderId = await trip(actor.cookie, householdId);
    const olderBase = `/api/households/${householdId}/trips/${olderId}`;
    const added = await request(app.getHttpServer())
      .post(`${olderBase}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${olderBase}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    await decide(actor.cookie, olderBase, added.body.entries[0].id, 'SKIPPED');
    await request(app.getHttpServer())
      .post(`${olderBase}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const latestId = await trip(actor.cookie, householdId);
    const latestBase = `/api/households/${householdId}/trips/${latestId}`;
    await request(app.getHttpServer())
      .post(`${latestBase}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .post(`${latestBase}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);
    await prisma.shoppingTrip.update({
      where: { id: olderId },
      data: { completedAt: new Date('2026-01-01') },
    });
    const destId = await trip(actor.cookie, householdId);
    const destBase = `/api/households/${householdId}/trips/${destId}`;
    const first = await request(app.getHttpServer())
      .post(`${destBase}/suggestions`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(first.body.entries).toHaveLength(0);
    expect(first.body.suggestionsImportedAt).toBeTruthy();
    await prisma.shoppingTrip.update({
      where: { id: latestId },
      data: {
        plannedDate: new Date(
          `${addCalendarDays(localCalendarDate(new Date()), 8)}T00:00:00.000Z`,
        ),
      },
    });
    const repeated = await request(app.getHttpServer())
      .post(`${destBase}/suggestions`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(repeated.body.entries).toHaveLength(0);
    expect(repeated.body.suggestionsImportedAt).toBe(
      first.body.suggestionsImportedAt,
    );
  });

  it('uses the committed previous-trip cutoff when Finish races with import', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const itemId = await item(actor.cookie, householdId, 'Concurrent boxes');
    await request(app.getHttpServer())
      .put(`/api/households/${householdId}/items/${itemId}/config`)
      .set('Cookie', actor.cookie)
      .send({
        minimumStock: null,
        buyThreshold: '1',
        lowStockThreshold: null,
        targetStock: '10',
        neverRunOut: false,
        predictionEnabled: false,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/households/${householdId}/items/${itemId}/restock`)
      .set('Cookie', actor.cookie)
      .send({ quantity: '6' })
      .expect(201);
    const sourceId = await trip(actor.cookie, householdId);
    const sourceBase = `/api/households/${householdId}/trips/${sourceId}`;
    await request(app.getHttpServer())
      .post(`${sourceBase}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${sourceBase}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const destId = await trip(actor.cookie, householdId);
    const destBase = `/api/households/${householdId}/trips/${destId}`;

    let reachedAssessment!: () => void;
    const assessmentReached = new Promise<void>((resolve) => {
      reachedAssessment = resolve;
    });
    let releaseAssessment!: () => void;
    const assessmentGate = new Promise<void>((resolve) => {
      releaseAssessment = resolve;
    });
    const intelligence = app.get(StockIntelligenceService);
    const original = intelligence.assessInTransaction.bind(intelligence);
    vi.spyOn(intelligence, 'assessInTransaction').mockImplementation(
      async (...args) => {
        reachedAssessment();
        await assessmentGate;
        return original(...args);
      },
    );
    const importing = request(app.getHttpServer())
      .post(`${destBase}/suggestions`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const importResult = importing.then((response) => response);
    await assessmentReached;
    try {
      await request(app.getHttpServer())
        .post(`${sourceBase}/finish`)
        .set('Cookie', actor.cookie)
        .expect(201);
    } finally {
      releaseAssessment();
    }
    const imported = await importResult;
    expect(imported.body.entries).toHaveLength(0);
    expect(imported.body.suggestionsImportedAt).toBeTruthy();
    expect(
      (await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: sourceId } }))
        .status,
    ).toBe('RESTOCKED');
  });

  it('includes opened tracking in each Trip detail entry item', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const enabledId = await item(actor.cookie, householdId, 'Opened boxes');
    const disabledId = await item(actor.cookie, householdId, 'Regular boxes');
    await request(app.getHttpServer())
      .put(`/api/households/${householdId}/items/${enabledId}/opening-config`)
      .set('Cookie', actor.cookie)
      .send({
        enabled: true,
        recommendedDaysAfterOpening: null,
        packageCountConfirmed: true,
      })
      .expect(200);
    const tripId = await trip(actor.cookie, householdId);
    const base = `/api/households/${householdId}/trips/${tripId}`;
    for (const itemId of [enabledId, disabledId]) {
      await request(app.getHttpServer())
        .post(`${base}/entries`)
        .set('Cookie', actor.cookie)
        .send({ itemId })
        .expect(201);
    }

    const detail = await request(app.getHttpServer())
      .get(base)
      .set('Cookie', actor.cookie)
      .expect(200);
    expect(detail.body.entries).toHaveLength(2);
    expect(detail.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            id: enabledId,
            trackingMode: 'QUANTITY',
            openedTrackingEnabled: true,
          }),
        }),
        expect.objectContaining({
          item: expect.objectContaining({
            id: disabledId,
            trackingMode: 'QUANTITY',
            openedTrackingEnabled: false,
          }),
        }),
      ]),
    );
  });

  it('snapshots suggestions, restocks actual 8 rather than suggested 12, and skips unpurchased items', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const milk = await item(actor.cookie, householdId, 'Milk');
    const eggs = await item(actor.cookie, householdId, 'Eggs');
    for (const [itemId, targetStock] of [
      [milk, '12'],
      [eggs, '6'],
    ]) {
      await request(app.getHttpServer())
        .put(`/api/households/${householdId}/items/${itemId}/config`)
        .set('Cookie', actor.cookie)
        .send({
          minimumStock: null,
          buyThreshold: null,
          lowStockThreshold: null,
          targetStock,
          neverRunOut: false,
          predictionEnabled: false,
        })
        .expect(200);
    }
    const tripId = await trip(actor.cookie, householdId);
    const base = `/api/households/${householdId}/trips/${tripId}`;
    const imported = await request(app.getHttpServer())
      .post(`${base}/suggestions`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(imported.body.entries).toHaveLength(2);
    const milkEntry = imported.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === milk,
    );
    const eggEntry = imported.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === eggs,
    );
    expect(milkEntry.suggestedQuantity).toBe('12');
    expect(milkEntry.actualQuantity).toBeNull();
    await request(app.getHttpServer())
      .post(`/api/households/${householdId}/items/${milk}/restock`)
      .set('Cookie', actor.cookie)
      .send({ quantity: '3' })
      .expect(201);
    const repeatedImport = await request(app.getHttpServer())
      .post(`${base}/suggestions`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(repeatedImport.body.entries).toHaveLength(2);
    expect(
      repeatedImport.body.entries.find(
        (entry: { itemId: string }) => entry.itemId === milk,
      ).suggestedQuantity,
    ).toBe('12');
    const bread = await item(actor.cookie, householdId, 'Bread');
    await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: bread })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const expiry = addCalendarDays(localCalendarDate(new Date()), 20);
    await request(app.getHttpServer())
      .patch(`${base}/entries/${milkEntry.id}`)
      .set('Cookie', actor.cookie)
      .send({ status: 'PURCHASED', actualQuantity: '8', expiryDate: expiry })
      .expect(200);
    await decide(actor.cookie, base, eggEntry.id, 'SKIPPED');
    const finished = await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(finished.body.status).toBe('RESTOCKED');
    expect(
      (await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: tripId } }))
        .completedByUserId,
    ).toBe(actor.id);
    expect(
      finished.body.entries.find(
        (entry: { itemId: string }) => entry.itemId === bread,
      ).status,
    ).toBe('SKIPPED');
    const milkBatches = await prisma.stockBatch.findMany({
      where: { itemId: milk },
    });
    expect(
      milkBatches.map((batch) => batch.quantity.toString()).sort(),
    ).toEqual(['3', '8']);
    expect(
      milkBatches
        .find((batch) => batch.quantity.toString() === '8')
        ?.expiryDate?.toISOString()
        .slice(0, 10),
    ).toBe(expiry);
    const milkActions = await prisma.inventoryAction.findMany({
      where: { itemId: milk, type: 'RESTOCK' },
      include: { allocations: true },
    });
    expect(
      milkActions.map((action) => action.quantity.toString()).sort(),
    ).toEqual(['3', '8']);
    expect(
      milkActions
        .find((action) => action.quantity.toString() === '8')
        ?.allocations[0].quantity.toString(),
    ).toBe('8');
    expect(
      milkActions.find((action) => action.quantity.toString() === '8')?.userId,
    ).toBe(actor.id);
    expect(await prisma.stockBatch.count({ where: { itemId: eggs } })).toBe(0);
    expect(
      await prisma.inventoryAction.count({ where: { itemId: eggs } }),
    ).toBe(0);
    expect(await prisma.stockBatch.count({ where: { itemId: bread } })).toBe(0);
    await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(await prisma.stockBatch.count({ where: { itemId: milk } })).toBe(2);
    expect(
      (await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: tripId } }))
        .completedByUserId,
    ).toBe(actor.id);
  });

  it('allows manual items without targets and isolates every trip operation by household', async () => {
    const owner = await register();
    const outsider = await register();
    const householdId = await household(owner.cookie);
    const itemId = await item(owner.cookie, householdId, 'Soap');
    const tripId = await trip(owner.cookie, householdId);
    const route = `/api/households/${householdId}/trips`;
    const base = `${route}/${tripId}`;
    await request(app.getHttpServer())
      .get(route)
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(base)
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(base + '/entries')
      .set('Cookie', outsider.cookie)
      .send({ itemId })
      .expect(403);
    await request(app.getHttpServer())
      .post(base + '/suggestions')
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(base + '/start')
      .set('Cookie', outsider.cookie)
      .expect(403);
    const added = await request(app.getHttpServer())
      .post(base + '/entries')
      .set('Cookie', owner.cookie)
      .send({ itemId })
      .expect(201);
    expect(added.body.entries[0]).toMatchObject({
      source: 'MANUAL',
      suggestedQuantity: null,
    });
    await request(app.getHttpServer())
      .post(base + '/start')
      .set('Cookie', owner.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${base}/entries/${added.body.entries[0].id}`)
      .set('Cookie', outsider.cookie)
      .send({ status: 'PURCHASED', actualQuantity: '2' })
      .expect(403);
    await request(app.getHttpServer())
      .post(base + '/finish')
      .set('Cookie', outsider.cookie)
      .expect(403);
    await decide(
      owner.cookie,
      base,
      added.body.entries[0].id,
      'PURCHASED',
      '2',
    );
    await request(app.getHttpServer())
      .post(base + '/finish')
      .set('Cookie', owner.cookie)
      .expect(201);
    const batches = await prisma.stockBatch.findMany({ where: { itemId } });
    expect(batches.map((batch) => batch.quantity.toString())).toEqual(['2']);
  });

  it('rolls back an intermediate Restock failure and survives concurrent Finish calls', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const first = await item(actor.cookie, householdId, 'Milk');
    const second = await item(actor.cookie, householdId, 'Eggs');
    const tripId = await trip(actor.cookie, householdId);
    const base = `/api/households/${householdId}/trips/${tripId}`;
    const one = await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: first })
      .expect(201);
    const two = await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: second })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    await decide(actor.cookie, base, one.body.entries[0].id, 'PURCHASED', '1');
    const secondEntry = two.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === second,
    );
    await decide(actor.cookie, base, secondEntry.id, 'PURCHASED', '2');
    const original = inventory.restockInTransaction.bind(inventory);
    let calls = 0;
    const mock = vi
      .spyOn(inventory, 'restockInTransaction')
      .mockImplementation(async (...args) => {
        calls++;
        if (calls === 2)
          throw new ConflictException('Fixture failure after first Restock.');
        return original(...args);
      });
    await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(409);
    mock.mockRestore();
    expect(
      await prisma.stockBatch.count({
        where: { itemId: { in: [first, second] } },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryAction.count({
        where: { itemId: { in: [first, second] } },
      }),
    ).toBe(0);
    expect(
      await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: tripId } }),
    ).toMatchObject({ status: 'SHOPPING', completedByUserId: null });
    await Promise.all([
      request(app.getHttpServer())
        .post(`${base}/finish`)
        .set('Cookie', actor.cookie)
        .expect(201),
      request(app.getHttpServer())
        .post(`${base}/finish`)
        .set('Cookie', actor.cookie)
        .expect(201),
    ]);
    expect(
      await prisma.stockBatch.count({
        where: { itemId: { in: [first, second] } },
      }),
    ).toBe(2);
    expect(
      await prisma.inventoryAction.count({
        where: { itemId: { in: [first, second] }, type: 'RESTOCK' },
      }),
    ).toBe(2);
    expect(
      await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: tripId } }),
    ).toMatchObject({ status: 'RESTOCKED', completedByUserId: actor.id });
  });

  it('rejects invalid completion without changing the trip or inventory', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const itemId = await item(actor.cookie, householdId, 'Rice');
    const tripId = await trip(actor.cookie, householdId);
    const base = `/api/households/${householdId}/trips/${tripId}`;
    const added = await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${base}/entries/${added.body.entries[0].id}`)
      .set('Cookie', actor.cookie)
      .send({ status: 'PURCHASED', actualQuantity: '1.0000001' })
      .expect(400);
    await prisma.shoppingEntry.update({
      where: { id: added.body.entries[0].id },
      data: { status: 'PURCHASED', actualQuantity: '0' },
    });
    await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(400);
    expect(
      (await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: tripId } }))
        .status,
    ).toBe('SHOPPING');
    expect(await prisma.stockBatch.count({ where: { itemId } })).toBe(0);
    expect(await prisma.inventoryAction.count({ where: { itemId } })).toBe(0);
  });

  it('imports backup suggestions and finishes both state modes without opening them', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const five = await item(
      actor.cookie,
      householdId,
      'Detergent',
      'FIVE_LEVEL',
    );
    const presence = await item(
      actor.cookie,
      householdId,
      'Bulb',
      'PRESENCE_BACKUP',
    );
    const pending = await item(
      actor.cookie,
      householdId,
      'Battery',
      'PRESENCE_BACKUP',
    );
    const tripId = await trip(actor.cookie, householdId);
    const base = `/api/households/${householdId}/trips/${tripId}`;
    const imported = await request(app.getHttpServer())
      .post(`${base}/suggestions`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(imported.body.entries).toHaveLength(3);
    for (const entry of imported.body.entries) {
      expect(entry).toMatchObject({
        source: 'SUGGESTED',
        priority: 'MUST_BUY',
        suggestedQuantity: null,
        actualQuantity: null,
      });
      expect(entry.suggestedReason).toContain('buy a refill');
    }
    expect(
      imported.body.entries
        .map(
          (entry: { item: { trackingMode: string } }) =>
            entry.item.trackingMode,
        )
        .sort(),
    ).toEqual(['FIVE_LEVEL', 'PRESENCE_BACKUP', 'PRESENCE_BACKUP']);
    await request(app.getHttpServer())
      .post(`${base}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const fiveEntry = imported.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === five,
    );
    const presenceEntry = imported.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === presence,
    );
    await decide(actor.cookie, base, fiveEntry.id, 'PURCHASED', '2');
    await decide(actor.cookie, base, presenceEntry.id, 'PURCHASED', '3');
    const finished = await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(finished.body.status).toBe('RESTOCKED');
    expect(
      finished.body.entries.find(
        (entry: { itemId: string }) => entry.itemId === pending,
      ).status,
    ).toBe('SKIPPED');
    expect(
      await prisma.inventoryItem.findUniqueOrThrow({ where: { id: five } }),
    ).toMatchObject({ currentLevel: 'EMPTY', backupCount: 2 });
    expect(
      await prisma.inventoryItem.findUniqueOrThrow({ where: { id: presence } }),
    ).toMatchObject({ isPresent: false, backupCount: 3 });
    const actions = await prisma.inventoryStateAction.findMany({
      where: { itemId: { in: [five, presence, pending] } },
    });
    expect(
      actions
        .map((action) => [
          action.itemId,
          action.type,
          action.userId,
          action.beforeBackupCount,
          action.afterBackupCount,
        ])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    ).toEqual(
      [
        [five, 'ADD_BACKUP', actor.id, 0, 2],
        [presence, 'ADD_BACKUP', actor.id, 0, 3],
      ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );
    expect(
      await prisma.stockBatch.count({
        where: { itemId: { in: [five, presence, pending] } },
      }),
    ).toBe(0);
    await Promise.all([
      request(app.getHttpServer())
        .post(`${base}/finish`)
        .set('Cookie', actor.cookie)
        .expect(201),
      request(app.getHttpServer())
        .post(`${base}/finish`)
        .set('Cookie', actor.cookie)
        .expect(201),
    ]);
    expect(
      await prisma.inventoryStateAction.count({
        where: { itemId: { in: [five, presence, pending] } },
      }),
    ).toBe(2);
  });

  it('accepts manual backup entries and rejects fractional amounts and expiry', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const five = await item(actor.cookie, householdId, 'Soap', 'FIVE_LEVEL');
    const presence = await item(
      actor.cookie,
      householdId,
      'Sponge',
      'PRESENCE_BACKUP',
    );
    const tripId = await trip(actor.cookie, householdId);
    const base = `/api/households/${householdId}/trips/${tripId}`;
    const first = await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: five })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: presence })
      .expect(201);
    const fiveEntry = first.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === five,
    );
    const presenceEntry = second.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === presence,
    );
    expect(fiveEntry).toMatchObject({
      source: 'MANUAL',
      suggestedQuantity: null,
    });
    await request(app.getHttpServer())
      .post(`${base}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    for (const entryId of [fiveEntry.id, presenceEntry.id]) {
      await request(app.getHttpServer())
        .patch(`${base}/entries/${entryId}`)
        .set('Cookie', actor.cookie)
        .send({ status: 'PURCHASED', actualQuantity: '1.5' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`${base}/entries/${entryId}`)
        .set('Cookie', actor.cookie)
        .send({
          status: 'PURCHASED',
          actualQuantity: '1',
          expiryDate: '2026-12-01',
        })
        .expect(400);
    }
    await decide(actor.cookie, base, fiveEntry.id, 'PURCHASED', '1');
    await decide(actor.cookie, base, presenceEntry.id, 'SKIPPED');
    await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);
    expect(
      await prisma.inventoryItem.findUniqueOrThrow({ where: { id: five } }),
    ).toMatchObject({ backupCount: 1, currentLevel: 'EMPTY' });
    expect(
      await prisma.inventoryItem.findUniqueOrThrow({ where: { id: presence } }),
    ).toMatchObject({ backupCount: 0, isPresent: false });
    expect(
      await prisma.inventoryStateAction.count({ where: { itemId: presence } }),
    ).toBe(0);
  });

  it('rolls back a mixed restock and isolates backup entries by household', async () => {
    const actor = await register();
    const outsider = await register();
    const householdId = await household(actor.cookie);
    const otherHousehold = await household(outsider.cookie);
    const quantity = await item(actor.cookie, householdId, 'Rice');
    const backup = await item(
      actor.cookie,
      householdId,
      'Bulb',
      'PRESENCE_BACKUP',
    );
    const foreign = await item(
      outsider.cookie,
      otherHousehold,
      'Foreign',
      'FIVE_LEVEL',
    );
    const tripId = await trip(actor.cookie, householdId);
    const base = `/api/households/${householdId}/trips/${tripId}`;
    await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: foreign })
      .expect(404);
    await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', outsider.cookie)
      .send({ itemId: backup })
      .expect(403);
    const first = await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: quantity })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`${base}/entries`)
      .set('Cookie', actor.cookie)
      .send({ itemId: backup })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    await decide(
      actor.cookie,
      base,
      first.body.entries[0].id,
      'PURCHASED',
      '4',
    );
    const backupEntry = second.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === backup,
    );
    await decide(actor.cookie, base, backupEntry.id, 'PURCHASED', '2');
    await request(app.getHttpServer())
      .patch(`${base}/entries/${backupEntry.id}`)
      .set('Cookie', outsider.cookie)
      .send({ status: 'PURCHASED', actualQuantity: '5' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', outsider.cookie)
      .expect(403);
    const laterBoundary =
      quantity.localeCompare(backup) < 0
        ? vi
            .spyOn(state, 'transitionInTransaction')
            .mockImplementation(async () => {
              throw new ConflictException(
                'Fixture failure after first restock.',
              );
            })
        : vi
            .spyOn(inventory, 'restockInTransaction')
            .mockImplementation(async () => {
              throw new ConflictException(
                'Fixture failure after first restock.',
              );
            });
    await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(409);
    laterBoundary.mockRestore();
    expect(await prisma.stockBatch.count({ where: { itemId: quantity } })).toBe(
      0,
    );
    expect(
      await prisma.inventoryAction.count({ where: { itemId: quantity } }),
    ).toBe(0);
    expect(
      await prisma.inventoryStateAction.count({ where: { itemId: backup } }),
    ).toBe(0);
    expect(
      (await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: tripId } }))
        .status,
    ).toBe('SHOPPING');
    await Promise.all([
      request(app.getHttpServer())
        .post(`${base}/finish`)
        .set('Cookie', actor.cookie)
        .expect(201),
      request(app.getHttpServer())
        .post(`${base}/finish`)
        .set('Cookie', actor.cookie)
        .expect(201),
    ]);
    expect(await prisma.stockBatch.count({ where: { itemId: quantity } })).toBe(
      1,
    );
    expect(
      await prisma.inventoryStateAction.count({ where: { itemId: backup } }),
    ).toBe(1);
    expect(
      await prisma.inventoryItem.findUniqueOrThrow({ where: { id: backup } }),
    ).toMatchObject({ backupCount: 2, isPresent: false });
  });

  it('rolls back all purchased entries when one lacks location, then retries with only that missing field', async () => {
    const actor = await register();
    const householdId = await household(actor.cookie);
    const itemIds = [
      await item(actor.cookie, householdId, 'Milk'),
      await item(actor.cookie, householdId, 'Eggs'),
    ].sort();
    const [locatedItemId, missingItemId] = itemIds;
    const originalLocatedPreference = (
      await prisma.inventoryItem.findUniqueOrThrow({
        where: { id: locatedItemId },
      })
    ).preferredRestockLocationId;
    const override = await prisma.location.create({
      data: { householdId, name: 'Second shelf', nameKey: randomUUID() },
    });
    const missingItem = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: missingItemId },
    });
    const missingLocationId = missingItem.preferredRestockLocationId;
    expect(missingLocationId).not.toBeNull();
    await prisma.inventoryItem.update({
      where: { id: missingItemId },
      data: { preferredRestockLocationId: null },
    });

    const tripId = await trip(actor.cookie, householdId);
    const base = `/api/households/${householdId}/trips/${tripId}`;
    for (const itemId of itemIds) {
      await request(app.getHttpServer())
        .post(`${base}/entries`)
        .set('Cookie', actor.cookie)
        .send({ itemId })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(`${base}/start`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const entries = await prisma.shoppingEntry.findMany({ where: { tripId } });
    for (const entry of entries) {
      await request(app.getHttpServer())
        .patch(`${base}/entries/${entry.id}`)
        .set('Cookie', actor.cookie)
        .send({
          status: 'PURCHASED',
          actualQuantity: '2',
          ...(entry.itemId === locatedItemId
            ? { locationId: override.id }
            : {}),
        })
        .expect(200);
    }

    const rejected = await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(400);
    expect(rejected.body).toMatchObject({
      code: 'LOCATION_REQUIRED',
      itemId: missingItemId,
    });
    expect(
      await prisma.stockBatch.count({ where: { itemId: { in: itemIds } } }),
    ).toBe(0);
    expect(
      await prisma.inventoryAction.count({
        where: { itemId: { in: itemIds } },
      }),
    ).toBe(0);
    expect(
      (await prisma.shoppingTrip.findUniqueOrThrow({ where: { id: tripId } }))
        .status,
    ).toBe('SHOPPING');
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: locatedItemId },
        })
      ).preferredRestockLocationId,
    ).toBe(originalLocatedPreference);
    expect(
      await prisma.shoppingEntry.count({
        where: { tripId, status: 'PURCHASED' },
      }),
    ).toBe(2);

    const missingEntry = entries.find(
      (entry) => entry.itemId === missingItemId,
    )!;
    await request(app.getHttpServer())
      .patch(`${base}/entries/${missingEntry.id}`)
      .set('Cookie', actor.cookie)
      .send({
        status: 'PURCHASED',
        actualQuantity: '2',
        locationId: missingLocationId,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${base}/finish`)
      .set('Cookie', actor.cookie)
      .expect(201);
    const batches = await prisma.stockBatch.findMany({
      where: { itemId: { in: itemIds } },
    });
    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.locationId !== null)).toBe(true);
    expect(
      batches.find((batch) => batch.itemId === missingItemId)?.locationId,
    ).toBe(missingLocationId);
    expect(
      batches.find((batch) => batch.itemId === locatedItemId)?.locationId,
    ).toBe(override.id);
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: locatedItemId },
        })
      ).preferredRestockLocationId,
    ).toBe(override.id);
    expect(
      await prisma.inventoryAction.count({
        where: { itemId: { in: itemIds } },
      }),
    ).toBe(2);
  });
});
