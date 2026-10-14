import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { Prisma } from '../src/generated/prisma/browser.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('InventoryService core path (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let userIds: string[];
  let householdIds: string[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    inventory = app.get(InventoryService);
  });

  beforeEach(() => {
    userIds = [];
    householdIds = [];
  });

  afterEach(async () => {
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
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
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.membership.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.location.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });

    expect(
      await prisma.inventoryItem.count({
        where: { householdId: { in: householdIds } },
      }),
    ).toBe(0);
    expect(
      await prisma.household.count({ where: { id: { in: householdIds } } }),
    ).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: userIds } } })).toBe(0);
  });

  afterAll(async () => {
    await app.close();
  });

  async function fixture() {
    const actorId = randomUUID();
    const householdId = randomUUID();
    userIds.push(actorId);
    householdIds.push(householdId);
    await prisma.user.create({
      data: {
        id: actorId,
        email: `${actorId}@example.invalid`,
        passwordHash: 'fixture-only',
      },
    });
    await prisma.household.create({
      data: { id: householdId, name: `Core fixture ${householdId}` },
    });
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'MEMBER' },
    });
    return { actorId, householdId };
  }

  async function locateItem(itemId: string, householdId: string) {
    const location = await prisma.location.create({
      data: { householdId, name: 'Fixture shelf', nameKey: randomUUID() },
    });
    await prisma.inventoryItem.update({
      where: { id: itemId },
      data: { preferredRestockLocationId: location.id },
    });
  }

  it('creates an empty item, restocks two batches, uses FEFO, and reads activity', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: '  Rice  ',
      primaryUnit: '  kg  ',
    });
    await locateItem(item.id, scope.householdId);
    expect(item).toMatchObject({
      householdId: scope.householdId,
      name: 'Rice',
      primaryUnit: 'kg',
    });
    const empty = await inventory.readItem({ ...scope, itemId: item.id });
    expect(empty.batches).toEqual([]);
    expect(empty.actions).toEqual([]);

    const later = await inventory.restockQuantity({
      ...scope,
      itemId: item.id,
      quantity: '4',
      expiryDate: new Date('2099-02-01T00:00:00.000Z'),
    });
    const earlier = await inventory.restockQuantity({
      ...scope,
      itemId: item.id,
      quantity: '2.500001',
      expiryDate: new Date('2099-01-01T00:00:00.000Z'),
    });
    const use = await inventory.useQuantity({
      ...scope,
      itemId: item.id,
      quantity: '3',
    });
    const read = await inventory.readItem({ ...scope, itemId: item.id });
    const quantities = new Map(
      read.batches.map((batch) => [batch.id, batch.quantity.toString()]),
    );
    expect(quantities).toEqual(
      new Map([
        [later.batch.id, '3.500001'],
        [earlier.batch.id, '0'],
      ]),
    );
    expect(read.actions).toHaveLength(3);
    expect(
      read.actions.filter((action) => action.type === 'RESTOCK'),
    ).toHaveLength(2);
    expect(read.actions.filter((action) => action.type === 'USE')).toHaveLength(
      1,
    );
    expect(
      new Map(
        use.allocations.map((allocation) => [
          allocation.batchId,
          allocation.quantity.toString(),
        ]),
      ),
    ).toEqual(
      new Map([
        [earlier.batch.id, '2.500001'],
        [later.batch.id, '0.499999'],
      ]),
    );
    expect(
      read.actions.every((action) => action.userId === scope.actorId),
    ).toBe(true);
    expect(
      read.actions
        .map((action) => action.allocations.length)
        .sort((left, right) => left - right),
    ).toEqual([1, 1, 2]);
  });

  it('rejects invalid create, restock and Use without changing stock or history', async () => {
    const scope = await fixture();
    await expect(
      inventory.createItem({ ...scope, name: ' ', primaryUnit: 'kg' }),
    ).rejects.toThrow('Item name and primary unit are required');
    expect(
      await prisma.inventoryItem.count({
        where: { householdId: scope.householdId },
      }),
    ).toBe(0);

    const item = await inventory.createItem({
      ...scope,
      name: 'Rice',
      primaryUnit: 'kg',
    });
    await locateItem(item.id, scope.householdId);
    await inventory.restockQuantity({
      ...scope,
      itemId: item.id,
      quantity: '2',
    });
    await expect(
      inventory.restockQuantity({
        ...scope,
        itemId: item.id,
        quantity: '1.0000001',
      }),
    ).rejects.toThrow('more than six decimal places');
    await expect(
      inventory.useQuantity({ ...scope, itemId: item.id, quantity: '3' }),
    ).rejects.toThrow('Insufficient eligible stock');
    const read = await inventory.readItem({ ...scope, itemId: item.id });
    expect(read.batches.map((batch) => batch.quantity.toString())).toEqual([
      '2',
    ]);
    expect(read.actions.map((action) => action.type)).toEqual(['RESTOCK']);
  });

  it('enforces membership and household ownership on create and read', async () => {
    const scope = await fixture();
    const outsiderId = randomUUID();
    userIds.push(outsiderId);
    await prisma.user.create({
      data: {
        id: outsiderId,
        email: `${outsiderId}@example.invalid`,
        passwordHash: 'fixture-only',
      },
    });
    await expect(
      inventory.createItem({
        ...scope,
        actorId: outsiderId,
        name: 'Rice',
        primaryUnit: 'kg',
      }),
    ).rejects.toThrow('Household membership is required');
    const item = await inventory.createItem({
      ...scope,
      name: 'Rice',
      primaryUnit: 'kg',
    });
    await expect(
      inventory.readItem({ ...scope, actorId: outsiderId, itemId: item.id }),
    ).rejects.toThrow('Household membership is required');

    const otherHouseholdId = randomUUID();
    householdIds.push(otherHouseholdId);
    await prisma.household.create({
      data: { id: otherHouseholdId, name: `Other fixture ${otherHouseholdId}` },
    });
    await prisma.membership.create({
      data: {
        userId: scope.actorId,
        householdId: otherHouseholdId,
        role: 'MEMBER',
      },
    });
    await expect(
      inventory.readItem({
        ...scope,
        householdId: otherHouseholdId,
        itemId: item.id,
      }),
    ).rejects.toThrow('Inventory item was not found in this household');
  });

  it('keeps concurrent Restock and Use allocations consistent with batch stock', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: 'Rice',
      primaryUnit: 'kg',
    });
    await locateItem(item.id, scope.householdId);
    await inventory.restockQuantity({
      ...scope,
      itemId: item.id,
      quantity: '1',
    });
    const [restock, use] = await Promise.allSettled([
      inventory.restockQuantity({ ...scope, itemId: item.id, quantity: '1' }),
      inventory.useQuantity({ ...scope, itemId: item.id, quantity: '1.5' }),
    ]);
    expect(restock.status).toBe('fulfilled');
    const read = await inventory.readItem({ ...scope, itemId: item.id });
    const expected = new Map(
      read.batches.map((batch) => [batch.id, new Prisma.Decimal(0)]),
    );
    for (const action of read.actions) {
      for (const allocation of action.allocations) {
        const previous = expected.get(allocation.batchId);
        expect(previous).toBeDefined();
        expected.set(
          allocation.batchId,
          action.type === 'RESTOCK'
            ? previous!.plus(allocation.quantity)
            : previous!.minus(allocation.quantity),
        );
      }
    }
    for (const batch of read.batches) {
      expect(batch.quantity.gte(0)).toBe(true);
      expect(batch.quantity.toString()).toBe(
        expected.get(batch.id)?.toString(),
      );
    }
    expect(read.actions.filter((action) => action.type === 'USE')).toHaveLength(
      use.status === 'fulfilled' ? 1 : 0,
    );
  });
});
