import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { addCalendarDays } from '../src/inventory/stock-intelligence.js';
import { localCalendarDate } from '../src/inventory/plan-use.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ShoppingService } from '../src/shopping/shopping.service.js';
import { StockCheckService } from '../src/shopping/stock-check.service.js';

describe('Pre-shopping stock check (database; requires migration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shopping: ShoppingService;
  let checks: StockCheckService;
  let inventory: InventoryService;
  const households: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    shopping = app.get(ShoppingService);
    checks = app.get(StockCheckService);
    inventory = app.get(InventoryService);
  });

  afterAll(async () => {
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: households } },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
    const trips = await prisma.shoppingTrip.findMany({
      where: { householdId: { in: households } },
      select: { id: true },
    });
    const tripIds = trips.map((trip) => trip.id);
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true },
    });
    await prisma.tripStockCheck.deleteMany({
      where: { tripId: { in: tripIds } },
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
    await prisma.shoppingEntry.deleteMany({
      where: { tripId: { in: tripIds } },
    });
    await prisma.shoppingTrip.deleteMany({ where: { id: { in: tripIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.membership.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.location.deleteMany({
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
      data: { id: householdId, name: 'Check fixture' },
    });
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'ADMIN' },
    });
    const trip = await shopping.create(
      actorId,
      householdId,
      'Store',
      addCalendarDays(localCalendarDate(new Date()), 7),
    );
    return { actorId, householdId, tripId: trip.id };
  }

  async function addItem(
    householdId: string,
    name: string,
    mode: 'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP' = 'QUANTITY',
  ) {
    const location =
      mode === 'QUANTITY'
        ? await prisma.location.create({
            data: { householdId, name: 'Fixture shelf', nameKey: randomUUID() },
          })
        : null;
    return prisma.inventoryItem.create({
      data: {
        householdId,
        name,
        primaryUnit: 'box',
        trackingMode: mode,
        preferredRestockLocationId: location?.id,
        ...(mode === 'FIVE_LEVEL' ? { currentLevel: 'FULL' as const } : {}),
        ...(mode === 'PRESENCE_BACKUP' ? { isPresent: true } : {}),
      },
    });
  }

  it('ranks stale unsuggested stock, excludes recent low stock, and resumes a confirmation until stock changes', async () => {
    const input = await fixture();
    const uncertain = await addItem(input.householdId, 'Unsuggested');
    const recent = await addItem(input.householdId, 'Recent low stock');
    await prisma.stockBatch.create({
      data: { itemId: recent.id, quantity: '1' },
    });
    await prisma.inventoryItem.update({
      where: { id: recent.id },
      data: { buyThreshold: '2', targetStock: '4' },
    });
    const first = await checks.list(
      input.actorId,
      input.householdId,
      input.tripId,
    );
    expect(first.items.map((item) => item.itemId)).toContain(uncertain.id);
    expect(first.items.map((item) => item.itemId)).not.toContain(recent.id);
    await checks.save(
      input.actorId,
      input.householdId,
      input.tripId,
      uncertain.id,
      { decision: 'CONFIRM', expectedRevision: 0 },
    );
    const firstCheck = await prisma.tripStockCheck.findUniqueOrThrow({
      where: {
        tripId_itemId: { tripId: input.tripId, itemId: uncertain.id },
      },
    });
    const repeated = await checks.save(
      input.actorId,
      input.householdId,
      input.tripId,
      uncertain.id,
      { decision: 'CONFIRM', expectedRevision: 0 },
    );
    expect(repeated.changed).toBe(false);
    const savedAgain = await prisma.tripStockCheck.findUniqueOrThrow({
      where: {
        tripId_itemId: { tripId: input.tripId, itemId: uncertain.id },
      },
    });
    expect(savedAgain.history).toEqual(firstCheck.history);
    expect(savedAgain.checkedAt).toEqual(firstCheck.checkedAt);
    expect(
      (await checks.list(input.actorId, input.householdId, input.tripId))
        .items[0].status,
    ).toBe('CONFIRM');
    await inventory.restockQuantity({
      actorId: input.actorId,
      householdId: input.householdId,
      itemId: uncertain.id,
      quantity: '1',
    });
    expect(
      (await checks.list(input.actorId, input.householdId, input.tripId))
        .items[0].status,
    ).toBe('STALE');
    await expect(
      checks.save(
        input.actorId,
        input.householdId,
        input.tripId,
        uncertain.id,
        { decision: 'CONFIRM', expectedRevision: 0 },
      ),
    ).rejects.toThrow('STOCK_CHANGED');
    await expect(
      checks.save(
        input.actorId,
        input.householdId,
        input.tripId,
        uncertain.id,
        { decision: 'CORRECT', expectedRevision: 0, quantity: '2' },
      ),
    ).rejects.toThrow('STOCK_CHANGED');
  });

  it('corrects all three modes and imports suggestions from the corrected quantity', async () => {
    const input = await fixture();
    const eggs = await addItem(input.householdId, 'Eggs');
    const level = await addItem(input.householdId, 'Detergent', 'FIVE_LEVEL');
    const presence = await addItem(
      input.householdId,
      'Tissues',
      'PRESENCE_BACKUP',
    );
    await prisma.stockBatch.create({
      data: {
        itemId: eggs.id,
        quantity: '3',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.inventoryItem.update({
      where: { id: eggs.id },
      data: { buyThreshold: '9', targetStock: '10' },
    });
    const listed = await checks.list(
      input.actorId,
      input.householdId,
      input.tripId,
    );
    expect(listed.items.map((item) => item.itemId).sort()).toEqual(
      [eggs.id, level.id, presence.id].sort(),
    );
    await checks.save(input.actorId, input.householdId, input.tripId, eggs.id, {
      decision: 'CORRECT',
      expectedRevision: 0,
      quantity: '8',
    });
    await checks.save(
      input.actorId,
      input.householdId,
      input.tripId,
      level.id,
      {
        decision: 'CORRECT',
        expectedRevision: 0,
        currentLevel: 'QUARTER',
        backupCount: 1,
      },
    );
    await checks.save(
      input.actorId,
      input.householdId,
      input.tripId,
      presence.id,
      {
        decision: 'CORRECT',
        expectedRevision: 0,
        isPresent: false,
        backupCount: 2,
      },
    );
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: level.id },
        })
      ).backupCount,
    ).toBe(1);
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: presence.id },
        })
      ).isPresent,
    ).toBe(false);
    const manual = await addItem(input.householdId, 'Manual extra');
    await shopping.addManual(
      input.actorId,
      input.householdId,
      input.tripId,
      manual.id,
    );
    const trip = await shopping.importSuggestions(
      input.actorId,
      input.householdId,
      input.tripId,
    );
    expect(
      trip.entries
        .find((entry) => entry.itemId === eggs.id)
        ?.suggestedQuantity?.toString(),
    ).toBe('2');
    expect(
      trip.entries.find((entry) => entry.itemId === manual.id)?.source,
    ).toBe('MANUAL');
    expect(
      (
        await prisma.tripStockCheck.findUniqueOrThrow({
          where: { tripId_itemId: { tripId: input.tripId, itemId: eggs.id } },
        })
      ).userId,
    ).toBe(input.actorId);
    await expect(
      checks.list(input.actorId, input.householdId, input.tripId),
    ).rejects.toThrow('SUGGESTIONS_ALREADY_IMPORTED');
  });

  it('waits for an in-flight correction before assessing the first import', async () => {
    const input = await fixture();
    const item = await addItem(input.householdId, 'Correction race');
    await prisma.stockBatch.create({
      data: {
        itemId: item.id,
        quantity: '3',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { buyThreshold: '9', targetStock: '10' },
    });
    await checks.list(input.actorId, input.householdId, input.tripId);

    let correctionReached!: () => void;
    const reached = new Promise<void>((resolve) => {
      correctionReached = resolve;
    });
    let releaseCorrection!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseCorrection = resolve;
    });
    const service = checks as unknown as {
      correctQuantity: (...args: unknown[]) => Promise<boolean>;
    };
    const original = service.correctQuantity.bind(checks);
    const spy = vi
      .spyOn(service, 'correctQuantity')
      .mockImplementation(async (...args) => {
        const changed = await original(...args);
        correctionReached();
        await release;
        return changed;
      });
    try {
      const correcting = checks.save(
        input.actorId,
        input.householdId,
        input.tripId,
        item.id,
        { decision: 'CORRECT', expectedRevision: 0, quantity: '8' },
      );
      await reached;
      const importing = shopping.importSuggestions(
        input.actorId,
        input.householdId,
        input.tripId,
      );
      // Give import time to reach the locked trip while correction is uncommitted.
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseCorrection();
      const [corrected, trip] = await Promise.all([correcting, importing]);
      expect(corrected.changed).toBe(true);
      expect(
        trip.entries
          .find((entry) => entry.itemId === item.id)
          ?.suggestedQuantity?.toString(),
      ).toBe('2');
    } finally {
      releaseCorrection();
      spy.mockRestore();
    }
  });

  it('requires batch detail for distinct expiry or opened stock and rolls back a failed correction', async () => {
    const input = await fixture();
    const milk = await addItem(input.householdId, 'Milk');
    await prisma.inventoryItem.update({
      where: { id: milk.id },
      data: { openedTrackingEnabled: true },
    });
    const one = await prisma.stockBatch.create({
      data: {
        itemId: milk.id,
        quantity: '1',
        expiryDate: new Date('2026-12-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const two = await prisma.stockBatch.create({
      data: {
        itemId: milk.id,
        quantity: '1',
        expiryDate: new Date('2026-12-05T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await checks.list(input.actorId, input.householdId, input.tripId);
    await expect(
      checks.save(input.actorId, input.householdId, input.tripId, milk.id, {
        decision: 'CORRECT',
        expectedRevision: 0,
        quantity: '1',
      }),
    ).rejects.toThrow('BATCH_DETAIL_REQUIRED');
    const service = checks as unknown as {
      correctQuantity: (...args: unknown[]) => Promise<boolean>;
    };
    const original = service.correctQuantity.bind(checks);
    const spy = vi
      .spyOn(service, 'correctQuantity')
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new ConflictException('Fixture failure after stock change');
      });
    await expect(
      checks.save(input.actorId, input.householdId, input.tripId, milk.id, {
        decision: 'CORRECT',
        expectedRevision: 0,
        quantity: '1',
        batches: [
          { batchId: one.id, quantity: '1' },
          { batchId: two.id, quantity: '0' },
        ],
      }),
    ).rejects.toThrow('Fixture failure');
    spy.mockRestore();
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: two.id } })
      ).quantity.toString(),
    ).toBe('1');
    expect(
      (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: milk.id } }))
        .stockRevision,
    ).toBe(0);
    expect(
      (await checks.list(input.actorId, input.householdId, input.tripId))
        .items[0].status,
    ).toBe('PENDING');
    const corrected = await checks.save(
      input.actorId,
      input.householdId,
      input.tripId,
      milk.id,
      {
        decision: 'CORRECT',
        expectedRevision: 0,
        quantity: '1',
        batches: [
          { batchId: one.id, quantity: '1' },
          { batchId: two.id, quantity: '0' },
        ],
      },
    );
    expect(corrected.changed).toBe(true);
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: two.id } })
      ).quantity.toString(),
    ).toBe('0');
    expect(
      (
        await prisma.tripStockCheck.findUniqueOrThrow({
          where: { tripId_itemId: { tripId: input.tripId, itemId: milk.id } },
        })
      ).history,
    ).toHaveLength(1);
  });

  it('isolates trips and shortlist items by household', async () => {
    const input = await fixture();
    const other = await fixture();
    const item = await addItem(input.householdId, 'Private');
    await checks.list(input.actorId, input.householdId, input.tripId);
    await expect(
      checks.list(other.actorId, input.householdId, input.tripId),
    ).rejects.toThrow('HOUSEHOLD_MEMBERSHIP_REQUIRED');
    await expect(
      checks.save(other.actorId, other.householdId, other.tripId, item.id, {
        decision: 'CONFIRM',
        expectedRevision: 0,
      }),
    ).rejects.toThrow('CHECK_ITEM_NOT_FOUND');
  });

  it('closes the check after an empty first suggestion import', async () => {
    const input = await fixture();
    const trip = await shopping.importSuggestions(
      input.actorId,
      input.householdId,
      input.tripId,
    );
    expect(trip.entries).toHaveLength(0);
    expect(trip.suggestionsImportedAt).not.toBeNull();
    await expect(
      checks.list(input.actorId, input.householdId, input.tripId),
    ).rejects.toThrow('SUGGESTIONS_ALREADY_IMPORTED');
  });

  it('preserves the opened/unopened split when correcting an opened item', async () => {
    const input = await fixture();
    const item = await addItem(input.householdId, 'Opened milk');
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { openedTrackingEnabled: true },
    });
    const opened = await prisma.stockBatch.create({
      data: {
        itemId: item.id,
        quantity: '0.5',
        openedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const unopened = await prisma.stockBatch.create({
      data: {
        itemId: item.id,
        quantity: '1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await checks.list(input.actorId, input.householdId, input.tripId);
    await expect(
      checks.save(input.actorId, input.householdId, input.tripId, item.id, {
        decision: 'CORRECT',
        expectedRevision: 0,
        quantity: '0.5',
      }),
    ).rejects.toThrow('BATCH_DETAIL_REQUIRED');
    await checks.save(input.actorId, input.householdId, input.tripId, item.id, {
      decision: 'CORRECT',
      expectedRevision: 0,
      quantity: '0.5',
      batches: [
        { batchId: opened.id, quantity: '0.5' },
        { batchId: unopened.id, quantity: '0' },
      ],
    });
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
    ).toBe('0');
  });
});
