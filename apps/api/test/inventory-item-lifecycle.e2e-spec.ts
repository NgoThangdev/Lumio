import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { addCalendarDays } from '../src/inventory/stock-intelligence.js';
import { localCalendarDate } from '../src/inventory/plan-use.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Inventory item lifecycle HTTP (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const emails: string[] = [];
  const households: string[] = [];

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
      where: { householdId: { in: households } },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true },
    });
    const intentIds = (
      await prisma.notificationIntent.findMany({
        where: { householdId: { in: households } },
        select: { id: true },
      })
    ).map((intent) => intent.id);
    await prisma.notificationDelivery.deleteMany({
      where: { intentId: { in: intentIds } },
    });
    await prisma.notificationIntent.deleteMany({
      where: { id: { in: intentIds } },
    });
    await prisma.tripStockCheck.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.locationStockCheck.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryUndo.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryStateAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryItemChange.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.shoppingEntry.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.shoppingTrip.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.actionBatchAllocation.deleteMany({
      where: { actionId: { in: actions.map((action) => action.id) } },
    });
    await prisma.openTransfer.deleteMany({
      where: { actionId: { in: actions.map((action) => action.id) } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.stockBatch.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryItemTag.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.category.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.tag.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.location.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.membership.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.household.deleteMany({ where: { id: { in: households } } });
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    await prisma.userSession.deleteMany({
      where: { userId: { in: users.map((user) => user.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((user) => user.id) } },
    });
    await app.close();
  });

  async function register() {
    const email = `${randomUUID()}@example.invalid`;
    emails.push(email);
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'fixture-password-123' })
      .expect(201);
    const cookies: string | string[] = response.headers['set-cookie'];
    return {
      id: response.body.id as string,
      cookie: (Array.isArray(cookies) ? cookies[0] : cookies).split(';')[0],
    };
  }

  async function household(cookie: string) {
    const response = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: `Lifecycle ${randomUUID()}` })
      .expect(201);
    households.push(response.body.id as string);
    return response.body.id as string;
  }

  async function item(cookie: string, householdId: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/items`)
      .set('Cookie', cookie)
      .send({ name: `Milk ${randomUUID()}`, primaryUnit: 'box' })
      .expect(201);
    return response.body.id as string;
  }

  async function trip(cookie: string, householdId: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/trips`)
      .set('Cookie', cookie)
      .send({
        store: 'Fixture store',
        plannedDate: addCalendarDays(localCalendarDate(new Date()), 1),
      })
      .expect(201);
    return response.body.id as string;
  }

  async function createdItem(
    cookie: string,
    householdId: string,
    locationId: string,
    trackingMode: 'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP',
    initialStock: Record<string, unknown>,
  ) {
    const category = await prisma.category.create({
      data: {
        householdId,
        name: `Category ${randomUUID()}`,
        nameKey: randomUUID(),
      },
    });
    const name = `Accidental ${randomUUID()}`;
    const response = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/items`)
      .set('Cookie', cookie)
      .send({
        name,
        primaryUnit: 'box',
        trackingMode,
        categoryId: category.id,
        locationId,
        initialStock,
      })
      .expect(201);
    return { id: response.body.id as string, name };
  }

  async function archiveAndDelete(
    cookie: string,
    householdId: string,
    itemId: string,
    name: string,
  ) {
    const path = `/api/households/${householdId}/items/${itemId}`;
    await request(app.getHttpServer())
      .post(`${path}/archive`)
      .set('Cookie', cookie)
      .expect(201);
    return request(app.getHttpServer())
      .delete(path)
      .set('Cookie', cookie)
      .send({ confirmName: name });
  }

  it('edits metadata, retains stock/history, and restores archived stock', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const other = await household(admin.cookie);
    const itemId = await item(admin.cookie, home);
    const category = await prisma.category.create({
      data: { householdId: home, name: 'Dairy', nameKey: randomUUID() },
    });
    const foreignCategory = await prisma.category.create({
      data: { householdId: other, name: 'Other', nameKey: randomUUID() },
    });
    const location = await prisma.location.create({
      data: { householdId: home, name: 'Shelf', nameKey: randomUUID() },
    });
    const tag = await prisma.tag.create({
      data: { householdId: home, name: 'Family', nameKey: randomUUID() },
    });
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${itemId}/restock`)
      .set('Cookie', admin.cookie)
      .send({ quantity: '3', locationId: location.id })
      .expect(201);
    const before = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { batches: true, actions: true },
    });
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/items/${itemId}`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Fresh Milk', categoryId: category.id, tagIds: [tag.id] })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/items/${itemId}`)
      .set('Cookie', admin.cookie)
      .send({ categoryId: foreignCategory.id })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/items/${itemId}`)
      .set('Cookie', admin.cookie)
      .send({ primaryUnit: 'bottle' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/households/${other}/items/${itemId}`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Foreign edit' })
      .expect(404);
    const member = await register();
    await prisma.membership.create({
      data: { userId: member.id, householdId: home, role: 'MEMBER' },
    });
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/items/${itemId}`)
      .set('Cookie', member.cookie)
      .send({ name: 'Wrong' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${itemId}/archive`)
      .set('Cookie', member.cookie)
      .expect(403);
    const archived = await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${itemId}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    expect(archived.body.archivedAt).toBeTruthy();
    expect(
      archived.body.changes.map((change: { kind: string }) => change.kind),
    ).toEqual(expect.arrayContaining(['EDIT', 'ARCHIVE']));
    const current = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { batches: true, actions: true },
    });
    expect(current.stockRevision).toBe(before.stockRevision);
    expect(current.primaryUnit).toBe(before.primaryUnit);
    expect(current.batches).toEqual(before.batches);
    expect(current.actions).toEqual(before.actions);
    const list = await request(app.getHttpServer())
      .get(`/api/households/${home}/items`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(list.body.some((row: { id: string }) => row.id === itemId)).toBe(
      false,
    );
    const archivedList = await request(app.getHttpServer())
      .get(`/api/households/${home}/items/archived`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(
      archivedList.body.some((row: { id: string }) => row.id === itemId),
    ).toBe(true);
    await request(app.getHttpServer())
      .get(`/api/households/${home}/items/archived`)
      .set('Cookie', member.cookie)
      .expect(403);
    const archivedIntelligence = await request(app.getHttpServer())
      .get(`/api/households/${home}/stock-intelligence`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(
      archivedIntelligence.body.assessments.some(
        (row: { itemId: string }) => row.itemId === itemId,
      ),
    ).toBe(false);
    const locationCheck = await request(app.getHttpServer())
      .get(`/api/households/${home}/locations/${location.id}/stock-check`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(
      locationCheck.body.items.some(
        (row: { itemId: string }) => row.itemId === itemId,
      ),
    ).toBe(false);
    const draft = await trip(admin.cookie, home);
    const tripCheck = await request(app.getHttpServer())
      .get(`/api/households/${home}/trips/${draft}/stock-check`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(
      tripCheck.body.items.some(
        (row: { itemId: string }) => row.itemId === itemId,
      ),
    ).toBe(false);
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${itemId}/use`)
      .set('Cookie', admin.cookie)
      .send({ quantity: '1' })
      .expect(409);
    const restored = await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${itemId}/restore`)
      .set('Cookie', admin.cookie)
      .expect(201);
    expect(restored.body.archivedAt).toBeNull();
    expect(restored.body.changes[0].kind).toBe('RESTORE');
    const intelligence = await request(app.getHttpServer())
      .get(`/api/households/${home}/stock-intelligence`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(
      intelligence.body.assessments.some(
        (row: { itemId: string }) => row.itemId === itemId,
      ),
    ).toBe(true);
  });

  it('requires explicit entry removal and keeps imported suggestions one-shot', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const itemId = await item(admin.cookie, home);
    const suggestedId = await item(admin.cookie, home);
    await request(app.getHttpServer())
      .put(`/api/households/${home}/items/${suggestedId}/config`)
      .set('Cookie', admin.cookie)
      .send({
        minimumStock: '0',
        buyThreshold: '1',
        lowStockThreshold: '2',
        targetStock: '3',
        neverRunOut: false,
        predictionEnabled: false,
      })
      .expect(200);
    const tripId = await trip(admin.cookie, home);
    const path = `/api/households/${home}/trips/${tripId}`;
    const added = await request(app.getHttpServer())
      .post(`${path}/entries`)
      .set('Cookie', admin.cookie)
      .send({ itemId })
      .expect(201);
    const entryId = added.body.entries[0].id as string;
    const blocked = await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${itemId}/archive`)
      .set('Cookie', admin.cookie)
      .expect(409);
    expect(blocked.body.code).toBe('ACTIVE_TRIP_ENTRY');
    expect(blocked.body.tripIds).toEqual([tripId]);
    const imported = await request(app.getHttpServer())
      .post(`${path}/suggestions`)
      .set('Cookie', admin.cookie)
      .expect(201);
    const suggestedEntry = imported.body.entries.find(
      (entry: { itemId: string }) => entry.itemId === suggestedId,
    );
    expect(suggestedEntry.source).toBe('SUGGESTED');
    await request(app.getHttpServer())
      .delete(`${path}/entries/${suggestedEntry.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${path}/entries/${entryId}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    const repeat = await request(app.getHttpServer())
      .post(`${path}/suggestions`)
      .set('Cookie', admin.cookie)
      .expect(201);
    expect(repeat.body.suggestionsImportedAt).toBeTruthy();
    expect(repeat.body.entries).toHaveLength(0);
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${itemId}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .post(`${path}/entries`)
      .set('Cookie', admin.cookie)
      .send({ itemId })
      .expect(409);
    await request(app.getHttpServer())
      .post(`${path}/start`)
      .set('Cookie', admin.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .post(`${path}/finish`)
      .set('Cookie', admin.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .delete(`${path}/entries/${entryId}`)
      .set('Cookie', admin.cookie)
      .expect(409);
  });

  it('serializes concurrent Archive with manual add and suggestion import', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const itemId = await item(admin.cookie, home);
    const tripId = await trip(admin.cookie, home);
    const archivePath = `/api/households/${home}/items/${itemId}/archive`;
    const entryPath = `/api/households/${home}/trips/${tripId}/entries`;
    const [archive, add] = await Promise.all([
      request(app.getHttpServer())
        .post(archivePath)
        .set('Cookie', admin.cookie),
      request(app.getHttpServer())
        .post(entryPath)
        .set('Cookie', admin.cookie)
        .send({ itemId }),
    ]);
    expect([201, 409]).toContain(archive.status);
    expect([201, 409]).toContain(add.status);
    const row = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    const entries = await prisma.shoppingEntry.count({
      where: { tripId, itemId },
    });
    expect(row.archivedAt && entries > 0).toBeFalsy();
    if (entries) {
      const entry = await prisma.shoppingEntry.findUniqueOrThrow({
        where: { tripId_itemId: { tripId, itemId } },
      });
      await request(app.getHttpServer())
        .delete(`${entryPath}/${entry.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      await request(app.getHttpServer())
        .post(archivePath)
        .set('Cookie', admin.cookie)
        .expect(201);
    }
    const imported = await request(app.getHttpServer())
      .post(`/api/households/${home}/trips/${tripId}/suggestions`)
      .set('Cookie', admin.cookie)
      .expect(201);
    expect(imported.body.entries).toHaveLength(0);

    const candidateId = await item(admin.cookie, home);
    await request(app.getHttpServer())
      .put(`/api/households/${home}/items/${candidateId}/config`)
      .set('Cookie', admin.cookie)
      .send({
        minimumStock: '0',
        buyThreshold: '1',
        lowStockThreshold: '2',
        targetStock: '3',
        neverRunOut: false,
        predictionEnabled: false,
      })
      .expect(200);
    const secondTrip = await trip(admin.cookie, home);
    const secondArchivePath = `/api/households/${home}/items/${candidateId}/archive`;
    const secondImportPath = `/api/households/${home}/trips/${secondTrip}/suggestions`;
    const [archiveDuringImport, importDuringArchive] = await Promise.all([
      request(app.getHttpServer())
        .post(secondArchivePath)
        .set('Cookie', admin.cookie),
      request(app.getHttpServer())
        .post(secondImportPath)
        .set('Cookie', admin.cookie),
    ]);
    expect([201, 409]).toContain(archiveDuringImport.status);
    expect(importDuringArchive.status).toBe(201);
    const candidate = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: candidateId },
    });
    const candidateEntries = await prisma.shoppingEntry.count({
      where: { tripId: secondTrip, itemId: candidateId },
    });
    expect(candidate.archivedAt && candidateEntries > 0).toBeFalsy();
  });

  it('removes a Purchased decision before Finish without restock, but preserves completed history', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const itemId = await item(admin.cookie, home);
    const location = await prisma.location.create({
      data: { householdId: home, name: 'Shelf', nameKey: randomUUID() },
    });
    const tripId = await trip(admin.cookie, home);
    const path = `/api/households/${home}/trips/${tripId}`;
    const added = await request(app.getHttpServer())
      .post(`${path}/entries`)
      .set('Cookie', admin.cookie)
      .send({ itemId })
      .expect(201);
    const entryId = added.body.entries[0].id as string;
    await request(app.getHttpServer())
      .post(`${path}/start`)
      .set('Cookie', admin.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${path}/entries/${entryId}`)
      .set('Cookie', admin.cookie)
      .send({
        status: 'PURCHASED',
        actualQuantity: '2',
        locationId: location.id,
      })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${path}/entries/${entryId}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`${path}/finish`)
      .set('Cookie', admin.cookie)
      .expect(201);
    expect(await prisma.stockBatch.count({ where: { itemId } })).toBe(0);
    await request(app.getHttpServer())
      .delete(`${path}/entries/${entryId}`)
      .set('Cookie', admin.cookie)
      .expect(409);

    const historicalTrip = await trip(admin.cookie, home);
    const historicalPath = `/api/households/${home}/trips/${historicalTrip}`;
    const historicalEntry = await request(app.getHttpServer())
      .post(`${historicalPath}/entries`)
      .set('Cookie', admin.cookie)
      .send({ itemId })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${historicalPath}/start`)
      .set('Cookie', admin.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${historicalPath}/entries/${historicalEntry.body.entries[0].id}`)
      .set('Cookie', admin.cookie)
      .send({
        status: 'PURCHASED',
        actualQuantity: '2',
        locationId: location.id,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${historicalPath}/finish`)
      .set('Cookie', admin.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${itemId}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    const history = await request(app.getHttpServer())
      .get(historicalPath)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(history.body.entries[0]).toMatchObject({
      itemId,
      status: 'PURCHASED',
      actualQuantity: '2',
    });
    expect(await prisma.stockBatch.count({ where: { itemId } })).toBe(1);
  });

  it('permanently deletes archived accidental stock in all modes while preserving catalog and other items', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const location = await prisma.location.create({
      data: {
        householdId: home,
        name: 'Delete fixture shelf',
        nameKey: randomUUID(),
      },
    });
    const survivor = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '2' },
    );
    for (const [mode, stock] of [
      ['QUANTITY', { quantity: '0' }],
      ['QUANTITY', { quantity: '12' }],
      ['FIVE_LEVEL', { level: 'HALF', backupCount: 2 }],
      ['PRESENCE_BACKUP', { present: true, backupCount: 1 }],
    ] as const) {
      const created = await createdItem(
        admin.cookie,
        home,
        location.id,
        mode,
        stock,
      );
      await request(app.getHttpServer())
        .patch(`/api/households/${home}/items/${created.id}`)
        .set('Cookie', admin.cookie)
        .send({ name: `${created.name} edited` })
        .expect(200);
      const name = `${created.name} edited`;
      const result = await archiveAndDelete(
        admin.cookie,
        home,
        created.id,
        name,
      );
      expect(result.status).toBe(204);
      expect(
        await prisma.inventoryItem.findUnique({ where: { id: created.id } }),
      ).toBeNull();
      expect(
        await prisma.inventoryAction.count({ where: { itemId: created.id } }),
      ).toBe(0);
      expect(
        await prisma.inventoryStateAction.count({
          where: { itemId: created.id },
        }),
      ).toBe(0);
      expect(
        await prisma.stockBatch.count({ where: { itemId: created.id } }),
      ).toBe(0);
      expect(
        await prisma.inventoryItemChange.count({
          where: { itemId: created.id },
        }),
      ).toBe(0);
    }
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: survivor.id } }),
    ).not.toBeNull();
    expect(
      await prisma.location.findUnique({ where: { id: location.id } }),
    ).not.toBeNull();
  });

  it('requires own-household Admin and exact current name', async () => {
    const admin = await register();
    const member = await register();
    const home = await household(admin.cookie);
    const other = await household(member.cookie);
    await prisma.membership.create({
      data: { userId: member.id, householdId: home, role: 'MEMBER' },
    });
    const location = await prisma.location.create({
      data: { householdId: home, name: 'Shelf', nameKey: randomUUID() },
    });
    const created = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '0' },
    );
    const path = `/api/households/${home}/items/${created.id}`;
    await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', admin.cookie)
      .send({ confirmName: created.name })
      .expect(409);
    await request(app.getHttpServer())
      .post(`${path}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', member.cookie)
      .send({ confirmName: created.name })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/households/${other}/items/${created.id}`)
      .set('Cookie', member.cookie)
      .send({ confirmName: created.name })
      .expect(404);
    await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', admin.cookie)
      .send({ confirmName: created.name.toLowerCase() })
      .expect(400);
    await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', admin.cookie)
      .send({ confirmName: created.name, extra: true })
      .expect(400);
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: created.id } }),
    ).not.toBeNull();
  });

  it('blocks later stock activity, every Shopping decision, and both stock-check references', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const location = await prisma.location.create({
      data: { householdId: home, name: 'Shelf', nameKey: randomUUID() },
    });
    const used = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '5' },
    );
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${used.id}/use`)
      .set('Cookie', admin.cookie)
      .send({ quantity: '1' })
      .expect(201);
    expect(
      (await archiveAndDelete(admin.cookie, home, used.id, used.name)).body
        .message,
    ).toBe('ITEM_HAS_STOCK_ACTION');
    const restocked = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '0' },
    );
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${restocked.id}/restock`)
      .set('Cookie', admin.cookie)
      .send({ quantity: '1', locationId: location.id })
      .expect(201);
    expect(
      (await archiveAndDelete(admin.cookie, home, restocked.id, restocked.name))
        .body.message,
    ).toBe('ITEM_HAS_STOCK_ACTION');
    const leveled = await createdItem(
      admin.cookie,
      home,
      location.id,
      'FIVE_LEVEL',
      { level: 'HALF', backupCount: 0 },
    );
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${leveled.id}/state/level`)
      .set('Cookie', admin.cookie)
      .send({ level: 'QUARTER' })
      .expect(201);
    expect(
      (await archiveAndDelete(admin.cookie, home, leveled.id, leveled.name))
        .body.message,
    ).toBe('ITEM_HAS_STOCK_ACTION');
    for (const status of [
      'PENDING',
      'PURCHASED',
      'SKIPPED',
      'MOVED',
    ] as const) {
      const created = await createdItem(
        admin.cookie,
        home,
        location.id,
        'QUANTITY',
        { quantity: '0' },
      );
      await request(app.getHttpServer())
        .post(`/api/households/${home}/items/${created.id}/archive`)
        .set('Cookie', admin.cookie)
        .expect(201);
      const tripId = await trip(admin.cookie, home);
      await prisma.shoppingEntry.create({
        data: {
          tripId,
          itemId: created.id,
          source: 'MANUAL',
          priority: 'OPTIONAL',
          status,
        },
      });
      const result = await request(app.getHttpServer())
        .delete(`/api/households/${home}/items/${created.id}`)
        .set('Cookie', admin.cookie)
        .send({ confirmName: created.name })
        .expect(409);
      expect(result.body.message).toBe('ITEM_HAS_SHOPPING_ENTRY');
    }
    const checked = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '0' },
    );
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${checked.id}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    const tripId = await trip(admin.cookie, home);
    await prisma.tripStockCheck.create({
      data: { tripId, itemId: checked.id, revision: 0 },
    });
    let result = await request(app.getHttpServer())
      .delete(`/api/households/${home}/items/${checked.id}`)
      .set('Cookie', admin.cookie)
      .send({ confirmName: checked.name })
      .expect(409);
    expect(result.body.message).toBe('ITEM_HAS_STOCK_CHECK');
    await prisma.tripStockCheck.delete({
      where: { tripId_itemId: { tripId, itemId: checked.id } },
    });
    await prisma.locationStockCheck.create({
      data: {
        householdId: home,
        locationId: location.id,
        itemId: checked.id,
        revision: 0,
      },
    });
    result = await request(app.getHttpServer())
      .delete(`/api/households/${home}/items/${checked.id}`)
      .set('Cookie', admin.cookie)
      .send({ confirmName: checked.name })
      .expect(409);
    expect(result.body.message).toBe('ITEM_HAS_STOCK_CHECK');
  });

  it('removes only the deleted item from notification records and rolls back on an in-flight send', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const location = await prisma.location.create({
      data: { householdId: home, name: 'Shelf', nameKey: randomUUID() },
    });
    const doomed = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '0' },
    );
    const survivor = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '0' },
    );
    const immediate = await prisma.notificationIntent.create({
      data: {
        userId: admin.id,
        kind: 'IMMEDIATE_ITEM',
        status: 'PENDING',
        localDay: '2026-10-27',
        subjectKey: `${home}:${doomed.id}`,
        householdId: home,
        itemId: doomed.id,
        content: { signal: 'OUT', householdId: home, itemId: doomed.id },
        dueAt: new Date(),
      },
    });
    const digest = await prisma.notificationIntent.create({
      data: {
        userId: admin.id,
        kind: 'DAILY_DIGEST',
        status: 'PENDING',
        localDay: '2026-10-27',
        subjectKey: 'all',
        content: {
          households: [
            {
              householdId: home,
              items: [
                { itemId: doomed.id, signals: ['LOW_STOCK'] },
                { itemId: survivor.id, signals: ['USE_SOON'] },
              ],
            },
          ],
        },
        dueAt: new Date(),
      },
    });
    await prisma.notificationDelivery.create({
      data: {
        intentId: immediate.id,
        subscriptionKey: 'a'.repeat(64),
        status: 'CLAIMED',
      },
    });
    await request(app.getHttpServer())
      .post(`/api/households/${home}/items/${doomed.id}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    const path = `/api/households/${home}/items/${doomed.id}`;
    const blocked = await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', admin.cookie)
      .send({ confirmName: doomed.name })
      .expect(409);
    expect(blocked.body.message).toBe('ITEM_NOTIFICATION_IN_FLIGHT');
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: doomed.id } }),
    ).not.toBeNull();
    expect(
      await prisma.notificationIntent.findUnique({
        where: { id: immediate.id },
      }),
    ).not.toBeNull();
    await prisma.notificationDelivery.updateMany({
      where: { intentId: immediate.id },
      data: { status: 'SKIPPED' },
    });
    await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', admin.cookie)
      .send({ confirmName: doomed.name })
      .expect(204);
    expect(
      await prisma.notificationIntent.findUnique({
        where: { id: immediate.id },
      }),
    ).toBeNull();
    const currentDigest = await prisma.notificationIntent.findUniqueOrThrow({
      where: { id: digest.id },
    });
    expect(JSON.stringify(currentDigest.content)).not.toContain(doomed.id);
    expect(JSON.stringify(currentDigest.content)).toContain(survivor.id);
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: survivor.id } }),
    ).not.toBeNull();
  });

  it('serializes Restore and deletion without deleting a restored item', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const location = await prisma.location.create({
      data: { householdId: home, name: 'Shelf', nameKey: randomUUID() },
    });
    const created = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '0' },
    );
    const path = `/api/households/${home}/items/${created.id}`;
    await request(app.getHttpServer())
      .post(`${path}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    const [deletion, restore] = await Promise.all([
      request(app.getHttpServer())
        .delete(path)
        .set('Cookie', admin.cookie)
        .send({ confirmName: created.name }),
      request(app.getHttpServer())
        .post(`${path}/restore`)
        .set('Cookie', admin.cookie),
    ]);
    expect([204, 409]).toContain(deletion.status);
    expect([201, 404]).toContain(restore.status);
    const row = await prisma.inventoryItem.findUnique({
      where: { id: created.id },
    });
    if (deletion.status === 204) expect(row).toBeNull();
    else expect(row?.archivedAt).toBeNull();
  });

  it('serializes a concurrent stock mutation and delete without leaving orphan stock', async () => {
    const admin = await register();
    const home = await household(admin.cookie);
    const location = await prisma.location.create({
      data: { householdId: home, name: 'Shelf', nameKey: randomUUID() },
    });
    const created = await createdItem(
      admin.cookie,
      home,
      location.id,
      'QUANTITY',
      { quantity: '0' },
    );
    const path = `/api/households/${home}/items/${created.id}`;
    await request(app.getHttpServer())
      .post(`${path}/archive`)
      .set('Cookie', admin.cookie)
      .expect(201);
    const [deletion, restock] = await Promise.all([
      request(app.getHttpServer())
        .delete(path)
        .set('Cookie', admin.cookie)
        .send({ confirmName: created.name }),
      request(app.getHttpServer())
        .post(`${path}/restock`)
        .set('Cookie', admin.cookie)
        .send({ quantity: '2', locationId: location.id }),
    ]);
    expect(deletion.status).toBe(204);
    expect([404, 409]).toContain(restock.status);
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: created.id } }),
    ).toBeNull();
    expect(
      await prisma.stockBatch.count({ where: { itemId: created.id } }),
    ).toBe(0);
  });
});
