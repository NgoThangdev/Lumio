import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Catalog rename and safe removal (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const users: string[] = [];
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
    await prisma.locationStockCheck.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.tripStockCheck.deleteMany({
      where: { trip: { householdId: { in: households } } },
    });
    await prisma.inventoryItemChange.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.shoppingEntry.deleteMany({
      where: { trip: { householdId: { in: households } } },
    });
    await prisma.shoppingTrip.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.inventoryItemTag.deleteMany({
      where: { item: { householdId: { in: households } } },
    });
    await prisma.stockBatch.deleteMany({
      where: { item: { householdId: { in: households } } },
    });
    await prisma.inventoryItem.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.category.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.location.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.tag.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.membership.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.household.deleteMany({ where: { id: { in: households } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  });

  async function account() {
    const email = `${randomUUID()}@example.invalid`;
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'fixture-password-123' })
      .expect(201);
    const id = response.body.id as string;
    users.push(id);
    const cookies: string | string[] = response.headers['set-cookie'];
    return {
      id,
      cookie: (Array.isArray(cookies) ? cookies[0] : cookies).split(';')[0],
    };
  }

  async function household(cookie: string) {
    const response = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: `Catalog ${randomUUID()}` })
      .expect(201);
    households.push(response.body.id as string);
    return response.body.id as string;
  }

  async function category(cookie: string, householdId: string, name: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/categories`)
      .set('Cookie', cookie)
      .send({ name })
      .expect(201);
    return response.body.id as string;
  }

  async function location(cookie: string, householdId: string, name: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/locations`)
      .set('Cookie', cookie)
      .send({ name })
      .expect(201);
    return response.body.id as string;
  }

  it('enforces Admin, household, normalization, and one-field category PATCH', async () => {
    const admin = await account();
    const member = await account();
    const otherAdmin = await account();
    const home = await household(admin.cookie);
    const other = await household(otherAdmin.cookie);
    await prisma.membership.create({
      data: { userId: member.id, householdId: home, role: 'MEMBER' },
    });
    const categoryId = await category(admin.cookie, home, 'Pantry');
    const otherCategory = await category(otherAdmin.cookie, other, 'Pantry');
    const locationId = await location(admin.cookie, home, 'Shelf');
    const tag = await request(app.getHttpServer())
      .post(`/api/households/${home}/tags`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Staple' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/households/${home}/categories`)
      .set('Cookie', member.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/categories/${categoryId}`)
      .set('Cookie', member.cookie)
      .send({ name: 'Not allowed' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/households/${home}/locations/${locationId}`)
      .set('Cookie', member.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/tags/${tag.body.id}`)
      .set('Cookie', member.cookie)
      .send({ name: 'Not allowed' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/categories/${otherCategory}`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Foreign' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/households/${home}/categories/${otherCategory}`)
      .set('Cookie', admin.cookie)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/households/${other}/locations/${locationId}`)
      .set('Cookie', otherAdmin.cookie)
      .send({ name: 'Foreign' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/households/${other}/tags/${tag.body.id}`)
      .set('Cookie', otherAdmin.cookie)
      .send({ name: 'Foreign' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/categories/${categoryId}`)
      .set('Cookie', admin.cookie)
      .send({ shoppingSection: 'PANTRY' })
      .expect(200);
    const renamed = await request(app.getHttpServer())
      .patch(`/api/households/${home}/categories/${categoryId}`)
      .set('Cookie', admin.cookie)
      .send({ name: '  Dry   Pantry  ' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      name: 'Dry Pantry',
      shoppingSection: 'PANTRY',
    });
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/categories/${categoryId}`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Other', shoppingSection: 'DAIRY' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/locations/${locationId}`)
      .set('Cookie', admin.cookie)
      .send({ name: '  Cold   Shelf  ' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/tags/${tag.body.id}`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Every day' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/households/${home}/tags/${tag.body.id}`)
      .set('Cookie', admin.cookie)
      .expect(404);
    const duplicate = await category(admin.cookie, home, 'Drinks');
    const collision = await request(app.getHttpServer())
      .patch(`/api/households/${home}/categories/${duplicate}`)
      .set('Cookie', admin.cookie)
      .send({ name: '  DRY   PANTRY ' })
      .expect(409);
    expect(collision.body.message).toBe('CATALOG_NAME_EXISTS');
    const secondLocation = await location(admin.cookie, home, 'Other shelf');
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/locations/${secondLocation}`)
      .set('Cookie', admin.cookie)
      .send({ name: '  COLD  SHELF ' })
      .expect(409);
    const secondTag = await request(app.getHttpServer())
      .post(`/api/households/${home}/tags`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Different tag' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/tags/${secondTag.body.id}`)
      .set('Cookie', admin.cookie)
      .send({ name: ' EVERY   DAY ' })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/households/${home}/tags/${tag.body.id}`)
      .set('Cookie', admin.cookie)
      .send({ name: '   ' })
      .expect(400);
  });

  it('blocks active, archived, and historical JSON Category references', async () => {
    const admin = await account();
    const home = await household(admin.cookie);
    const categoryId = await category(admin.cookie, home, 'Family food');
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, categoryId, name: 'Rice', primaryUnit: 'bag' },
    });
    const path = `/api/households/${home}/categories/${categoryId}`;
    const active = await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', admin.cookie)
      .expect(409);
    expect(active.body).toMatchObject({
      code: 'CATEGORY_IN_USE',
      references: { activeItems: 1 },
    });
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { archivedAt: new Date() },
    });
    const archived = await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', admin.cookie)
      .expect(409);
    expect(archived.body.references.archivedItems).toBe(1);
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { categoryId: null },
    });
    await prisma.inventoryItemChange.create({
      data: {
        householdId: home,
        itemId: item.id,
        actorId: admin.id,
        kind: 'EDIT',
        before: { categoryId },
        after: { categoryId: null },
      },
    });
    const history = await request(app.getHttpServer())
      .delete(path)
      .set('Cookie', admin.cookie)
      .expect(409);
    expect(history.body.references).toMatchObject({
      activeItems: 0,
      archivedItems: 0,
      itemChanges: 1,
    });
    const clean = await category(admin.cookie, home, 'Unused');
    await request(app.getHttpServer())
      .delete(`/api/households/${home}/categories/${clean}`)
      .set('Cookie', admin.cookie)
      .expect(204);
    expect(await prisma.inventoryItem.count({ where: { id: item.id } })).toBe(
      1,
    );
  });

  it('updates independent Category defaults without changing existing or archived item stock', async () => {
    const admin = await account();
    const member = await account();
    const otherAdmin = await account();
    const home = await household(admin.cookie);
    const other = await household(otherAdmin.cookie);
    await prisma.membership.create({
      data: { userId: member.id, householdId: home, role: 'MEMBER' },
    });
    const categoryId = await category(admin.cookie, home, 'Staples');
    const foreignCategoryId = await category(
      otherAdmin.cookie,
      other,
      'Staples',
    );
    const active = await prisma.inventoryItem.create({
      data: {
        householdId: home,
        categoryId,
        name: 'Rice',
        primaryUnit: 'kg',
        minimumStock: '2',
        targetStock: '5',
      },
    });
    const archived = await prisma.inventoryItem.create({
      data: {
        householdId: home,
        categoryId,
        name: 'Flour',
        primaryUnit: 'bag',
        archivedAt: new Date(),
        stockRevision: 4,
      },
    });
    const batch = await prisma.stockBatch.create({
      data: { itemId: active.id, quantity: '3.5' },
    });
    const path = `/api/households/${home}/categories/${categoryId}/inventory-defaults`;
    const memberRead = await request(app.getHttpServer())
      .get(`/api/households/${home}/categories`)
      .set('Cookie', member.cookie)
      .expect(200);
    expect(memberRead.body).toContainEqual(
      expect.objectContaining({
        id: categoryId,
        defaultTrackingMode: null,
        defaultPrimaryUnit: null,
      }),
    );
    await request(app.getHttpServer())
      .patch(path)
      .set('Cookie', member.cookie)
      .send({ defaultTrackingMode: 'FIVE_LEVEL' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(
        `/api/households/${home}/categories/${foreignCategoryId}/inventory-defaults`,
      )
      .set('Cookie', admin.cookie)
      .send({ defaultPrimaryUnit: 'bag' })
      .expect(404);

    const modeOnly = await request(app.getHttpServer())
      .patch(path)
      .set('Cookie', admin.cookie)
      .send({ defaultTrackingMode: 'FIVE_LEVEL' })
      .expect(200);
    expect(modeOnly.body).toMatchObject({
      defaultTrackingMode: 'FIVE_LEVEL',
      defaultPrimaryUnit: null,
    });
    const unitOnly = await request(app.getHttpServer())
      .patch(path)
      .set('Cookie', admin.cookie)
      .send({ defaultPrimaryUnit: ' bottle ' })
      .expect(200);
    expect(unitOnly.body).toMatchObject({
      defaultTrackingMode: 'FIVE_LEVEL',
      defaultPrimaryUnit: 'bottle',
    });
    expect(
      (
        await request(app.getHttpServer())
          .patch(path)
          .set('Cookie', admin.cookie)
          .send({ defaultTrackingMode: null })
          .expect(200)
      ).body,
    ).toMatchObject({
      defaultTrackingMode: null,
      defaultPrimaryUnit: 'bottle',
    });
    await request(app.getHttpServer())
      .patch(path)
      .set('Cookie', admin.cookie)
      .send({ defaultPrimaryUnit: null })
      .expect(200);

    for (const invalid of [
      {},
      { defaultTrackingMode: 'COUNT' },
      { defaultPrimaryUnit: '' },
      { defaultPrimaryUnit: 'u'.repeat(41) },
      { defaultPrimaryUnit: 'box', shoppingSection: 'PANTRY' },
    ])
      await request(app.getHttpServer())
        .patch(path)
        .set('Cookie', admin.cookie)
        .send(invalid)
        .expect(400);

    const activeAfter = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: active.id },
    });
    const archivedAfter = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: archived.id },
    });
    expect(activeAfter).toMatchObject({
      stockRevision: 0,
      minimumStock: active.minimumStock,
      targetStock: active.targetStock,
      archivedAt: null,
    });
    expect(archivedAfter).toMatchObject({
      stockRevision: 4,
      minimumStock: null,
      targetStock: null,
      archivedAt: archived.archivedAt,
    });
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } })
      ).quantity.toString(),
    ).toBe('3.5');
  });

  it('blocks each Location relation, including zero stock and finished trips', async () => {
    const admin = await account();
    const home = await household(admin.cookie);
    const ids = await Promise.all(
      [
        'Current',
        'Backup',
        'Preferred',
        'Positive',
        'Zero',
        'Trip',
        'Check',
        'History',
        'Clean',
      ].map((name) => location(admin.cookie, home, name)),
    );
    const [
      current,
      backup,
      preferred,
      positive,
      zero,
      tripLocation,
      check,
      history,
      clean,
    ] = ids;
    const item = await prisma.inventoryItem.create({
      data: {
        householdId: home,
        name: 'Milk',
        primaryUnit: 'box',
        currentLocationId: current,
        backupLocationId: backup,
        preferredRestockLocationId: preferred,
      },
    });
    await prisma.stockBatch.createMany({
      data: [
        { itemId: item.id, locationId: positive, quantity: 3 },
        { itemId: item.id, locationId: zero, quantity: 0 },
      ],
    });
    const trip = await prisma.shoppingTrip.create({
      data: {
        householdId: home,
        createdByUserId: admin.id,
        store: 'Market',
        plannedDate: new Date('2026-10-18T00:00:00.000Z'),
        status: 'RESTOCKED',
      },
    });
    await prisma.shoppingEntry.create({
      data: {
        tripId: trip.id,
        itemId: item.id,
        locationId: tripLocation,
        source: 'MANUAL',
        priority: 'OPTIONAL',
        status: 'SKIPPED',
      },
    });
    await prisma.locationStockCheck.create({
      data: {
        householdId: home,
        locationId: check,
        itemId: item.id,
        revision: 0,
      },
    });
    await prisma.inventoryItemChange.create({
      data: {
        householdId: home,
        itemId: item.id,
        actorId: admin.id,
        kind: 'EDIT',
        before: { preferredRestockLocationId: history },
        after: { preferredRestockLocationId: null },
      },
    });
    for (const [id, field] of [
      [current, 'currentItems'],
      [backup, 'backupItems'],
      [preferred, 'preferredItems'],
      [positive, 'batches'],
      [zero, 'batches'],
      [tripLocation, 'shoppingEntries'],
      [check, 'stockChecks'],
      [history, 'itemChanges'],
    ] as const) {
      const response = await request(app.getHttpServer())
        .delete(`/api/households/${home}/locations/${id}`)
        .set('Cookie', admin.cookie)
        .expect(409);
      expect(response.body.code).toBe('LOCATION_IN_USE');
      expect(response.body.references[field]).toBeGreaterThan(0);
    }
    await request(app.getHttpServer())
      .delete(`/api/households/${home}/locations/${clean}`)
      .set('Cookie', admin.cookie)
      .expect(204);
    expect(await prisma.stockBatch.count({ where: { itemId: item.id } })).toBe(
      2,
    );
    expect(
      await prisma.shoppingEntry.count({ where: { tripId: trip.id } }),
    ).toBe(1);
  });

  it('keeps a concurrent metadata change and Category deletion consistent', async () => {
    const admin = await account();
    const home = await household(admin.cookie);
    const categoryId = await category(admin.cookie, home, 'To clear');
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, categoryId, name: 'Oats', primaryUnit: 'bag' },
    });
    const [edit, removal] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/households/${home}/items/${item.id}`)
        .set('Cookie', admin.cookie)
        .send({ categoryId: null }),
      request(app.getHttpServer())
        .delete(`/api/households/${home}/categories/${categoryId}`)
        .set('Cookie', admin.cookie),
    ]);
    expect(edit.status).toBe(200);
    expect(removal.status).toBe(409);
    expect(removal.body.code).toBe('CATEGORY_IN_USE');
    const after = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(after.categoryId).toBeNull();
    expect(
      await prisma.inventoryItemChange.count({ where: { itemId: item.id } }),
    ).toBe(1);
  });

  it('serializes a new Category assignment with deletion and its JSON history', async () => {
    const admin = await account();
    const home = await household(admin.cookie);
    const categoryId = await category(admin.cookie, home, 'Race category');
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Oats', primaryUnit: 'bag' },
    });
    const [removal, edit] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/api/households/${home}/categories/${categoryId}`)
        .set('Cookie', admin.cookie),
      request(app.getHttpServer())
        .patch(`/api/households/${home}/items/${item.id}`)
        .set('Cookie', admin.cookie)
        .send({ categoryId }),
    ]);
    expect([204, 409]).toContain(removal.status);
    expect([200, 400, 409]).toContain(edit.status);
    const categoryStillExists = Boolean(
      await prisma.category.findUnique({ where: { id: categoryId } }),
    );
    const savedItem = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(savedItem.categoryId === categoryId).toBe(categoryStillExists);
    expect(
      await prisma.inventoryItemChange.count({ where: { itemId: item.id } }),
    ).toBe(edit.status === 200 ? 1 : 0);
    if (removal.status === 409)
      expect(removal.body.code).toBe('CATEGORY_IN_USE');
  });

  it('serializes a Location removal with a new stock batch', async () => {
    const admin = await account();
    const home = await household(admin.cookie);
    const locationId = await location(admin.cookie, home, 'Race shelf');
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Rice', primaryUnit: 'bag' },
    });
    const [removal, restock] = await Promise.all([
      request(app.getHttpServer())
        .delete(`/api/households/${home}/locations/${locationId}`)
        .set('Cookie', admin.cookie),
      request(app.getHttpServer())
        .post(`/api/households/${home}/items/${item.id}/restock`)
        .set('Cookie', admin.cookie)
        .send({ quantity: '2', locationId }),
    ]);
    expect([204, 409]).toContain(removal.status);
    expect([201, 400]).toContain(restock.status);
    const survivingLocation = await prisma.location.findUnique({
      where: { id: locationId },
    });
    const batches = await prisma.stockBatch.count({
      where: { itemId: item.id },
    });
    expect(Boolean(survivingLocation)).toBe(batches === 1);
    if (removal.status === 409)
      expect(removal.body.code).toBe('LOCATION_IN_USE');
  });
});
