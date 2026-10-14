import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { LocationStockCheckService } from '../src/inventory/location-stock-check.service.js';
import { StockIntelligenceService } from '../src/inventory/stock-intelligence.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Check Location (database; requires Check Location migration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let checks: LocationStockCheckService;
  let intelligence: StockIntelligenceService;
  const households: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    checks = app.get(LocationStockCheckService);
    intelligence = app.get(StockIntelligenceService);
  });

  afterAll(async () => {
    await prisma.locationStockCheck.deleteMany({
      where: { householdId: { in: households } },
    });
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: households } },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.location.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.membership.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.household.deleteMany({ where: { id: { in: households } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  });

  async function fixture() {
    const actorId = randomUUID();
    const householdId = randomUUID();
    users.push(actorId);
    households.push(householdId);
    await prisma.user.create({
      data: {
        id: actorId,
        email: `${actorId}@example.invalid`,
        passwordHash: 'fixture',
      },
    });
    await prisma.household.create({
      data: { id: householdId, name: 'Location check fixture' },
    });
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'ADMIN' },
    });
    const location = await prisma.location.create({
      data: { householdId, name: 'Shelf', nameKey: randomUUID() },
    });
    const other = await prisma.location.create({
      data: { householdId, name: 'Pantry', nameKey: randomUUID() },
    });
    return { actorId, householdId, locationId: location.id, otherId: other.id };
  }

  async function quantity(
    input: Awaited<ReturnType<typeof fixture>>,
    name = 'Milk',
  ) {
    return prisma.inventoryItem.create({
      data: {
        householdId: input.householdId,
        name,
        primaryUnit: 'box',
        trackingMode: 'QUANTITY',
        preferredRestockLocationId: input.locationId,
        predictionEnabled: true,
      },
    });
  }

  it('lists all associated items with uncertain stock first and resumes/stales a confirmation', async () => {
    const f = await fixture();
    const uncertain = await quantity(f, 'Uncertain');
    const recent = await quantity(f, 'Recent');
    await prisma.stockBatch.create({
      data: { itemId: recent.id, locationId: f.locationId, quantity: '1' },
    });
    const first = await checks.list(f.actorId, f.householdId, f.locationId);
    expect(first.items.map((item) => item.itemId)).toEqual([
      uncertain.id,
      recent.id,
    ]);
    expect(first.items[0].reason).toBe('NO_STOCK_RECORD');
    const saved = await checks.save(
      f.actorId,
      f.householdId,
      f.locationId,
      uncertain.id,
      { decision: 'CONFIRM', expectedRevision: 0 },
    );
    expect(saved.changed).toBe(false);
    const check = await prisma.locationStockCheck.findUniqueOrThrow({
      where: {
        locationId_itemId: { locationId: f.locationId, itemId: uncertain.id },
      },
    });
    await checks.save(f.actorId, f.householdId, f.locationId, uncertain.id, {
      decision: 'CONFIRM',
      expectedRevision: 0,
    });
    const repeated = await prisma.locationStockCheck.findUniqueOrThrow({
      where: {
        locationId_itemId: { locationId: f.locationId, itemId: uncertain.id },
      },
    });
    expect(repeated.history).toEqual(check.history);
    expect(repeated.checkedAt).toEqual(check.checkedAt);
    await prisma.inventoryItem.update({
      where: { id: uncertain.id },
      data: { stockRevision: { increment: 1 } },
    });
    const stale = await checks.list(f.actorId, f.householdId, f.locationId);
    expect(stale.items[0]).toMatchObject({
      itemId: uncertain.id,
      status: 'STALE',
      reason: 'STOCK_CHANGED',
    });
    await expect(
      checks.save(f.actorId, f.householdId, f.locationId, uncertain.id, {
        decision: 'CONFIRM',
        expectedRevision: 0,
      }),
    ).rejects.toThrow('STOCK_CHANGED');
  });

  it('corrects only the selected location and creates discovered stock there', async () => {
    const f = await fixture();
    const item = await quantity(f);
    const here = await prisma.stockBatch.create({
      data: { itemId: item.id, locationId: f.locationId, quantity: '2' },
    });
    const there = await prisma.stockBatch.create({
      data: { itemId: item.id, locationId: f.otherId, quantity: '7' },
    });
    const saved = await checks.save(
      f.actorId,
      f.householdId,
      f.locationId,
      item.id,
      { decision: 'CORRECT', expectedRevision: 0, quantity: '3' },
    );
    expect(saved.changed).toBe(true);
    expect(saved.item.stock).toMatchObject({ quantity: '3' });
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: here.id } })
      ).quantity.toString(),
    ).toBe('2');
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: there.id } })
      ).quantity.toString(),
    ).toBe('7');
    const created = await prisma.stockBatch.findMany({
      where: { itemId: item.id, locationId: f.locationId },
    });
    expect(created).toHaveLength(2);
    expect(
      created.find((batch) => batch.id !== here.id)?.quantity.toString(),
    ).toBe('1');
    expect(saved.item.stockRevision).toBe(1);
    const reduced = await checks.save(
      f.actorId,
      f.householdId,
      f.locationId,
      item.id,
      { decision: 'CORRECT', expectedRevision: 1, quantity: '0' },
    );
    expect(reduced.item.stock).toMatchObject({ quantity: '0' });
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: there.id } })
      ).quantity.toString(),
    ).toBe('7');
  });

  it('requires batch detail for distinct expiry and preserves opened and unopened counts', async () => {
    const f = await fixture();
    const item = await prisma.inventoryItem.create({
      data: {
        householdId: f.householdId,
        name: 'Bottles',
        primaryUnit: 'bottle',
        trackingMode: 'QUANTITY',
        openedTrackingEnabled: true,
        preferredRestockLocationId: f.locationId,
      },
    });
    const unopened = await prisma.stockBatch.create({
      data: {
        itemId: item.id,
        locationId: f.locationId,
        quantity: '2',
        expiryDate: new Date('2027-01-01T00:00:00Z'),
      },
    });
    const opened = await prisma.stockBatch.create({
      data: {
        itemId: item.id,
        locationId: f.locationId,
        quantity: '0.5',
        openedAt: new Date(),
        expiryDate: new Date('2026-12-01T00:00:00Z'),
      },
    });
    await expect(
      checks.save(f.actorId, f.householdId, f.locationId, item.id, {
        decision: 'CORRECT',
        expectedRevision: 0,
        quantity: '1.5',
      }),
    ).rejects.toThrow('BATCH_DETAIL_REQUIRED');
    const result = await checks.save(
      f.actorId,
      f.householdId,
      f.locationId,
      item.id,
      {
        decision: 'CORRECT',
        expectedRevision: 0,
        quantity: '1.5',
        batches: [
          { batchId: unopened.id, quantity: '1' },
          { batchId: opened.id, quantity: '0.5' },
        ],
      },
    );
    expect(result.item.stock).toMatchObject({ quantity: '1.5' });
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: opened.id } })
      ).quantity.toString(),
    ).toBe('0.5');
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({
          where: { id: unopened.id },
        })
      ).quantity.toString(),
    ).toBe('1');
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({
          where: { id: unopened.id },
        })
      ).expiryDate
        ?.toISOString()
        .slice(0, 10),
    ).toBe('2027-01-01');
  });

  it('keeps current and backup placements distinct for both state modes', async () => {
    const f = await fixture();
    const level = await prisma.inventoryItem.create({
      data: {
        householdId: f.householdId,
        name: 'Detergent',
        primaryUnit: 'bottle',
        trackingMode: 'FIVE_LEVEL',
        currentLevel: 'FULL',
        backupCount: 2,
        currentLocationId: f.locationId,
        backupLocationId: f.otherId,
      },
    });
    const presence = await prisma.inventoryItem.create({
      data: {
        householdId: f.householdId,
        name: 'Tissues',
        primaryUnit: 'box',
        trackingMode: 'PRESENCE_BACKUP',
        isPresent: true,
        backupCount: 3,
        currentLocationId: f.locationId,
        backupLocationId: f.otherId,
      },
    });
    expect(
      (await checks.list(f.actorId, f.householdId, f.locationId)).items.find(
        (entry) => entry.itemId === level.id,
      )?.stock,
    ).toEqual({ currentLevel: 'FULL' });
    await expect(
      checks.save(f.actorId, f.householdId, f.locationId, level.id, {
        decision: 'CORRECT',
        expectedRevision: 0,
        backupCount: 0,
      }),
    ).rejects.toThrow('FIELD_NOT_AT_LOCATION');
    await checks.save(f.actorId, f.householdId, f.locationId, level.id, {
      decision: 'CORRECT',
      expectedRevision: 0,
      currentLevel: 'HALF',
    });
    await checks.save(f.actorId, f.householdId, f.otherId, level.id, {
      decision: 'CORRECT',
      expectedRevision: 1,
      backupCount: 1,
    });
    await checks.save(f.actorId, f.householdId, f.locationId, presence.id, {
      decision: 'CORRECT',
      expectedRevision: 0,
      isPresent: false,
    });
    await checks.save(f.actorId, f.householdId, f.otherId, presence.id, {
      decision: 'CORRECT',
      expectedRevision: 1,
      backupCount: 2,
    });
    expect(
      await prisma.inventoryItem.findUniqueOrThrow({ where: { id: level.id } }),
    ).toMatchObject({ currentLevel: 'HALF', backupCount: 1 });
    expect(
      await prisma.inventoryItem.findUniqueOrThrow({
        where: { id: presence.id },
      }),
    ).toMatchObject({ isPresent: false, backupCount: 2 });
  });

  it('enforces membership, location ownership, association, and current revision', async () => {
    const f = await fixture();
    const foreign = await fixture();
    const item = await quantity(f);
    await expect(
      checks.list(foreign.actorId, f.householdId, f.locationId),
    ).rejects.toThrow('HOUSEHOLD_MEMBERSHIP_REQUIRED');
    await expect(
      checks.list(f.actorId, f.householdId, foreign.locationId),
    ).rejects.toThrow('LOCATION_NOT_FOUND');
    await expect(
      checks.save(f.actorId, f.householdId, f.otherId, item.id, {
        decision: 'CONFIRM',
        expectedRevision: 0,
      }),
    ).rejects.toThrow('CHECK_ITEM_NOT_FOUND');
    await expect(
      checks.save(f.actorId, f.householdId, f.locationId, item.id, {
        decision: 'CONFIRM',
        expectedRevision: 1,
      }),
    ).rejects.toThrow('STOCK_CHANGED');
  });

  it('rolls back stock when check recording fails and never adds USE consumption', async () => {
    const f = await fixture();
    const item = await quantity(f);
    await prisma.stockBatch.create({
      data: { itemId: item.id, locationId: f.locationId, quantity: '2' },
    });
    const before = (
      await intelligence.assessHousehold(f.actorId, f.householdId)
    ).assessments[0];
    const target = checks as unknown as {
      correctQuantity: (
        ...args: Parameters<LocationStockCheckService['correctQuantity']>
      ) => Promise<boolean>;
    };
    const original = target.correctQuantity.bind(checks);
    const spy = vi
      .spyOn(target, 'correctQuantity')
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new Error('forced rollback');
      });
    try {
      await expect(
        checks.save(f.actorId, f.householdId, f.locationId, item.id, {
          decision: 'CORRECT',
          expectedRevision: 0,
          quantity: '1',
        }),
      ).rejects.toThrow('forced rollback');
    } finally {
      spy.mockRestore();
    }
    expect(
      (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }))
        .stockRevision,
    ).toBe(0);
    expect(
      await prisma.locationStockCheck.count({ where: { itemId: item.id } }),
    ).toBe(0);
    await checks.save(f.actorId, f.householdId, f.locationId, item.id, {
      decision: 'CORRECT',
      expectedRevision: 0,
      quantity: '1',
    });
    const after = (await intelligence.assessHousehold(f.actorId, f.householdId))
      .assessments[0];
    expect(after.prediction.usedIn14Days).toBe(before.prediction.usedIn14Days);
    expect(after.prediction.dailyRate).toBe(before.prediction.dailyRate);
    expect(after.prediction.basis).toBe(before.prediction.basis);
    expect(
      await prisma.inventoryAction.count({
        where: { itemId: item.id, type: 'USE' },
      }),
    ).toBe(0);
  });
});
