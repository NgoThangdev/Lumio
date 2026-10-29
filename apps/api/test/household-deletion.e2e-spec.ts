import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { HouseholdPurgeService } from '../src/households/household-purge.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Household deletion request lifecycle (database)', () => {
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
    const itemIds = (
      await prisma.inventoryItem.findMany({
        where: { householdId: { in: householdIds } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.notificationIntent.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.locationStockCheck.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.tripStockCheck.deleteMany({
      where: { trip: { householdId: { in: householdIds } } },
    });
    await prisma.inventoryItemChange.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.shoppingEntry.deleteMany({
      where: { trip: { householdId: { in: householdIds } } },
    });
    await prisma.shoppingTrip.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.inventoryItemTag.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryUndo.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.openTransfer.deleteMany({
      where: { action: { householdId: { in: householdIds } } },
    });
    await prisma.actionBatchAllocation.deleteMany({
      where: { action: { householdId: { in: householdIds } } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.inventoryStateAction.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
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
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  async function actor() {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: randomUUID() + '@example.invalid',
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
      .send({ name: 'Deletion API fixture ' + randomUUID() })
      .expect(201);
    householdIds.push(response.body.id as string);
    return response.body.id as string;
  }

  function impact(cookie: string, householdId: string) {
    return request(app.getHttpServer())
      .get('/api/households/' + householdId + '/deletion-impact')
      .set('Cookie', cookie);
  }

  function schedule(cookie: string, householdId: string, body: unknown) {
    return request(app.getHttpServer())
      .post('/api/households/' + householdId + '/deletion-request')
      .set('Cookie', cookie)
      .send(body);
  }

  function deleteImmediately(
    cookie: string,
    householdId: string,
    body: unknown,
  ) {
    return request(app.getHttpServer())
      .delete('/api/households/' + householdId)
      .set('Cookie', cookie)
      .send(body);
  }

  function executeScheduledDeletion(
    householdId: string,
    requestId: string,
    activationCutoff = new Date('2026-01-01T00:00:00.000Z'),
  ) {
    return app
      .get(HouseholdPurgeService)
      .executeScheduledDeletion(householdId, requestId, activationCutoff);
  }

  it('previews exact impact, enforces Admin scope, schedules once, discovers, and cancels without changing data', async () => {
    const admin = await actor();
    const member = await actor();
    const otherAdmin = await actor();
    const home = await household(admin.cookie);
    const otherHome = await household(otherAdmin.cookie);
    await prisma.membership.create({
      data: { userId: member.id, householdId: home, role: 'MEMBER' },
    });
    const category = await prisma.category.create({
      data: {
        householdId: home,
        name: 'Pantry',
        nameKey: 'pantry-' + randomUUID(),
      },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        householdId: home,
        categoryId: category.id,
        name: 'Rice',
        primaryUnit: 'bag',
      },
    });
    const batch = await prisma.stockBatch.create({
      data: { itemId: item.id, quantity: '2' },
    });
    const digest = await prisma.notificationIntent.create({
      data: {
        userId: admin.id,
        kind: 'DAILY_DIGEST',
        status: 'PENDING',
        localDay: '2026-10-27',
        subjectKey: '2026-10-27',
        content: {
          households: [
            { householdId: home, items: [] },
            { householdId: otherHome, items: [] },
          ],
        },
        dueAt: new Date(),
      },
    });
    await prisma.notificationDelivery.create({
      data: { intentId: digest.id, subscriptionKey: 'a'.repeat(64) },
    });

    const preview = await impact(admin.cookie, home).expect(200);
    expect(preview.body.household).toEqual({
      id: home,
      name: expect.any(String),
    });
    expect(preview.body.counts).toEqual({
      members: 2,
      invitations: 0,
      categories: 1,
      locations: 0,
      tags: 0,
      activeItems: 1,
      archivedItems: 0,
      stockBatches: 1,
      inventoryActions: 0,
      stateActions: 0,
      undos: 0,
      itemChanges: 0,
      shoppingTrips: 0,
      shoppingEntries: 0,
      tripStockChecks: 0,
      locationStockChecks: 0,
      notificationIntents: 1,
      notificationDeliveries: 1,
    });
    await schedule(admin.cookie, home, {
      confirmName: preview.body.household.name + ' ',
      confirmedImpact: preview.body.counts,
    })
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('HOUSEHOLD_NAME_CONFIRMATION_MISMATCH'),
      );
    await schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: { ...preview.body.counts, activeItems: 0 },
    })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('HOUSEHOLD_IMPACT_CHANGED'));
    await impact(member.cookie, home).expect(403);
    await impact(otherAdmin.cookie, home).expect(403);
    const outsider = await actor();
    await impact(outsider.cookie, home).expect(403);
    await schedule(member.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).expect(403);

    const scheduled = await schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).expect(201);
    expect(
      new Date(scheduled.body.dueAt).getTime() -
        new Date(scheduled.body.requestedAt).getTime(),
    ).toBe(7 * 24 * 60 * 60_000);
    expect(scheduled.body.impact.counts).toEqual(preview.body.counts);
    const duplicate = await Promise.all([
      schedule(admin.cookie, home, {
        confirmName: preview.body.household.name,
        confirmedImpact: preview.body.counts,
      }),
      schedule(admin.cookie, home, {
        confirmName: preview.body.household.name,
        confirmedImpact: preview.body.counts,
      }),
    ]);
    expect(duplicate.map((response) => response.status)).toEqual([409, 409]);
    for (const response of duplicate)
      expect(response.body.code).toBe('HOUSEHOLD_DELETION_ALREADY_PENDING');

    const pending = await request(app.getHttpServer())
      .get('/api/households/pending-deletions')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(pending.body).toContainEqual({
      id: home,
      name: preview.body.household.name,
      requestId: scheduled.body.requestId,
      requestedAt: scheduled.body.requestedAt,
      dueAt: scheduled.body.dueAt,
    });
    expect(pending.body.map((row: { id: string }) => row.id)).not.toContain(
      otherHome,
    );
    await request(app.getHttpServer())
      .get('/api/households/pending-deletions')
      .set('Cookie', member.cookie)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));
    await request(app.getHttpServer())
      .get('/api/households/pending-deletions')
      .set('Cookie', outsider.cookie)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));
    await request(app.getHttpServer())
      .get('/api/households')
      .set('Cookie', admin.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body.map((row: { id: string }) => row.id)).not.toContain(home),
      );
    await impact(admin.cookie, home).expect(409);

    await request(app.getHttpServer())
      .delete('/api/households/' + home + '/deletion-request/' + randomUUID())
      .set('Cookie', admin.cookie)
      .expect(409)
      .expect(({ body }) =>
        expect(body.code).toBe('HOUSEHOLD_DELETION_REQUEST_STALE'),
      );
    await request(app.getHttpServer())
      .delete(
        '/api/households/' +
          home +
          '/deletion-request/' +
          scheduled.body.requestId,
      )
      .set('Cookie', member.cookie)
      .expect(403);
    await prisma.household.update({
      where: { id: home },
      data: { deletionDueAt: new Date(Date.now() - 1_000) },
    });
    await request(app.getHttpServer())
      .delete(
        '/api/households/' +
          home +
          '/deletion-request/' +
          scheduled.body.requestId,
      )
      .set('Cookie', admin.cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ cancelled: true, householdId: home }),
      );
    await request(app.getHttpServer())
      .get('/api/households/' + home + '/items')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(await prisma.inventoryItem.count({ where: { id: item.id } })).toBe(
      1,
    );
    expect(
      await prisma.stockBatch.findUnique({ where: { id: batch.id } }),
    ).not.toBeNull();
    expect(
      await prisma.inventoryAction.count({ where: { itemId: item.id } }),
    ).toBe(0);
  });

  it('serializes scheduling behind an in-flight stock write and rejects the stale impact acknowledgement', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Oil', primaryUnit: 'bottle' },
    });
    const preview = await impact(admin.cookie, home).expect(200);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const writer = prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "Household" WHERE "id" = $1 FOR SHARE',
          home,
        );
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "InventoryItem" WHERE "id" = $1 FOR UPDATE',
          item.id,
        );
        await tx.stockBatch.create({
          data: { itemId: item.id, quantity: '3' },
        });
        locked();
        await hold;
      },
      { timeout: 15_000 },
    );
    await ready;
    let settled = false;
    const pending = schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).then((response) => {
      settled = true;
      return response;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await writer;
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('HOUSEHOLD_IMPACT_CHANGED');
    expect(response.body.impact.counts.stockBatches).toBe(1);
    expect(await prisma.inventoryItem.count({ where: { id: item.id } })).toBe(
      1,
    );
  });

  it('serializes scheduling behind an in-flight household read lock', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Beans', primaryUnit: 'can' },
    });
    const preview = await impact(admin.cookie, home).expect(200);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const reader = prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "Household" WHERE "id" = $1 FOR SHARE',
          home,
        );
        await tx.inventoryItem.findMany({ where: { householdId: home } });
        locked();
        await hold;
      },
      { timeout: 15_000 },
    );
    await ready;
    let settled = false;
    const pending = schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).then((response) => {
      settled = true;
      return response;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await reader;
    expect((await pending).status).toBe(201);
    expect(
      (await prisma.inventoryItem.findUnique({ where: { id: item.id } }))?.name,
    ).toBe('Beans');
  });

  it('purges the complete FK graph while preserving shared account data and other-household digest content', async () => {
    const owner = await actor();
    const member = await actor();
    const otherAdmin = await actor();
    const home = await household(owner.cookie);
    const otherHome = await household(owner.cookie);
    await prisma.membership.create({
      data: { userId: member.id, householdId: home, role: 'MEMBER' },
    });
    const category = await prisma.category.create({
      data: { householdId: home, name: 'Dry', nameKey: 'dry-' + randomUUID() },
    });
    const location = await prisma.location.create({
      data: {
        householdId: home,
        name: 'Pantry',
        nameKey: 'pantry-' + randomUUID(),
      },
    });
    const tag = await prisma.tag.create({
      data: {
        householdId: home,
        name: 'Staple',
        nameKey: 'staple-' + randomUUID(),
      },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        householdId: home,
        categoryId: category.id,
        currentLocationId: location.id,
        preferredRestockLocationId: location.id,
        name: 'Rice',
        primaryUnit: 'bag',
      },
    });
    const otherItem = await prisma.inventoryItem.create({
      data: { householdId: otherHome, name: 'Coffee', primaryUnit: 'bag' },
    });
    await prisma.inventoryItemTag.create({
      data: { itemId: item.id, tagId: tag.id },
    });
    const sourceBatch = await prisma.stockBatch.create({
      data: { itemId: item.id, locationId: location.id, quantity: '2' },
    });
    const openedBatch = await prisma.stockBatch.create({
      data: {
        itemId: item.id,
        locationId: location.id,
        quantity: '0',
        openedAt: new Date(),
      },
    });
    const restock = await prisma.inventoryAction.create({
      data: {
        householdId: home,
        itemId: item.id,
        userId: owner.id,
        type: 'RESTOCK',
        quantity: '2',
        postStockRevision: 1,
      },
    });
    const open = await prisma.inventoryAction.create({
      data: {
        householdId: home,
        itemId: item.id,
        userId: member.id,
        type: 'OPEN',
        quantity: '1',
        postStockRevision: 2,
      },
    });
    await prisma.actionBatchAllocation.createMany({
      data: [
        {
          actionId: restock.id,
          batchId: sourceBatch.id,
          quantity: '2',
          quantityAfter: '2',
        },
        {
          actionId: open.id,
          batchId: sourceBatch.id,
          quantity: '1',
          quantityAfter: '1',
        },
      ],
    });
    await prisma.openTransfer.create({
      data: {
        actionId: open.id,
        sourceBatchId: sourceBatch.id,
        openedBatchId: openedBatch.id,
        quantity: '1',
      },
    });
    const stateAction = await prisma.inventoryStateAction.create({
      data: {
        householdId: home,
        itemId: item.id,
        userId: member.id,
        type: 'UPDATE_LEVEL',
        beforeLevel: 'FULL',
        afterLevel: 'HALF',
        beforeBackupCount: 0,
        afterBackupCount: 0,
        postStockRevision: 3,
      },
    });
    await prisma.inventoryUndo.create({
      data: {
        householdId: home,
        itemId: item.id,
        userId: owner.id,
        inventoryActionId: restock.id,
        postStockRevision: 3,
      },
    });
    await prisma.inventoryItemChange.create({
      data: {
        householdId: home,
        itemId: item.id,
        actorId: owner.id,
        kind: 'EDIT',
        before: { categoryId: null },
        after: { categoryId: category.id },
      },
    });
    const trip = await prisma.shoppingTrip.create({
      data: {
        householdId: home,
        createdByUserId: owner.id,
        completedByUserId: member.id,
        store: 'Market',
        plannedDate: new Date('2026-10-30T00:00:00.000Z'),
      },
    });
    await prisma.shoppingEntry.create({
      data: {
        tripId: trip.id,
        itemId: item.id,
        source: 'MANUAL',
        priority: 'OPTIONAL',
        status: 'PENDING',
      },
    });
    await prisma.tripStockCheck.create({
      data: {
        tripId: trip.id,
        itemId: item.id,
        userId: member.id,
        revision: 3,
      },
    });
    await prisma.locationStockCheck.create({
      data: {
        householdId: home,
        locationId: location.id,
        itemId: item.id,
        userId: member.id,
        revision: 3,
      },
    });
    await prisma.householdInvitation.create({
      data: {
        householdId: home,
        createdByUserId: owner.id,
        secretHash: randomUUID().replaceAll('-', '').padEnd(64, 'x'),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const immediate = await prisma.notificationIntent.create({
      data: {
        userId: owner.id,
        kind: 'IMMEDIATE_ITEM',
        status: 'PENDING',
        localDay: '2026-10-27',
        subjectKey: home + ':' + item.id,
        householdId: home,
        itemId: item.id,
        content: { signal: 'OUT', householdId: home, itemId: item.id },
        dueAt: new Date(),
      },
    });
    const digest = await prisma.notificationIntent.create({
      data: {
        userId: owner.id,
        kind: 'DAILY_DIGEST',
        status: 'PENDING',
        localDay: '2026-10-27',
        subjectKey: 'all',
        content: {
          households: [
            {
              householdId: home,
              items: [{ itemId: item.id, signals: ['LOW_STOCK'] }],
            },
            {
              householdId: otherHome,
              items: [{ itemId: otherItem.id, signals: ['USE_SOON'] }],
            },
          ],
        },
        dueAt: new Date(),
      },
    });
    await prisma.notificationDelivery.createMany({
      data: [
        { intentId: immediate.id, subscriptionKey: 'i'.repeat(64) },
        { intentId: digest.id, subscriptionKey: 'd'.repeat(64) },
      ],
    });
    const preference = await prisma.notificationPreference.upsert({
      where: { userId: owner.id },
      create: { userId: owner.id, dailyDigestEnabled: true },
      update: { dailyDigestEnabled: true },
    });
    const session = await prisma.userSession.findFirstOrThrow({
      where: { userId: owner.id },
      select: { tokenHash: true },
    });
    const endpoint = 'https://push.example.invalid/' + randomUUID();
    const subscription = await prisma.pushSubscription.create({
      data: {
        endpoint,
        p256dh: 'test-p256dh',
        auth: 'test-auth',
        sessionTokenHash: session.tokenHash,
      },
    });

    const preview = await impact(owner.cookie, home).expect(200);
    expect(preview.body.counts).toMatchObject({
      members: 2,
      invitations: 1,
      activeItems: 1,
      stockBatches: 2,
      inventoryActions: 2,
      stateActions: 1,
      undos: 1,
      itemChanges: 1,
      shoppingTrips: 1,
      shoppingEntries: 1,
      tripStockChecks: 1,
      locationStockChecks: 1,
      notificationIntents: 2,
      notificationDeliveries: 2,
    });
    const confirm = {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    };
    await deleteImmediately(member.cookie, home, confirm)
      .expect(403)
      .expect(({ body }) =>
        expect(body.message).toBe('HOUSEHOLD_ADMIN_REQUIRED'),
      );
    await deleteImmediately(otherAdmin.cookie, home, confirm).expect(403);
    const outsider = await actor();
    await deleteImmediately(outsider.cookie, home, confirm).expect(403);
    await deleteImmediately(owner.cookie, home, {
      ...confirm,
      confirmName: preview.body.household.name + 'x',
    })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('HOUSEHOLD_NAME_CONFIRMATION_MISMATCH');
      });
    await deleteImmediately(owner.cookie, home, {
      ...confirm,
      confirmedImpact: { ...confirm.confirmedImpact, members: 1 },
    })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('HOUSEHOLD_IMPACT_CHANGED');
      });

    await deleteImmediately(owner.cookie, home, confirm)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          deleted: true,
          householdId: home,
          impact: preview.body,
        });
      });
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).toBeNull();
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: item.id } }),
    ).toBeNull();
    expect(
      await prisma.shoppingTrip.findUnique({ where: { id: trip.id } }),
    ).toBeNull();
    expect(
      await prisma.inventoryAction.count({ where: { householdId: home } }),
    ).toBe(0);
    expect(
      await prisma.inventoryStateAction.count({ where: { householdId: home } }),
    ).toBe(0);
    expect(
      await prisma.inventoryUndo.count({ where: { householdId: home } }),
    ).toBe(0);
    expect(
      await prisma.actionBatchAllocation.count({
        where: { actionId: { in: [restock.id, open.id] } },
      }),
    ).toBe(0);
    expect(
      await prisma.openTransfer.count({ where: { actionId: open.id } }),
    ).toBe(0);
    expect(
      await prisma.householdInvitation.count({ where: { householdId: home } }),
    ).toBe(0);
    expect(
      await prisma.locationStockCheck.count({ where: { householdId: home } }),
    ).toBe(0);
    expect(
      await prisma.notificationIntent.findUnique({
        where: { id: immediate.id },
      }),
    ).toBeNull();
    const savedDigest = await prisma.notificationIntent.findUniqueOrThrow({
      where: { id: digest.id },
    });
    expect(savedDigest.content).toEqual({
      households: [
        {
          householdId: otherHome,
          items: [{ itemId: otherItem.id, signals: ['USE_SOON'] }],
        },
      ],
    });
    expect(
      await prisma.notificationDelivery.count({
        where: { intentId: digest.id },
      }),
    ).toBe(1);
    expect(
      await prisma.notificationDelivery.count({
        where: { intentId: immediate.id },
      }),
    ).toBe(0);
    expect(
      await prisma.user.findUnique({ where: { id: owner.id } }),
    ).not.toBeNull();
    expect(
      await prisma.membership.findUnique({
        where: {
          userId_householdId: { userId: owner.id, householdId: otherHome },
        },
      }),
    ).not.toBeNull();
    expect(
      await prisma.household.findUnique({ where: { id: otherHome } }),
    ).not.toBeNull();
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: otherItem.id } }),
    ).not.toBeNull();
    expect(
      await prisma.userSession.count({ where: { userId: owner.id } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.notificationPreference.findUnique({
        where: { userId: owner.id },
      }),
    ).toMatchObject({
      dailyDigestEnabled: preference.dailyDigestEnabled,
    });
    expect(
      await prisma.pushSubscription.findUnique({ where: { endpoint } }),
    ).toMatchObject({
      sessionTokenHash: session.tokenHash,
      p256dh: subscription.p256dh,
    });
    expect(
      await prisma.membership.findUnique({
        where: { userId_householdId: { userId: member.id, householdId: home } },
      }),
    ).toBeNull();
    expect(stateAction.id).toBeTruthy();
  });

  it('requires cancellation before immediate deletion of a PENDING household', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const preview = await impact(admin.cookie, home).expect(200);
    const scheduled = await schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).expect(201);
    await deleteImmediately(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('HOUSEHOLD_PENDING_DELETION_CANCEL_FIRST');
      });
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).not.toBeNull();
    await request(app.getHttpServer())
      .delete(
        '/api/households/' +
          home +
          '/deletion-request/' +
          scheduled.body.requestId,
      )
      .set('Cookie', admin.cookie)
      .expect(200);
    await deleteImmediately(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).expect(200);
  });

  it('rolls back every purge write when the purge service fails', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const category = await prisma.category.create({
      data: {
        householdId: home,
        name: 'Rollback',
        nameKey: 'rollback-' + randomUUID(),
      },
    });
    const preview = await impact(admin.cookie, home).expect(200);
    const purge = app.get(HouseholdPurgeService);
    const spy = vi
      .spyOn(purge, 'purge')
      .mockImplementationOnce(async (tx, householdId) => {
        await tx.category.deleteMany({ where: { householdId } });
        throw new Error('injected purge failure');
      });
    try {
      await deleteImmediately(admin.cookie, home, {
        confirmName: preview.body.household.name,
        confirmedImpact: preview.body.counts,
      }).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).not.toBeNull();
    expect(
      await prisma.category.findUnique({ where: { id: category.id } }),
    ).not.toBeNull();
  });

  it('waits for a stock write, then rejects a stale purge confirmation', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Flour', primaryUnit: 'bag' },
    });
    const preview = await impact(admin.cookie, home).expect(200);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const writer = prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "Household" WHERE "id" = $1 FOR SHARE',
          home,
        );
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "InventoryItem" WHERE "id" = $1 FOR UPDATE',
          item.id,
        );
        await tx.stockBatch.create({
          data: { itemId: item.id, quantity: '4' },
        });
        locked();
        await hold;
      },
      { timeout: 15_000 },
    );
    await ready;
    let settled = false;
    const pending = deleteImmediately(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).then((response) => {
      settled = true;
      return response;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await writer;
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('HOUSEHOLD_IMPACT_CHANGED');
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).not.toBeNull();
  });

  it('waits for an in-flight household read and then completes purge atomically', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Beans', primaryUnit: 'can' },
    });
    const preview = await impact(admin.cookie, home).expect(200);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const reader = prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT "id" FROM "Household" WHERE "id" = $1 FOR SHARE',
          home,
        );
        await tx.inventoryItem.findMany({ where: { householdId: home } });
        locked();
        await hold;
      },
      { timeout: 15_000 },
    );
    await ready;
    let settled = false;
    const pending = deleteImmediately(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).then((response) => {
      settled = true;
      return response;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await reader;
    expect((await pending).status).toBe(200);
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).toBeNull();
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: item.id } }),
    ).toBeNull();
  });

  it('dry-runs without mutation and executes scheduled deletion only after dueAt', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const otherHome = await household(admin.cookie);
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Scheduled beans', primaryUnit: 'can' },
    });
    const preview = await impact(admin.cookie, home).expect(200);
    const scheduled = await schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).expect(201);
    const purge = app.get(HouseholdPurgeService);
    expect(
      await purge.dryRunScheduledDeletion(home, scheduled.body.requestId),
    ).toMatchObject({
      due: false,
      eligible: false,
      reason: 'HOUSEHOLD_DELETION_NOT_DUE',
    });
    await expect(
      executeScheduledDeletion(home, scheduled.body.requestId),
    ).rejects.toMatchObject({
      response: { code: 'HOUSEHOLD_DELETION_NOT_DUE' },
    });
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: item.id } }),
    ).not.toBeNull();

    await prisma.household.update({
      where: { id: home },
      data: { deletionDueAt: new Date(Date.now() - 1000) },
    });
    expect(
      await purge.dryRunScheduledDeletion(home, scheduled.body.requestId),
    ).toMatchObject({ due: true, eligible: true, reason: null });
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: item.id } }),
    ).not.toBeNull();
    await expect(
      executeScheduledDeletion(home, scheduled.body.requestId),
    ).resolves.toMatchObject({ purged: true, householdId: home });
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: admin.id } }),
    ).not.toBeNull();
    expect(
      await prisma.membership.findUnique({
        where: {
          userId_householdId: { userId: admin.id, householdId: otherHome },
        },
      }),
    ).not.toBeNull();
  });

  it('discovers only due requests after the cutoff in deterministic bounded order', async () => {
    const admin = await actor();
    const createScheduled = async (name: string) => {
      const home = await household(admin.cookie);
      await prisma.household.update({ where: { id: home }, data: { name } });
      const preview = await impact(admin.cookie, home).expect(200);
      const scheduled = await schedule(admin.cookie, home, {
        confirmName: name,
        confirmedImpact: preview.body.counts,
      }).expect(201);
      return { home, requestId: scheduled.body.requestId };
    };
    const earliest = await createScheduled(
      'Purge runner earliest ' + randomUUID(),
    );
    const next = await createScheduled('Purge runner next ' + randomUUID());
    const beforeCutoff = await createScheduled(
      'Purge runner excluded ' + randomUUID(),
    );
    const notDue = await createScheduled('Purge runner future ' + randomUUID());
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const cutoff = new Date(now - 10 * day);
    await prisma.household.update({
      where: { id: earliest.home },
      data: {
        deletionRequestedAt: new Date(now - 9 * day),
        deletionDueAt: new Date(now - 2 * day),
      },
    });
    await prisma.household.update({
      where: { id: next.home },
      data: {
        deletionRequestedAt: new Date(now - 8 * day),
        deletionDueAt: new Date(now - day),
      },
    });
    await prisma.household.update({
      where: { id: beforeCutoff.home },
      data: {
        deletionRequestedAt: new Date(now - 11 * day),
        deletionDueAt: new Date(now - 4 * day),
      },
    });
    await prisma.household.update({
      where: { id: notDue.home },
      data: {
        deletionRequestedAt: new Date(now - day),
        deletionDueAt: new Date(now + 6 * day),
      },
    });
    const purge = app.get(HouseholdPurgeService);
    const firstBatch = await purge.findDueScheduledDeletions(cutoff, 1);
    const secondBatch = await purge.findDueScheduledDeletions(cutoff, 2);
    expect(firstBatch.map(({ householdId }) => householdId)).toEqual([
      earliest.home,
    ]);
    expect(secondBatch.map(({ householdId }) => householdId)).toEqual([
      earliest.home,
      next.home,
    ]);
    expect(secondBatch.map(({ requestId }) => requestId)).toEqual([
      earliest.requestId,
      next.requestId,
    ]);
    expect(
      secondBatch.some(({ householdId }) => householdId === beforeCutoff.home),
    ).toBe(false);
    expect(
      secondBatch.some(({ householdId }) => householdId === notDue.home),
    ).toBe(false);
  });

  it('rejects cancelled and replaced request IDs without purging their households', async () => {
    const admin = await actor();
    const purge = app.get(HouseholdPurgeService);
    const cancelledHome = await household(admin.cookie);
    const cancelledItem = await prisma.inventoryItem.create({
      data: {
        householdId: cancelledHome,
        name: 'Still here',
        primaryUnit: 'box',
      },
    });
    const cancelledPreview = await impact(admin.cookie, cancelledHome).expect(
      200,
    );
    const cancelled = await schedule(admin.cookie, cancelledHome, {
      confirmName: cancelledPreview.body.household.name,
      confirmedImpact: cancelledPreview.body.counts,
    }).expect(201);
    await prisma.household.update({
      where: { id: cancelledHome },
      data: { deletionDueAt: new Date(Date.now() - 1000) },
    });
    const discovered = await purge.findDueScheduledDeletions(
      new Date('2000-01-01T00:00:00.000Z'),
      100,
    );
    expect(
      discovered.some(
        ({ householdId, requestId }) =>
          householdId === cancelledHome &&
          requestId === cancelled.body.requestId,
      ),
    ).toBe(true);
    await request(app.getHttpServer())
      .delete(
        '/api/households/' +
          cancelledHome +
          '/deletion-request/' +
          cancelled.body.requestId,
      )
      .set('Cookie', admin.cookie)
      .expect(200);
    await expect(
      executeScheduledDeletion(cancelledHome, cancelled.body.requestId),
    ).rejects.toMatchObject({
      response: { code: 'HOUSEHOLD_DELETION_REQUEST_STALE' },
    });
    expect(
      await prisma.inventoryItem.findUnique({
        where: { id: cancelledItem.id },
      }),
    ).not.toBeNull();

    const replacedHome = await household(admin.cookie);
    const replacedItem = await prisma.inventoryItem.create({
      data: {
        householdId: replacedHome,
        name: 'Replacement guard',
        primaryUnit: 'jar',
      },
    });
    const replacedPreview = await impact(admin.cookie, replacedHome).expect(
      200,
    );
    const replaced = await schedule(admin.cookie, replacedHome, {
      confirmName: replacedPreview.body.household.name,
      confirmedImpact: replacedPreview.body.counts,
    }).expect(201);
    await prisma.household.update({
      where: { id: replacedHome },
      data: {
        deletionRequestId: Buffer.from(randomUUID()).toString('base64url'),
        deletionDueAt: new Date(Date.now() - 1000),
      },
    });
    await expect(
      executeScheduledDeletion(replacedHome, replaced.body.requestId),
    ).rejects.toMatchObject({
      response: { code: 'HOUSEHOLD_DELETION_REQUEST_STALE' },
    });
    expect(
      await prisma.inventoryItem.findUnique({ where: { id: replacedItem.id } }),
    ).not.toBeNull();
  });

  it('keeps a failed scheduled purge intact and retryable', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const category = await prisma.category.create({
      data: {
        householdId: home,
        name: 'Retry',
        nameKey: 'retry-' + randomUUID(),
      },
    });
    const preview = await impact(admin.cookie, home).expect(200);
    const scheduled = await schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).expect(201);
    await prisma.household.update({
      where: { id: home },
      data: { deletionDueAt: new Date(Date.now() - 1000) },
    });
    const purge = app.get(HouseholdPurgeService);
    const spy = vi
      .spyOn(purge, 'purge')
      .mockImplementationOnce(async (tx, id) => {
        await tx.category.deleteMany({ where: { householdId: id } });
        throw new Error('injected scheduled purge failure');
      });
    try {
      await expect(
        executeScheduledDeletion(home, scheduled.body.requestId),
      ).rejects.toThrow('injected scheduled purge failure');
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).not.toBeNull();
    expect(
      await prisma.category.findUnique({ where: { id: category.id } }),
    ).not.toBeNull();
    await expect(
      executeScheduledDeletion(home, scheduled.body.requestId),
    ).resolves.toMatchObject({ purged: true, householdId: home });
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).toBeNull();
  });

  it('serializes concurrent cancellation and scheduled execution', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const preview = await impact(admin.cookie, home).expect(200);
    const scheduled = await schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).expect(201);
    await prisma.household.update({
      where: { id: home },
      data: { deletionDueAt: new Date(Date.now() - 1000) },
    });
    const cancellation = request(app.getHttpServer())
      .delete(
        '/api/households/' +
          home +
          '/deletion-request/' +
          scheduled.body.requestId,
      )
      .set('Cookie', admin.cookie)
      .then((response) => response);
    const execution = executeScheduledDeletion(home, scheduled.body.requestId)
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }));
    const [cancelResponse, executeResult] = await Promise.all([
      cancellation,
      execution,
    ]);
    if (cancelResponse.status === 200) {
      expect(executeResult).toMatchObject({
        ok: false,
        error: { response: { code: 'HOUSEHOLD_DELETION_REQUEST_STALE' } },
      });
      expect(
        await prisma.household.findUnique({ where: { id: home } }),
      ).not.toBeNull();
    } else {
      expect(executeResult.ok).toBe(true);
      expect([403, 404, 409]).toContain(cancelResponse.status);
      expect(
        await prisma.household.findUnique({ where: { id: home } }),
      ).toBeNull();
    }
  });

  it('allows only one concurrent scheduled execution', async () => {
    const admin = await actor();
    const home = await household(admin.cookie);
    const preview = await impact(admin.cookie, home).expect(200);
    const scheduled = await schedule(admin.cookie, home, {
      confirmName: preview.body.household.name,
      confirmedImpact: preview.body.counts,
    }).expect(201);
    await prisma.household.update({
      where: { id: home },
      data: { deletionDueAt: new Date(Date.now() - 1000) },
    });
    const results = await Promise.allSettled([
      executeScheduledDeletion(home, scheduled.body.requestId),
      executeScheduledDeletion(home, scheduled.body.requestId),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.household.findUnique({ where: { id: home } }),
    ).toBeNull();
  });
});
