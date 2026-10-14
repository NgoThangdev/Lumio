import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { addCalendarDays } from '../src/inventory/stock-intelligence.js';
import { localCalendarDate } from '../src/inventory/plan-use.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ShoppingService } from '../src/shopping/shopping.service.js';

describe('Shopping Move to next trip (database; requires Move migration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shopping: ShoppingService;
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
  });

  afterAll(async () => {
    vi.restoreAllMocks();
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
    await prisma.actionBatchAllocation.deleteMany({
      where: { actionId: { in: actions.map((action) => action.id) } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.shoppingEntry.deleteMany({
      where: { tripId: { in: tripIds } },
    });
    await prisma.shoppingTrip.deleteMany({ where: { id: { in: tripIds } } });
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
      data: { id: householdId, name: 'Move fixture' },
    });
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'ADMIN' },
    });
    const location = await prisma.location.create({
      data: {
        householdId,
        name: 'Shelf',
        nameKey: randomUUID(),
      },
    });
    const source = await shopping.create(
      actorId,
      householdId,
      'First store',
      addCalendarDays(localCalendarDate(new Date()), 1),
    );
    const destination = await shopping.create(
      actorId,
      householdId,
      'Next store',
      addCalendarDays(localCalendarDate(new Date()), 7),
    );
    return {
      actorId,
      householdId,
      locationId: location.id,
      sourceId: source.id,
      destinationId: destination.id,
    };
  }

  async function item(f: Awaited<ReturnType<typeof fixture>>, name: string) {
    return prisma.inventoryItem.create({
      data: {
        householdId: f.householdId,
        name,
        primaryUnit: 'box',
        trackingMode: 'QUANTITY',
        preferredRestockLocationId: f.locationId,
      },
    });
  }

  async function entry(
    f: Awaited<ReturnType<typeof fixture>>,
    itemId: string,
    tripId = f.sourceId,
  ) {
    const trip = await shopping.addManual(
      f.actorId,
      f.householdId,
      tripId,
      itemId,
    );
    return trip.entries.find((row) => row.itemId === itemId)!;
  }

  async function move(
    f: Awaited<ReturnType<typeof fixture>>,
    entryId: string,
    destinationId = f.destinationId,
  ) {
    return shopping.decideEntry(
      f.actorId,
      f.householdId,
      f.sourceId,
      entryId,
      'MOVED',
      undefined,
      undefined,
      undefined,
      destinationId,
    );
  }

  it('keeps Skip distinct, saves Move intent, and carries exactly once at Finish', async () => {
    const f = await fixture();
    const movedItem = await item(f, 'Moved');
    const skippedItem = await item(f, 'Skipped');
    const otherDraft = await shopping.create(
      f.actorId,
      f.householdId,
      'Other draft',
      addCalendarDays(localCalendarDate(new Date()), 10),
    );
    const moved = await entry(f, movedItem.id);
    const skipped = await entry(f, skippedItem.id);
    await shopping.start(f.actorId, f.householdId, f.sourceId);
    const intent = await move(f, moved.id);
    await move(f, moved.id);
    expect(intent.entries.find((row) => row.id === moved.id)).toMatchObject({
      status: 'MOVED',
      moveToTripId: f.destinationId,
    });
    expect(
      (await shopping.read(f.actorId, f.householdId, f.destinationId)).entries,
    ).toHaveLength(0);
    await shopping.decideEntry(
      f.actorId,
      f.householdId,
      f.sourceId,
      skipped.id,
      'SKIPPED',
      undefined,
      undefined,
    );
    const finished = await shopping.finish(
      f.actorId,
      f.householdId,
      f.sourceId,
    );
    expect(finished.status).toBe('RESTOCKED');
    expect(finished.entries.find((row) => row.id === moved.id)?.status).toBe(
      'MOVED',
    );
    const next = await shopping.read(f.actorId, f.householdId, f.destinationId);
    expect(next.entries).toHaveLength(1);
    expect(
      (await shopping.read(f.actorId, f.householdId, otherDraft.id)).entries,
    ).toHaveLength(0);
    expect(next.entries[0]).toMatchObject({
      itemId: movedItem.id,
      status: 'PENDING',
      source: 'MANUAL',
      suggestedQuantity: null,
    });
    await shopping.finish(f.actorId, f.householdId, f.sourceId);
    expect(
      await prisma.shoppingEntry.count({ where: { tripId: f.destinationId } }),
    ).toBe(1);
    expect(
      await prisma.inventoryAction.count({
        where: { itemId: { in: [movedItem.id, skippedItem.id] } },
      }),
    ).toBe(0);
    await expect(move(f, moved.id)).rejects.toThrow(
      'Shopping decisions require an active trip.',
    );
  });

  it('preserves existing suggested/manual destination entries and allows a later Move', async () => {
    const f = await fixture();
    const suggestedItem = await item(f, 'Suggested');
    const manualItem = await item(f, 'Manual');
    const suggested = await entry(f, suggestedItem.id);
    const manual = await entry(f, manualItem.id);
    await prisma.shoppingEntry.create({
      data: {
        tripId: f.destinationId,
        itemId: suggestedItem.id,
        source: 'SUGGESTED',
        priority: 'MUST_BUY',
        suggestedQuantity: '4',
        suggestedReason: 'Saved snapshot',
      },
    });
    await entry(f, manualItem.id, f.destinationId);
    await shopping.start(f.actorId, f.householdId, f.sourceId);
    await move(f, suggested.id);
    await move(f, manual.id);
    await shopping.finish(f.actorId, f.householdId, f.sourceId);
    const next = await shopping.read(f.actorId, f.householdId, f.destinationId);
    expect(next.entries).toHaveLength(2);
    expect(
      next.entries.find((row) => row.itemId === suggestedItem.id),
    ).toMatchObject({
      source: 'SUGGESTED',
      priority: 'MUST_BUY',
      suggestedReason: 'Saved snapshot',
    });
    expect(
      next.entries.find((row) => row.itemId === manualItem.id)?.source,
    ).toBe('MANUAL');
    const third = await shopping.create(
      f.actorId,
      f.householdId,
      'Third store',
      addCalendarDays(localCalendarDate(new Date()), 14),
    );
    await shopping.start(f.actorId, f.householdId, f.destinationId);
    const carried = next.entries.find((row) => row.itemId === manualItem.id)!;
    await shopping.decideEntry(
      f.actorId,
      f.householdId,
      f.destinationId,
      carried.id,
      'MOVED',
      undefined,
      undefined,
      undefined,
      third.id,
    );
    await shopping.finish(f.actorId, f.householdId, f.destinationId);
    expect(
      await prisma.shoppingEntry.count({
        where: { tripId: third.id, itemId: manualItem.id },
      }),
    ).toBe(1);
  });

  it('rejects foreign, self, and non-draft destinations and rolls back Finish if a destination changes', async () => {
    const f = await fixture();
    const foreign = await fixture();
    const movedItem = await item(f, 'Carry');
    const boughtItem = await item(f, 'Purchase');
    const moved = await entry(f, movedItem.id);
    const bought = await entry(f, boughtItem.id);
    await shopping.start(f.actorId, f.householdId, f.sourceId);
    await expect(move(f, moved.id, f.sourceId)).rejects.toThrow(
      'INVALID_DESTINATION_TRIP',
    );
    await expect(move(f, moved.id, foreign.destinationId)).rejects.toThrow(
      'DESTINATION_TRIP_NOT_FOUND',
    );
    await move(f, moved.id);
    await shopping.decideEntry(
      f.actorId,
      f.householdId,
      f.sourceId,
      bought.id,
      'PURCHASED',
      '2',
      undefined,
    );
    await shopping.start(f.actorId, f.householdId, f.destinationId);
    await expect(
      shopping.finish(f.actorId, f.householdId, f.sourceId),
    ).rejects.toThrow('DESTINATION_NOT_DRAFT');
    expect(
      (await shopping.read(f.actorId, f.householdId, f.sourceId)).status,
    ).toBe('SHOPPING');
    expect(
      await prisma.stockBatch.count({ where: { itemId: boughtItem.id } }),
    ).toBe(0);
    expect(
      await prisma.inventoryAction.count({ where: { itemId: boughtItem.id } }),
    ).toBe(0);
    const replacement = await shopping.create(
      f.actorId,
      f.householdId,
      'Replacement',
      addCalendarDays(localCalendarDate(new Date()), 9),
    );
    await shopping.decideEntry(
      f.actorId,
      f.householdId,
      f.sourceId,
      moved.id,
      'MOVED',
      undefined,
      undefined,
      undefined,
      replacement.id,
    );
    await shopping.finish(f.actorId, f.householdId, f.sourceId);
    expect(
      await prisma.shoppingEntry.count({
        where: { tripId: replacement.id, itemId: movedItem.id },
      }),
    ).toBe(1);
    expect(
      await prisma.stockBatch.count({ where: { itemId: boughtItem.id } }),
    ).toBe(1);
  });

  it('clears Move intent when changed to a purchase and restocks only the purchased amount', async () => {
    const f = await fixture();
    const product = await item(f, 'Changed mind');
    const row = await entry(f, product.id);
    await shopping.start(f.actorId, f.householdId, f.sourceId);
    await move(f, row.id);
    const purchased = await shopping.decideEntry(
      f.actorId,
      f.householdId,
      f.sourceId,
      row.id,
      'PURCHASED',
      '3',
      undefined,
    );
    expect(
      purchased.entries.find((entry) => entry.id === row.id)?.moveToTripId,
    ).toBeNull();
    await shopping.finish(f.actorId, f.householdId, f.sourceId);
    expect(
      await prisma.shoppingEntry.count({ where: { tripId: f.destinationId } }),
    ).toBe(0);
    expect(
      (
        await prisma.stockBatch.findFirstOrThrow({
          where: { itemId: product.id },
        })
      ).quantity.toString(),
    ).toBe('3');
  });

  it('rolls back carried entries and purchase stock if a later Finish write fails', async () => {
    const f = await fixture();
    const carriedItem = await item(f, 'Carry');
    const boughtItem = await item(f, 'Buy');
    const carried = await entry(f, carriedItem.id);
    const bought = await entry(f, boughtItem.id);
    await shopping.start(f.actorId, f.householdId, f.sourceId);
    await move(f, carried.id);
    await shopping.decideEntry(
      f.actorId,
      f.householdId,
      f.sourceId,
      bought.id,
      'PURCHASED',
      '1',
      undefined,
    );
    const target = shopping as unknown as {
      carryMovesInTransaction: ShoppingService['carryMovesInTransaction'];
    };
    const original = target.carryMovesInTransaction.bind(shopping);
    const spy = vi
      .spyOn(target, 'carryMovesInTransaction')
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new Error('forced rollback');
      });
    try {
      await expect(
        shopping.finish(f.actorId, f.householdId, f.sourceId),
      ).rejects.toThrow('forced rollback');
    } finally {
      spy.mockRestore();
    }
    expect(
      await prisma.shoppingEntry.count({ where: { tripId: f.destinationId } }),
    ).toBe(0);
    expect(
      await prisma.stockBatch.count({ where: { itemId: boughtItem.id } }),
    ).toBe(0);
    expect(
      await prisma.inventoryAction.count({ where: { itemId: boughtItem.id } }),
    ).toBe(0);
    expect(
      (await shopping.read(f.actorId, f.householdId, f.sourceId)).status,
    ).toBe('SHOPPING');
  });

  it('serializes concurrent Finish and two source trips moving one item to one draft', async () => {
    const f = await fixture();
    const product = await item(f, 'Shared');
    const first = await entry(f, product.id);
    const secondSource = await shopping.create(
      f.actorId,
      f.householdId,
      'Other source',
      addCalendarDays(localCalendarDate(new Date()), 2),
    );
    const second = await entry(f, product.id, secondSource.id);
    await shopping.start(f.actorId, f.householdId, f.sourceId);
    await shopping.start(f.actorId, f.householdId, secondSource.id);
    await move(f, first.id);
    await shopping.decideEntry(
      f.actorId,
      f.householdId,
      secondSource.id,
      second.id,
      'MOVED',
      undefined,
      undefined,
      undefined,
      f.destinationId,
    );
    await Promise.all([
      shopping.finish(f.actorId, f.householdId, f.sourceId),
      shopping.finish(f.actorId, f.householdId, f.sourceId),
    ]);
    await shopping.finish(f.actorId, f.householdId, secondSource.id);
    expect(
      await prisma.shoppingEntry.count({
        where: { tripId: f.destinationId, itemId: product.id },
      }),
    ).toBe(1);
    expect(
      await prisma.inventoryAction.count({ where: { itemId: product.id } }),
    ).toBe(0);
  });
});
