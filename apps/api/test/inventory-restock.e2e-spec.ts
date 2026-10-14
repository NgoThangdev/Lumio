import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { Prisma } from '../src/generated/prisma/browser.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('InventoryService Restock (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let userIds: string[];
  let householdIds: string[];
  let itemIds: string[];

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
    itemIds = [];
  });

  afterEach(async () => {
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
      await prisma.inventoryAction.count({
        where: { itemId: { in: itemIds } },
      }),
    ).toBe(0);
    expect(
      await prisma.stockBatch.count({ where: { itemId: { in: itemIds } } }),
    ).toBe(0);
    expect(
      await prisma.inventoryItem.count({ where: { id: { in: itemIds } } }),
    ).toBe(0);
    expect(
      await prisma.household.count({ where: { id: { in: householdIds } } }),
    ).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: userIds } } })).toBe(0);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        passwordHash: 'fixture-only',
      },
    });
    return id;
  }

  async function createHousehold(): Promise<string> {
    const id = randomUUID();
    householdIds.push(id);
    await prisma.household.create({
      data: { id, name: `Restock fixture ${id}` },
    });
    return id;
  }

  async function createFixture() {
    const actorId = await createUser();
    const householdId = await createHousehold();
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'MEMBER' },
    });
    const itemId = randomUUID();
    itemIds.push(itemId);
    const location = await prisma.location.create({
      data: { householdId, name: 'Fixture shelf', nameKey: randomUUID() },
    });
    await prisma.inventoryItem.create({
      data: {
        id: itemId,
        householdId,
        name: 'Test item',
        primaryUnit: 'unit',
        preferredRestockLocationId: location.id,
      },
    });
    return { actorId, householdId, itemId };
  }

  async function stockAndActivity(itemId: string) {
    const batches = await prisma.stockBatch.findMany({ where: { itemId } });
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId },
      include: { allocations: true },
      orderBy: { createdAt: 'asc' },
    });
    return { batches, actions };
  }

  it('creates one new batch, RESTOCK action, and positive allocation', async () => {
    const input = await createFixture();
    const expiryDate = new Date('2099-01-01T00:00:00.000Z');

    const result = await inventory.restockQuantity({
      ...input,
      quantity: '2.500001',
      expiryDate,
    });
    const { batches, actions } = await stockAndActivity(input.itemId);

    expect(batches).toHaveLength(1);
    expect(result.batch.id).toBe(batches[0].id);
    expect(batches[0].quantity.toString()).toBe('2.500001');
    expect(batches[0].expiryDate?.toISOString().slice(0, 10)).toBe(
      '2099-01-01',
    );
    expect(actions).toHaveLength(1);
    expect(result.action.id).toBe(actions[0].id);
    expect(actions[0]).toMatchObject({
      householdId: input.householdId,
      itemId: input.itemId,
      userId: input.actorId,
      type: 'RESTOCK',
    });
    expect(actions[0].quantity.toString()).toBe('2.500001');
    expect(actions[0].allocations).toHaveLength(1);
    expect(actions[0].allocations[0].batchId).toBe(batches[0].id);
    expect(actions[0].allocations[0].quantity.toString()).toBe('2.500001');
  });

  it('uses an explicit location and remembers it for the next Restock', async () => {
    const input = await createFixture();
    const override = await prisma.location.create({
      data: {
        householdId: input.householdId,
        name: 'Second shelf',
        nameKey: randomUUID(),
      },
    });

    const first = await inventory.restockQuantity({
      ...input,
      quantity: '2',
      locationId: override.id,
    });
    const next = await inventory.restockQuantity({ ...input, quantity: '1' });

    expect(first.batch.locationId).toBe(override.id);
    expect(next.batch.locationId).toBe(override.id);
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: input.itemId },
        })
      ).preferredRestockLocationId,
    ).toBe(override.id);
  });

  it('uses the same item latest located batch for a legacy item', async () => {
    const input = await createFixture();
    const item = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: input.itemId },
    });
    await prisma.inventoryItem.update({
      where: { id: input.itemId },
      data: { preferredRestockLocationId: null },
    });
    await prisma.stockBatch.create({
      data: {
        itemId: input.itemId,
        quantity: '1',
        locationId: item.preferredRestockLocationId,
      },
    });

    const restock = await inventory.restockQuantity({
      ...input,
      quantity: '2',
    });

    expect(restock.batch.locationId).toBe(item.preferredRestockLocationId);
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: input.itemId },
        })
      ).preferredRestockLocationId,
    ).toBe(item.preferredRestockLocationId);
  });

  it('rejects missing and cross-household locations without stock writes', async () => {
    const input = await createFixture();
    await prisma.inventoryItem.update({
      where: { id: input.itemId },
      data: { preferredRestockLocationId: null },
    });

    await expect(
      inventory.restockQuantity({ ...input, quantity: '1' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'LOCATION_REQUIRED',
        itemId: input.itemId,
      }),
    });
    const otherHouseholdId = await createHousehold();
    const foreignLocation = await prisma.location.create({
      data: {
        householdId: otherHouseholdId,
        name: 'Foreign shelf',
        nameKey: randomUUID(),
      },
    });
    await expect(
      inventory.restockQuantity({
        ...input,
        quantity: '1',
        locationId: foreignLocation.id,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'LOCATION_NOT_FOUND',
        itemId: input.itemId,
      }),
    });
    expect(await stockAndActivity(input.itemId)).toEqual({
      batches: [],
      actions: [],
    });
  });

  it.each([
    ['1.0000000', 'more than six decimal places'],
    ['1000000000000', 'Decimal(18,6) maximum'],
    ['0', 'greater than zero'],
  ])('rejects invalid quantity %s without writes', async (quantity, reason) => {
    const input = await createFixture();

    await expect(
      inventory.restockQuantity({ ...input, quantity }),
    ).rejects.toThrow(reason);
    expect(await stockAndActivity(input.itemId)).toEqual({
      batches: [],
      actions: [],
    });
  });

  it('rejects a non-member without writes', async () => {
    const input = await createFixture();
    const outsiderId = await createUser();

    await expect(
      inventory.restockQuantity({
        ...input,
        actorId: outsiderId,
        quantity: '1',
      }),
    ).rejects.toThrow('Household membership is required');
    expect(await stockAndActivity(input.itemId)).toEqual({
      batches: [],
      actions: [],
    });
  });

  it('rejects a household/item mismatch without writes', async () => {
    const input = await createFixture();
    const otherHouseholdId = await createHousehold();
    await prisma.membership.create({
      data: {
        userId: input.actorId,
        householdId: otherHouseholdId,
        role: 'MEMBER',
      },
    });

    await expect(
      inventory.restockQuantity({
        ...input,
        householdId: otherHouseholdId,
        quantity: '1',
      }),
    ).rejects.toThrow('Inventory item was not found in this household');
    expect(await stockAndActivity(input.itemId)).toEqual({
      batches: [],
      actions: [],
    });
  });

  it('allows a later Use to consume from the new undated batch', async () => {
    const input = await createFixture();
    const restock = await inventory.restockQuantity({
      ...input,
      quantity: '4',
    });
    const use = await inventory.useQuantity({ ...input, quantity: '1.5' });
    const { batches, actions } = await stockAndActivity(input.itemId);

    expect(batches).toHaveLength(1);
    expect(batches[0].id).toBe(restock.batch.id);
    expect(batches[0].expiryDate).toBeNull();
    expect(batches[0].quantity.toString()).toBe('2.5');
    expect(actions).toHaveLength(2);
    expect(new Set(actions.map((action) => action.type))).toEqual(
      new Set(['RESTOCK', 'USE']),
    );
    expect(restock.action.allocations[0].quantity.toString()).toBe('4');
    expect(use.allocations[0].quantity.toString()).toBe('1.5');
    expect(restock.action.allocations[0].batchId).toBe(
      use.allocations[0].batchId,
    );
  });

  it('keeps concurrent Restock and Use consistent on one item', async () => {
    const input = await createFixture();
    await inventory.restockQuantity({ ...input, quantity: '1' });

    const [restock, use] = await Promise.allSettled([
      inventory.restockQuantity({ ...input, quantity: '1' }),
      inventory.useQuantity({ ...input, quantity: '1.5' }),
    ]);
    const { batches, actions } = await stockAndActivity(input.itemId);
    const total = batches.reduce(
      (sum, batch) => sum.plus(batch.quantity),
      new Prisma.Decimal(0),
    );

    expect(restock.status).toBe('fulfilled');
    if (use.status === 'fulfilled') {
      expect(total.toString()).toBe('0.5');
      expect(actions.filter((action) => action.type === 'USE')).toHaveLength(1);
    } else {
      expect(total.toString()).toBe('2');
      expect(actions.filter((action) => action.type === 'USE')).toHaveLength(0);
    }
    expect(batches.every((batch) => batch.quantity.gte(0))).toBe(true);
    expect(actions.filter((action) => action.type === 'RESTOCK')).toHaveLength(
      2,
    );
  });
});
