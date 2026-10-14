import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('InventoryService quantity Use (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let userIds: string[];
  let householdIds: string[];
  let itemIds: string[];
  let batchIds: string[];

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
    batchIds = [];
  });

  afterEach(async () => {
    await prisma.actionBatchAllocation.deleteMany({
      where: { batchId: { in: batchIds } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.membership.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });

    expect(
      await prisma.actionBatchAllocation.count({
        where: { batchId: { in: batchIds } },
      }),
    ).toBe(0);
    expect(
      await prisma.inventoryAction.count({
        where: { itemId: { in: itemIds } },
      }),
    ).toBe(0);
    expect(
      await prisma.stockBatch.count({ where: { id: { in: batchIds } } }),
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
    await prisma.household.create({ data: { id, name: `Use fixture ${id}` } });
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
    await prisma.inventoryItem.create({
      data: { id: itemId, householdId, name: 'Test item', primaryUnit: 'unit' },
    });
    return { actorId, householdId, itemId };
  }

  async function createBatch(
    itemId: string,
    quantity: string,
    expiryDate: string | null,
  ) {
    const id = randomUUID();
    batchIds.push(id);
    await prisma.stockBatch.create({
      data: {
        id,
        itemId,
        quantity,
        expiryDate:
          expiryDate === null ? null : new Date(`${expiryDate}T00:00:00.000Z`),
      },
    });
    return id;
  }

  async function stockAndActivity(itemId: string) {
    const batches = await prisma.stockBatch.findMany({ where: { itemId } });
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId },
      include: { allocations: true },
    });
    return { batches, actions };
  }

  it('writes only the FEFO allocations and one attributable USE action', async () => {
    const input = await createFixture();
    const early = await createBatch(input.itemId, '4', '2099-01-01');
    const later = await createBatch(input.itemId, '8', '2099-02-01');
    const expired = await createBatch(input.itemId, '10', '2000-01-01');
    const undated = await createBatch(input.itemId, '10', null);

    const action = await inventory.useQuantity({
      ...input,
      quantity: '6.500001',
    });
    const { batches, actions } = await stockAndActivity(input.itemId);
    const quantities = new Map(
      batches.map((batch) => [batch.id, batch.quantity.toString()]),
    );

    expect(quantities).toEqual(
      new Map([
        [early, '0'],
        [later, '5.499999'],
        [expired, '10'],
        [undated, '10'],
      ]),
    );
    expect(actions).toHaveLength(1);
    expect(action.id).toBe(actions[0].id);
    expect(actions[0]).toMatchObject({
      userId: input.actorId,
      householdId: input.householdId,
      itemId: input.itemId,
      type: 'USE',
    });
    expect(actions[0].quantity.toString()).toBe('6.500001');
    expect(
      new Map(
        actions[0].allocations.map((allocation) => [
          allocation.batchId,
          allocation.quantity.toString(),
        ]),
      ),
    ).toEqual(
      new Map([
        [early, '4'],
        [later, '2.500001'],
      ]),
    );
  });

  it('rejects a household/item mismatch even when the actor belongs to both households', async () => {
    const input = await createFixture();
    await createBatch(input.itemId, '4', null);
    const otherHouseholdId = await createHousehold();
    await prisma.membership.create({
      data: {
        userId: input.actorId,
        householdId: otherHouseholdId,
        role: 'MEMBER',
      },
    });

    await expect(
      inventory.useQuantity({
        ...input,
        householdId: otherHouseholdId,
        quantity: '1',
      }),
    ).rejects.toThrow('Inventory item was not found in this household');
    const { batches, actions } = await stockAndActivity(input.itemId);
    expect(batches[0].quantity.toString()).toBe('4');
    expect(actions).toHaveLength(0);
  });

  it('rejects a non-member without changing stock or activity', async () => {
    const input = await createFixture();
    await createBatch(input.itemId, '4', null);
    const outsiderId = await createUser();

    await expect(
      inventory.useQuantity({ ...input, actorId: outsiderId, quantity: '1' }),
    ).rejects.toThrow('Household membership is required');
    const { batches, actions } = await stockAndActivity(input.itemId);
    expect(batches[0].quantity.toString()).toBe('4');
    expect(actions).toHaveLength(0);
  });

  it('rejects more than six fractional digits without rounding or writes', async () => {
    const input = await createFixture();
    await createBatch(input.itemId, '4', null);

    await expect(
      inventory.useQuantity({ ...input, quantity: '1.0000000' }),
    ).rejects.toThrow('more than six decimal places');
    const { batches, actions } = await stockAndActivity(input.itemId);
    expect(batches[0].quantity.toString()).toBe('4');
    expect(actions).toHaveLength(0);
  });

  it('rejects a quantity above the Decimal(18,6) range without writes', async () => {
    const input = await createFixture();
    await createBatch(input.itemId, '4', null);

    await expect(
      inventory.useQuantity({ ...input, quantity: '1000000000000' }),
    ).rejects.toThrow('Decimal(18,6) maximum of 999999999999.999999');
    const { batches, actions } = await stockAndActivity(input.itemId);
    expect(batches[0].quantity.toString()).toBe('4');
    expect(actions).toHaveLength(0);
  });

  it('rolls back insufficient eligible stock without partial allocations', async () => {
    const input = await createFixture();
    await createBatch(input.itemId, '4', '2099-01-01');
    await createBatch(input.itemId, '8', '2000-01-01');

    await expect(
      inventory.useQuantity({ ...input, quantity: '5' }),
    ).rejects.toThrow('Insufficient eligible stock');
    const { batches, actions } = await stockAndActivity(input.itemId);
    expect(batches.map((batch) => batch.quantity.toString()).sort()).toEqual([
      '4',
      '8',
    ]);
    expect(actions).toHaveLength(0);
  });

  it('serializes competing Uses and does not allocate stale stock', async () => {
    const input = await createFixture();
    const batchId = await createBatch(input.itemId, '4', null);

    const results = await Promise.allSettled([
      inventory.useQuantity({ ...input, quantity: '3' }),
      inventory.useQuantity({ ...input, quantity: '3' }),
    ]);
    const { batches, actions } = await stockAndActivity(input.itemId);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      batches.find((batch) => batch.id === batchId)?.quantity.toString(),
    ).toBe('1');
    expect(actions).toHaveLength(1);
    expect(actions[0].allocations).toHaveLength(1);
    expect(actions[0].allocations[0].quantity.toString()).toBe('3');
  });
});
