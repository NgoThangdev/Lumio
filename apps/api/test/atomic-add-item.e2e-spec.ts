import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { CatalogService } from '../src/inventory/catalog.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { InventoryReadService } from '../src/inventory/inventory-read.service.js';
import { NeedsAttentionService } from '../src/inventory/needs-attention.service.js';
import { InventoryStateService } from '../src/inventory/inventory-state.service.js';
import { addCalendarDays } from '../src/inventory/stock-intelligence.js';
import { localCalendarDate } from '../src/inventory/plan-use.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Atomic Add Item and household catalog (database; run after migration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let catalog: CatalogService;
  let inventory: InventoryService;
  let inventoryRead: InventoryReadService;
  let needsAttention: NeedsAttentionService;
  let inventoryState: InventoryStateService;
  let userIds: string[];
  let householdIds: string[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    catalog = app.get(CatalogService);
    inventory = app.get(InventoryService);
    inventoryRead = app.get(InventoryReadService);
    needsAttention = app.get(NeedsAttentionService);
    inventoryState = app.get(InventoryStateService);
  });

  beforeEach(() => {
    userIds = [];
    householdIds = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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
    await prisma.inventoryStateAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryItemTag.deleteMany({
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
    await prisma.tag.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.membership.deleteMany({
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
  });

  afterAll(async () => app.close());

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
      data: { id: householdId, name: `Add Item fixture ${householdId}` },
    });
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'ADMIN' },
    });
    const category = await catalog.create(
      actorId,
      householdId,
      'categories',
      'Cleaning',
    );
    const location = await catalog.create(
      actorId,
      householdId,
      'locations',
      'Laundry area',
    );
    const tag = await catalog.create(
      actorId,
      householdId,
      'tags',
      'Refill regularly',
    );
    return {
      actorId,
      householdId,
      categoryId: category.id,
      locationId: location.id,
      tagIds: [tag.id],
    };
  }

  it('creates positive initial quantity as a located batch and INITIAL_STOCK activity', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: 'Detergent',
      primaryUnit: 'bottle',
      trackingMode: 'QUANTITY',
      initialStock: { quantity: '2.500001' },
    });
    const read = await inventory.readItem({ ...scope, itemId: item.id });
    expect(read.categoryId).toBe(scope.categoryId);
    expect(read.preferredRestockLocationId).toBe(scope.locationId);
    expect(read.preferredRestockLocation).toMatchObject({
      id: scope.locationId,
    });
    expect(read.tagLinks.map((link) => link.tagId)).toEqual(scope.tagIds);
    expect(read.batches).toHaveLength(1);
    expect(read.batches[0]).toMatchObject({
      locationId: scope.locationId,
      quantity: expect.anything(),
    });
    expect(read.batches[0].quantity.toString()).toBe('2.500001');
    expect(read.actions).toHaveLength(1);
    expect(read.actions[0]).toMatchObject({
      type: 'INITIAL_STOCK',
      userId: scope.actorId,
      quantity: expect.anything(),
    });
    expect(read.actions[0].allocations).toHaveLength(1);
    expect(read.actions[0].allocations[0].quantity.toString()).toBe('2.500001');
  });

  it('creates zero quantity without a batch or stock-change action', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: 'Empty box',
      primaryUnit: 'box',
      trackingMode: 'QUANTITY',
      initialStock: { quantity: '0' },
    });
    const read = await inventory.readItem({ ...scope, itemId: item.id });
    expect(read.batches).toEqual([]);
    expect(read.actions).toEqual([]);
    expect(read.categoryId).toBe(scope.categoryId);
    expect(read.preferredRestockLocationId).toBe(scope.locationId);
    expect(read.preferredRestockLocation).toMatchObject({
      id: scope.locationId,
    });
  });

  it('uses the required Add Item location as the default for first Restock at zero stock', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: 'Empty detergent',
      primaryUnit: 'bottle',
      trackingMode: 'QUANTITY',
      initialStock: { quantity: '0' },
    });

    const result = await inventory.restockQuantity({
      actorId: scope.actorId,
      householdId: scope.householdId,
      itemId: item.id,
      quantity: '1',
    });

    expect(result.batch.locationId).toBe(scope.locationId);
    const read = await inventory.readItem({ ...scope, itemId: item.id });
    expect(read.preferredRestockLocationId).toBe(scope.locationId);
    expect(read.batches).toHaveLength(1);
    expect(read.batches[0].locationId).toBe(scope.locationId);
  });

  it('initializes five-level and presence modes with state activity, not quantity allocations', async () => {
    const scope = await fixture();
    const five = await inventory.createItem({
      ...scope,
      name: 'Soap',
      primaryUnit: 'bottle',
      trackingMode: 'FIVE_LEVEL',
      initialStock: { level: 'QUARTER', backupCount: 2 },
    });
    const presence = await inventory.createItem({
      ...scope,
      name: 'Spare bulb',
      primaryUnit: 'bulb',
      trackingMode: 'PRESENCE_BACKUP',
      initialStock: { present: true, backupCount: 1 },
    });
    const reads = await Promise.all(
      [five, presence].map((item) =>
        inventory.readItem({ ...scope, itemId: item.id }),
      ),
    );
    expect(reads[0]).toMatchObject({
      currentLevel: 'QUARTER',
      backupCount: 2,
      currentLocationId: scope.locationId,
      backupLocationId: scope.locationId,
    });
    expect(reads[1]).toMatchObject({
      isPresent: true,
      backupCount: 1,
      currentLocationId: scope.locationId,
      backupLocationId: scope.locationId,
    });
    for (const read of reads) {
      expect(read.batches).toEqual([]);
      expect(read.actions).toEqual([]);
      expect(read.stateActions).toHaveLength(1);
      expect(read.stateActions[0]).toMatchObject({
        type: 'INITIALIZE',
        userId: scope.actorId,
        beforeBackupCount: 0,
        afterBackupCount: read.backupCount,
      });
    }
  });

  it('rejects cross-household references and non-admin catalog creation', async () => {
    const owner = await fixture();
    const other = await fixture();
    await expect(
      inventory.createItem({
        ...owner,
        categoryId: other.categoryId,
        name: 'Invalid',
        primaryUnit: 'box',
        initialStock: { quantity: '1' },
      }),
    ).rejects.toThrow('must belong to this household');
    await expect(
      inventory.createItem({
        ...owner,
        tagIds: other.tagIds,
        name: 'Invalid',
        primaryUnit: 'box',
        initialStock: { quantity: '1' },
      }),
    ).rejects.toThrow('must belong to this household');
    await expect(
      inventory.createItem({
        ...owner,
        locationId: other.locationId,
        name: 'Invalid',
        primaryUnit: 'box',
        initialStock: { quantity: '1' },
      }),
    ).rejects.toThrow('must belong to this household');
    await expect(
      inventory.createItem({
        ...owner,
        actorId: other.actorId,
        name: 'Invalid',
        primaryUnit: 'box',
        initialStock: { quantity: '1' },
      }),
    ).rejects.toThrow('Household membership');
    await expect(
      catalog.list(other.actorId, owner.householdId, 'categories'),
    ).rejects.toThrow('Household membership');
    const memberId = randomUUID();
    userIds.push(memberId);
    await prisma.user.create({
      data: {
        id: memberId,
        email: `${memberId}@example.invalid`,
        passwordHash: 'fixture-only',
      },
    });
    await prisma.membership.create({
      data: {
        userId: memberId,
        householdId: owner.householdId,
        role: 'MEMBER',
      },
    });
    await expect(
      catalog.create(memberId, owner.householdId, 'locations', 'Bathroom'),
    ).rejects.toThrow('Admin membership');
    expect(
      await prisma.inventoryItem.count({
        where: { householdId: owner.householdId },
      }),
    ).toBe(0);
  });

  it('rolls back item and tag links when the initial stock write fails', async () => {
    const scope = await fixture();
    const target = inventory as unknown as {
      createBatchAction: (tx: never, input: never) => Promise<unknown>;
    };
    const original = target.createBatchAction.bind(target);
    const spy = vi
      .spyOn(target, 'createBatchAction')
      .mockImplementationOnce(async (tx, input) => {
        await original(tx, input);
        throw new Error('fixture stock failure');
      });
    await expect(
      inventory.createItem({
        ...scope,
        name: 'Rollback item',
        primaryUnit: 'box',
        initialStock: { quantity: '1' },
      }),
    ).rejects.toThrow('fixture stock failure');
    spy.mockRestore();
    expect(
      await prisma.inventoryItem.count({
        where: { householdId: scope.householdId },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryItemTag.count({
        where: { tagId: scope.tagIds[0] },
      }),
    ).toBe(0);
    expect(
      await prisma.stockBatch.count({
        where: { locationId: scope.locationId },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryAction.count({
        where: { householdId: scope.householdId },
      }),
    ).toBe(0);
  });

  it('filters inventory independently, groups local stock, and ranks explainable Home attention', async () => {
    const scope = await fixture();
    const pantry = await catalog.create(
      scope.actorId,
      scope.householdId,
      'locations',
      'Pantry',
    );
    const milk = await inventory.createItem({
      ...scope,
      name: 'Milk',
      primaryUnit: 'box',
      initialStock: { quantity: '6' },
    });
    const second = await inventory.restockQuantity({
      actorId: scope.actorId,
      householdId: scope.householdId,
      itemId: milk.id,
      quantity: '4.5',
    });
    await prisma.stockBatch.update({
      where: { id: second.batch.id },
      data: { locationId: pantry.id },
    });
    await inventory.configureItem({
      actorId: scope.actorId,
      householdId: scope.householdId,
      itemId: milk.id,
      minimumStock: null,
      lowStockThreshold: '12',
      buyThreshold: null,
      targetStock: null,
      neverRunOut: false,
      predictionEnabled: false,
    });
    const tomorrow = addCalendarDays(localCalendarDate(new Date()), 1);
    const expiring = await inventory.createItem({
      ...scope,
      name: 'Beef',
      primaryUnit: 'pack',
      initialStock: {
        quantity: '2',
        expiryDate: new Date(`${tomorrow}T00:00:00.000Z`),
      },
    });
    const empty = await inventory.createItem({
      ...scope,
      name: 'Empty rice',
      primaryUnit: 'bag',
      initialStock: { quantity: '0' },
    });
    const soap = await inventory.createItem({
      ...scope,
      name: 'Soap',
      primaryUnit: 'bottle',
      trackingMode: 'FIVE_LEVEL',
      initialStock: { level: 'QUARTER', backupCount: 0 },
    });
    await inventoryState.configure(
      scope.actorId,
      scope.householdId,
      soap.id,
      'HALF',
      'QUARTER',
      true,
    );

    const read = (query: Record<string, unknown>) =>
      inventoryRead.inventory(scope.actorId, scope.householdId, query);
    const ids = async (query: Record<string, unknown>) =>
      (await read(query)).items.map((entry) => entry.item.id);
    expect(await ids({ q: 'MIL' })).toEqual([milk.id]);
    expect(await ids({ categoryId: scope.categoryId })).toHaveLength(4);
    expect(await ids({ tagId: scope.tagIds[0] })).toHaveLength(4);
    expect(await ids({ locationId: pantry.id })).toEqual([milk.id]);
    expect(await ids({ status: 'EXPIRING' })).toEqual([expiring.id]);
    expect(await ids({ status: 'OUT' })).toEqual([empty.id]);
    expect(await ids({ status: 'LOW' })).toHaveLength(3);
    expect(
      await ids({
        q: 'MIL',
        categoryId: scope.categoryId,
        locationId: pantry.id,
        tagId: scope.tagIds[0],
        status: 'LOW',
      }),
    ).toEqual([milk.id]);
    expect(await ids({ status: 'OPENED' })).toEqual([]);

    const grouped = await read({ q: 'MIL', groupBy: 'location' });
    expect(grouped.items[0].assessment.physicalStock).toBe('10.5');
    expect(
      grouped.groups?.map((group) => ({
        id: group.id,
        quantity: group.entries[0].quantity,
      })),
    ).toEqual([
      { id: scope.locationId, quantity: '6' },
      { id: pantry.id, quantity: '4.5' },
    ]);
    const local = await read({
      q: 'MIL',
      locationId: pantry.id,
      groupBy: 'location',
    });
    expect(local.groups?.map((group) => group.id)).toEqual([pantry.id]);
    expect(local.groups?.[0].entries[0].quantity).toBe('4.5');

    const attention = await needsAttention.list(
      scope.actorId,
      scope.householdId,
    );
    expect(attention.items.map((item) => item.itemId)).toEqual([
      empty.id,
      soap.id,
      expiring.id,
      milk.id,
    ]);
    expect(attention.items.map((item) => item.action)).toEqual([
      'BUY',
      'BUY',
      'USE_SOON',
      'VIEW_ITEM',
    ]);
    expect(attention.items[2].reason).toContain('expires');
    expect(attention.items[2].lowStockRisk).toBe('OK');
    await expect(
      inventoryRead.inventory(randomUUID(), scope.householdId, { q: 'Milk' }),
    ).rejects.toThrow('membership');
    await expect(
      needsAttention.list(randomUUID(), scope.householdId),
    ).rejects.toThrow('membership');
  });
});
