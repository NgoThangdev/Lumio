import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { InventoryStateService } from '../src/inventory/inventory-state.service.js';
import { StockIntelligenceService } from '../src/inventory/stock-intelligence.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Five-level and presence stock (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let state: InventoryStateService;
  let intelligence: StockIntelligenceService;
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
    state = app.get(InventoryStateService);
    intelligence = app.get(StockIntelligenceService);
  });

  afterAll(async () => {
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: households } },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
    await prisma.inventoryStateAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.membership.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.household.deleteMany({ where: { id: { in: households } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    expect(
      await prisma.inventoryItem.count({ where: { id: { in: itemIds } } }),
    ).toBe(0);
    expect(
      await prisma.inventoryStateAction.count({
        where: { itemId: { in: itemIds } },
      }),
    ).toBe(0);
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
      data: { id: householdId, name: `State fixture ${householdId}` },
    });
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'ADMIN' },
    });
    return { actorId, householdId };
  }

  it('assesses a quarter container with backups as safe, and without backups as buy risk', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: 'Detergent',
      primaryUnit: 'bottle',
      trackingMode: 'FIVE_LEVEL',
    });
    await state.transition(scope.actorId, scope.householdId, item.id, {
      type: 'UPDATE_LEVEL',
      level: 'QUARTER',
    });
    await state.transition(scope.actorId, scope.householdId, item.id, {
      type: 'ADD_BACKUP',
      count: 2,
    });
    const withBackup = await intelligence.assessHousehold(
      scope.actorId,
      scope.householdId,
    );
    expect(withBackup.assessments[0]).toMatchObject({
      trackingMode: 'FIVE_LEVEL',
      currentLevel: 'QUARTER',
      backupCount: 2,
      lowStockRisk: 'OK',
      suggestion: null,
    });
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { backupCount: 0, neverRunOut: true },
    });
    const withoutBackup = await intelligence.assessHousehold(
      scope.actorId,
      scope.householdId,
    );
    expect(withoutBackup.assessments[0]).toMatchObject({
      lowStockRisk: 'BUY',
      recommendedAction: 'BUY_BACKUP',
      purchasePriority: 'MUST_BUY',
      suggestion: null,
    });
    expect(withoutBackup.suggestions).toHaveLength(0);
  });

  it('opens one refill atomically and records attributable before/after state', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: 'Soap',
      primaryUnit: 'bar',
      trackingMode: 'FIVE_LEVEL',
    });
    await state.transition(scope.actorId, scope.householdId, item.id, {
      type: 'ADD_BACKUP',
      count: 2,
    });
    const opened = await state.transition(
      scope.actorId,
      scope.householdId,
      item.id,
      { type: 'OPEN_REFILL' },
    );
    expect(opened.item).toMatchObject({ currentLevel: 'FULL', backupCount: 1 });
    expect(opened.action).toMatchObject({
      userId: scope.actorId,
      beforeLevel: 'EMPTY',
      afterLevel: 'FULL',
      beforeBackupCount: 2,
      afterBackupCount: 1,
    });
    const read = await inventory.readItem({ ...scope, itemId: item.id });
    expect(read.stateActions.map((action) => action.type)).toEqual([
      'ADD_BACKUP',
      'OPEN_REFILL',
    ]);
    expect(read.actions).toEqual([]);
    expect(read.batches).toEqual([]);
  });

  it('rejects insufficient backup and simultaneous opens without consuming twice', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: 'Shampoo',
      primaryUnit: 'bottle',
      trackingMode: 'FIVE_LEVEL',
    });
    await expect(
      state.transition(scope.actorId, scope.householdId, item.id, {
        type: 'OPEN_REFILL',
      }),
    ).rejects.toThrow('requires an Empty current container');
    expect(
      await prisma.inventoryStateAction.count({ where: { itemId: item.id } }),
    ).toBe(0);
    await state.transition(scope.actorId, scope.householdId, item.id, {
      type: 'ADD_BACKUP',
      count: 1,
    });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        state.transition(scope.actorId, scope.householdId, item.id, {
          type: 'OPEN_REFILL',
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const read = await inventory.readItem({ ...scope, itemId: item.id });
    expect(read).toMatchObject({ currentLevel: 'FULL', backupCount: 0 });
    expect(
      read.stateActions.filter((action) => action.type === 'OPEN_REFILL'),
    ).toHaveLength(1);
  });

  it('tracks presence and opens a backup without quantity batches', async () => {
    const scope = await fixture();
    const item = await inventory.createItem({
      ...scope,
      name: 'Spare bulb',
      primaryUnit: 'bulb',
      trackingMode: 'PRESENCE_BACKUP',
    });
    await state.transition(scope.actorId, scope.householdId, item.id, {
      type: 'ADD_BACKUP',
      count: 1,
    });
    const opened = await state.transition(
      scope.actorId,
      scope.householdId,
      item.id,
      { type: 'OPEN_REFILL' },
    );
    expect(opened.item).toMatchObject({ isPresent: true, backupCount: 0 });
    expect(opened.action).toMatchObject({
      beforePresent: false,
      afterPresent: true,
      beforeBackupCount: 1,
      afterBackupCount: 0,
    });
    await state.transition(scope.actorId, scope.householdId, item.id, {
      type: 'SET_PRESENCE',
      present: false,
    });
    const assessed = await intelligence.assessHousehold(
      scope.actorId,
      scope.householdId,
    );
    expect(assessed.assessments[0]).toMatchObject({
      trackingMode: 'PRESENCE_BACKUP',
      isPresent: false,
      lowStockRisk: 'OUT',
    });
  });

  it('enforces household membership and item ownership for state and assessment', async () => {
    const owner = await fixture();
    const other = await fixture();
    const item = await inventory.createItem({
      ...owner,
      name: 'Oil',
      primaryUnit: 'bottle',
      trackingMode: 'FIVE_LEVEL',
    });
    await expect(
      state.transition(other.actorId, owner.householdId, item.id, {
        type: 'UPDATE_LEVEL',
        level: 'HALF',
      }),
    ).rejects.toThrow('Household membership');
    await expect(
      state.transition(other.actorId, other.householdId, item.id, {
        type: 'UPDATE_LEVEL',
        level: 'HALF',
      }),
    ).rejects.toThrow('Inventory item was not found');
    await expect(
      intelligence.assessHousehold(other.actorId, owner.householdId),
    ).rejects.toThrow('Household membership');
    expect(
      await prisma.inventoryStateAction.count({ where: { itemId: item.id } }),
    ).toBe(0);
  });
});
