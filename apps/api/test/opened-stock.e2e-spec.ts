import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { addCalendarDays } from '../src/inventory/stock-intelligence.js';
import { localCalendarDate } from '../src/inventory/plan-use.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ShoppingService } from '../src/shopping/shopping.service.js';

describe('Opened quantity stock (database, requires opened_quantity_stock migration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let shopping: ShoppingService;
  const users: string[] = [];
  const households: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    inventory = app.get(InventoryService);
    shopping = app.get(ShoppingService);
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
    const actionIds = actions.map((action) => action.id);
    const trips = await prisma.shoppingTrip.findMany({
      where: { householdId: { in: households } },
      select: { id: true },
    });
    await prisma.openTransfer.deleteMany({
      where: { actionId: { in: actionIds } },
    });
    await prisma.actionBatchAllocation.deleteMany({
      where: { actionId: { in: actionIds } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { id: { in: actionIds } },
    });
    await prisma.shoppingEntry.deleteMany({
      where: { tripId: { in: trips.map((trip) => trip.id) } },
    });
    await prisma.shoppingTrip.deleteMany({
      where: { id: { in: trips.map((trip) => trip.id) } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
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
        passwordHash: 'fixture-only',
      },
    });
    await prisma.household.create({
      data: { id: householdId, name: 'Opened fixture' },
    });
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'ADMIN' },
    });
    const location = await prisma.location.create({
      data: { householdId, name: 'Fixture shelf', nameKey: randomUUID() },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        householdId,
        name: 'Milk',
        primaryUnit: 'box',
        trackingMode: 'QUANTITY',
        openedTrackingEnabled: true,
        recommendedDaysAfterOpening: 2,
        preferredRestockLocationId: location.id,
      },
    });
    return { actorId, householdId, itemId: item.id };
  }

  it('splits one container, records its source, and Finish counts as consumption', async () => {
    const input = await fixture();
    const source = await prisma.stockBatch.create({
      data: {
        itemId: input.itemId,
        quantity: '3',
        expiryDate: new Date('2099-01-01T00:00:00.000Z'),
      },
    });
    const opened = await inventory.openQuantity(
      input.actorId,
      input.householdId,
      input.itemId,
    );
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: source.id } })
      ).quantity.toString(),
    ).toBe('2');
    expect(opened.batch.quantity.toString()).toBe('1');
    const afterOpen = await inventory.readItem(input);
    expect(afterOpen.openedQuantity).toBe('1');
    expect(afterOpen.unopenedQuantity).toBe('2');
    expect(
      afterOpen.batches.reduce((sum, batch) => sum + Number(batch.quantity), 0),
    ).toBe(3);
    expect(
      await prisma.openTransfer.findUniqueOrThrow({
        where: { actionId: opened.action.id },
      }),
    ).toMatchObject({
      sourceBatchId: source.id,
      openedBatchId: opened.batch.id,
    });
    const finished = await inventory.finishOpened(
      input.actorId,
      input.householdId,
      input.itemId,
    );
    expect(finished.type).toBe('FINISH_OPENED');
    expect(finished.quantity.toString()).toBe('1');
    expect((await inventory.readItem(input)).openedQuantity).toBe('0');
  });

  it('rolls back automatic Open when a later step fails', async () => {
    const input = await fixture();
    await prisma.stockBatch.create({
      data: { itemId: input.itemId, quantity: '2' },
    });
    const service = inventory as unknown as {
      openOneInTransaction: (...args: unknown[]) => Promise<unknown>;
    };
    const original = service.openOneInTransaction.bind(inventory);
    let calls = 0;
    const spy = vi
      .spyOn(service, 'openOneInTransaction')
      .mockImplementation(async (...args) => {
        const result = await original(...args);
        if (++calls === 2)
          throw new ConflictException('Fixture failure after Open.');
        return result;
      });
    await expect(
      inventory.useQuantity({ ...input, quantity: '1.5' }),
    ).rejects.toThrow('Fixture failure');
    spy.mockRestore();
    expect((await inventory.readItem(input)).unopenedQuantity).toBe('2');
    expect(
      await prisma.openTransfer.count({
        where: { sourceBatch: { itemId: input.itemId } },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryAction.count({ where: { itemId: input.itemId } }),
    ).toBe(0);
  });

  it('isolates households and serializes competing Uses', async () => {
    const input = await fixture();
    const other = await fixture();
    await prisma.stockBatch.create({
      data: { itemId: input.itemId, quantity: '1' },
    });
    await expect(
      inventory.openQuantity(other.actorId, input.householdId, input.itemId),
    ).rejects.toThrow('Household membership');
    await expect(
      inventory.openQuantity(other.actorId, other.householdId, input.itemId),
    ).rejects.toThrow('not found');
    const results = await Promise.allSettled([
      inventory.useQuantity({ ...input, quantity: '0.75' }),
      inventory.useQuantity({ ...input, quantity: '0.75' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await inventory.readItem(input)).openedQuantity).toBe('0.25');
    expect(
      await prisma.openTransfer.count({
        where: { sourceBatch: { itemId: input.itemId } },
      }),
    ).toBe(1);
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId: input.itemId },
      select: { type: true, quantity: true, userId: true },
    });
    expect(
      actions
        .map((action) => [
          action.type,
          action.quantity.toString(),
          action.userId,
        ])
        .sort((left, right) => left[0]!.localeCompare(right[0]!)),
    ).toEqual([
      ['OPEN', '1', input.actorId],
      ['USE', '0.75', input.actorId],
    ]);
  });

  it('Shopping Finish restocks unopened packages', async () => {
    const input = await fixture();
    const trip = await shopping.create(
      input.actorId,
      input.householdId,
      'Store',
      addCalendarDays(localCalendarDate(new Date()), 1),
    );
    const added = await shopping.addManual(
      input.actorId,
      input.householdId,
      trip.id,
      input.itemId,
    );
    await shopping.start(input.actorId, input.householdId, trip.id);
    await shopping.decideEntry(
      input.actorId,
      input.householdId,
      trip.id,
      added.entries[0].id,
      'PURCHASED',
      '2',
      null,
    );
    await shopping.finish(input.actorId, input.householdId, trip.id);
    const detail = await inventory.readItem(input);
    expect(detail.unopenedQuantity).toBe('2');
    expect(detail.openedQuantity).toBe('0');
    expect(detail.batches).toHaveLength(1);
    expect(detail.batches[0].openedAt).toBeNull();
  });
});
