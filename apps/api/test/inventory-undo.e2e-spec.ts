import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { InventoryStateService } from '../src/inventory/inventory-state.service.js';
import { InventoryUndoService } from '../src/inventory/inventory-undo.service.js';
import { StockIntelligenceService } from '../src/inventory/stock-intelligence.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StockCheckService } from '../src/shopping/stock-check.service.js';

describe('Inventory Undo (database; requires Undo migration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let state: InventoryStateService;
  let undo: InventoryUndoService;
  let intelligence: StockIntelligenceService;
  let checks: StockCheckService;
  const users: string[] = [];
  const households: string[] = [];
  const items: string[] = [];
  const trips: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    inventory = app.get(InventoryService);
    state = app.get(InventoryStateService);
    undo = app.get(InventoryUndoService);
    intelligence = app.get(StockIntelligenceService);
    checks = app.get(StockCheckService);
  });

  afterAll(async () => {
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId: { in: items } },
      select: { id: true },
    });
    const actionIds = actions.map((action) => action.id);
    await prisma.inventoryUndo.deleteMany({ where: { itemId: { in: items } } });
    await prisma.tripStockCheck.deleteMany({
      where: { tripId: { in: trips } },
    });
    await prisma.shoppingEntry.deleteMany({ where: { tripId: { in: trips } } });
    await prisma.shoppingTrip.deleteMany({ where: { id: { in: trips } } });
    await prisma.openTransfer.deleteMany({
      where: { actionId: { in: actionIds } },
    });
    await prisma.actionBatchAllocation.deleteMany({
      where: { actionId: { in: actionIds } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: items } },
    });
    await prisma.inventoryStateAction.deleteMany({
      where: { itemId: { in: items } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: items } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: items } } });
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

  async function fixture(
    mode: 'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP' = 'QUANTITY',
    opened = false,
  ) {
    const actorId = randomUUID();
    const householdId = randomUUID();
    const itemId = randomUUID();
    users.push(actorId);
    households.push(householdId);
    items.push(itemId);
    await prisma.user.create({
      data: {
        id: actorId,
        email: `${actorId}@example.invalid`,
        passwordHash: 'fixture',
      },
    });
    await prisma.household.create({
      data: { id: householdId, name: 'Undo fixture' },
    });
    await prisma.membership.create({
      data: { userId: actorId, householdId, role: 'MEMBER' },
    });
    const location =
      mode === 'QUANTITY'
        ? await prisma.location.create({
            data: { householdId, name: 'Fixture shelf', nameKey: randomUUID() },
          })
        : null;
    await prisma.inventoryItem.create({
      data: {
        id: itemId,
        householdId,
        name: 'Undo item',
        primaryUnit: 'box',
        trackingMode: mode,
        openedTrackingEnabled: opened,
        preferredRestockLocationId: location?.id,
        ...(mode === 'FIVE_LEVEL' ? { currentLevel: 'HALF' as const } : {}),
        ...(mode === 'PRESENCE_BACKUP' ? { isPresent: true } : {}),
      },
    });
    return { actorId, householdId, itemId };
  }

  async function member(householdId: string) {
    const id = randomUUID();
    users.push(id);
    await prisma.user.create({
      data: { id, email: `${id}@example.invalid`, passwordHash: 'fixture' },
    });
    await prisma.membership.create({
      data: { userId: id, householdId, role: 'MEMBER' },
    });
    return id;
  }

  it('restores exact multi-batch FEFO allocations and stales an earlier stock check', async () => {
    const input = await fixture();
    const early = await prisma.stockBatch.create({
      data: {
        itemId: input.itemId,
        quantity: '2',
        expiryDate: new Date('2099-01-01'),
      },
    });
    const late = await prisma.stockBatch.create({
      data: {
        itemId: input.itemId,
        quantity: '4',
        expiryDate: new Date('2099-02-01'),
      },
    });
    const used = await inventory.useQuantity({ ...input, quantity: '3' });
    expect(used.undoEligibility.eligible).toBe(true);
    expect(
      new Map(
        used.allocations.map((entry) => [
          entry.batchId,
          entry.quantityAfter?.toString(),
        ]),
      ),
    ).toEqual(
      new Map([
        [early.id, '0'],
        [late.id, '3'],
      ]),
    );
    const tripId = randomUUID();
    trips.push(tripId);
    await prisma.shoppingTrip.create({
      data: {
        id: tripId,
        householdId: input.householdId,
        createdByUserId: input.actorId,
        store: 'Undo fixture',
        plannedDate: new Date('2026-10-20'),
      },
    });
    await prisma.tripStockCheck.create({
      data: {
        tripId,
        itemId: input.itemId,
        decision: 'CONFIRM',
        revision: used.postStockRevision!,
        userId: input.actorId,
        checkedAt: new Date(),
      },
    });
    const reversed = await undo.undo(
      input.actorId,
      input.householdId,
      input.itemId,
      {
        actionKind: 'INVENTORY',
        actionId: used.id,
      },
    );
    expect(reversed.alreadyUndone).toBe(false);
    expect(reversed.stockRevision).toBe(used.postStockRevision! + 1);
    const batches = await prisma.stockBatch.findMany({
      where: { itemId: input.itemId },
    });
    expect(
      new Map(batches.map((batch) => [batch.id, batch.quantity.toString()])),
    ).toEqual(
      new Map([
        [early.id, '2'],
        [late.id, '4'],
      ]),
    );
    const detail = await inventory.readItem(input);
    expect(
      detail.actions.find((action) => action.id === used.id)?.undo?.id,
    ).toBe(reversed.undoId);
    expect(detail.undos).toHaveLength(1);
    expect(
      (await checks.list(input.actorId, input.householdId, tripId)).items[0]
        .status,
    ).toBe('STALE');
  });

  it('restores Finish opened consumption to its original opened batch', async () => {
    const input = await fixture('QUANTITY', true);
    const batch = await prisma.stockBatch.create({
      data: { itemId: input.itemId, quantity: '0.5', openedAt: new Date() },
    });
    const finished = await inventory.finishOpened(
      input.actorId,
      input.householdId,
      input.itemId,
    );
    expect(finished.undoEligibility.eligible).toBe(true);
    await undo.undo(input.actorId, input.householdId, input.itemId, {
      actionKind: 'INVENTORY',
      actionId: finished.id,
    });
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } })
      ).quantity.toString(),
    ).toBe('0.5');
  });

  it('restores both state modes and rejects another actor or household', async () => {
    const level = await fixture('FIVE_LEVEL');
    const presence = await fixture('PRESENCE_BACKUP');
    const otherMember = await member(level.householdId);
    const levelChange = await state.transition(
      level.actorId,
      level.householdId,
      level.itemId,
      {
        type: 'UPDATE_LEVEL',
        level: 'QUARTER',
      },
    );
    const presenceChange = await state.transition(
      presence.actorId,
      presence.householdId,
      presence.itemId,
      {
        type: 'SET_PRESENCE',
        present: false,
      },
    );
    expect(levelChange.undoEligibility.eligible).toBe(true);
    expect(presenceChange.undoEligibility.eligible).toBe(true);
    await expect(
      undo.undo(otherMember, level.householdId, level.itemId, {
        actionKind: 'STATE',
        actionId: levelChange.action.id,
      }),
    ).rejects.toThrow('UNDO_ACTOR_REQUIRED');
    await expect(
      undo.undo(presence.actorId, level.householdId, level.itemId, {
        actionKind: 'STATE',
        actionId: levelChange.action.id,
      }),
    ).rejects.toThrow('HOUSEHOLD_MEMBERSHIP_REQUIRED');
    await undo.undo(level.actorId, level.householdId, level.itemId, {
      actionKind: 'STATE',
      actionId: levelChange.action.id,
    });
    await undo.undo(presence.actorId, presence.householdId, presence.itemId, {
      actionKind: 'STATE',
      actionId: presenceChange.action.id,
    });
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: level.itemId },
        })
      ).currentLevel,
    ).toBe('HALF');
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: presence.itemId },
        })
      ).isPresent,
    ).toBe(true);
  });

  it('rejects expired actions and returns the existing Undo after expiry or later stock change', async () => {
    const expired = await fixture();
    await prisma.stockBatch.create({
      data: { itemId: expired.itemId, quantity: '3' },
    });
    const oldUse = await inventory.useQuantity({ ...expired, quantity: '1' });
    await prisma.inventoryAction.update({
      where: { id: oldUse.id },
      data: { createdAt: new Date(Date.now() - 3 * 60_000) },
    });
    await expect(
      undo.undo(expired.actorId, expired.householdId, expired.itemId, {
        actionKind: 'INVENTORY',
        actionId: oldUse.id,
      }),
    ).rejects.toThrow('UNDO_WINDOW_EXPIRED');
    const current = await fixture();
    await prisma.stockBatch.create({
      data: { itemId: current.itemId, quantity: '3' },
    });
    const use = await inventory.useQuantity({ ...current, quantity: '1' });
    const first = await undo.undo(
      current.actorId,
      current.householdId,
      current.itemId,
      {
        actionKind: 'INVENTORY',
        actionId: use.id,
      },
    );
    await prisma.inventoryAction.update({
      where: { id: use.id },
      data: { createdAt: new Date(Date.now() - 3 * 60_000) },
    });
    await inventory.restockQuantity({ ...current, quantity: '1' });
    const repeat = await undo.undo(
      current.actorId,
      current.householdId,
      current.itemId,
      {
        actionKind: 'INVENTORY',
        actionId: use.id,
      },
    );
    expect(repeat).toEqual({ ...first, alreadyUndone: true });
    expect(
      await prisma.inventoryUndo.count({
        where: { inventoryActionId: use.id },
      }),
    ).toBe(1);
  });

  it('rejects intervening stock changes and unsupported automatic Open Use', async () => {
    const input = await fixture();
    await prisma.stockBatch.create({
      data: { itemId: input.itemId, quantity: '4' },
    });
    const use = await inventory.useQuantity({ ...input, quantity: '1' });
    const other = await member(input.householdId);
    await inventory.useQuantity({ ...input, actorId: other, quantity: '1' });
    await expect(
      undo.undo(input.actorId, input.householdId, input.itemId, {
        actionKind: 'INVENTORY',
        actionId: use.id,
      }),
    ).rejects.toThrow('UNDO_STOCK_CHANGED');
    const opened = await fixture('QUANTITY', true);
    await prisma.stockBatch.create({
      data: { itemId: opened.itemId, quantity: '1' },
    });
    const auto = await inventory.useQuantity({ ...opened, quantity: '0.5' });
    expect(auto.undoEligibility.eligible).toBe(false);
    await expect(
      undo.undo(opened.actorId, opened.householdId, opened.itemId, {
        actionKind: 'INVENTORY',
        actionId: auto.id,
      }),
    ).rejects.toThrow('UNDO_UNSUPPORTED');
  });

  it('rejects changed batch or state snapshots and incompatible opening configuration', async () => {
    const quantity = await fixture();
    const batch = await prisma.stockBatch.create({
      data: { itemId: quantity.itemId, quantity: '3' },
    });
    const use = await inventory.useQuantity({ ...quantity, quantity: '1' });
    await prisma.stockBatch.update({
      where: { id: batch.id },
      data: { quantity: '1.5' },
    });
    await expect(
      undo.undo(quantity.actorId, quantity.householdId, quantity.itemId, {
        actionKind: 'INVENTORY',
        actionId: use.id,
      }),
    ).rejects.toThrow('UNDO_TARGET_CHANGED');
    expect(
      await prisma.inventoryUndo.count({
        where: { inventoryActionId: use.id },
      }),
    ).toBe(0);

    const level = await fixture('FIVE_LEVEL');
    const update = await state.transition(
      level.actorId,
      level.householdId,
      level.itemId,
      {
        type: 'UPDATE_LEVEL',
        level: 'QUARTER',
      },
    );
    await prisma.inventoryItem.update({
      where: { id: level.itemId },
      data: { currentLevel: 'FULL' },
    });
    await expect(
      undo.undo(level.actorId, level.householdId, level.itemId, {
        actionKind: 'STATE',
        actionId: update.action.id,
      }),
    ).rejects.toThrow('UNDO_TARGET_CHANGED');

    const opened = await fixture('QUANTITY', true);
    await prisma.stockBatch.create({
      data: { itemId: opened.itemId, quantity: '0.5', openedAt: new Date() },
    });
    const finished = await inventory.finishOpened(
      opened.actorId,
      opened.householdId,
      opened.itemId,
    );
    await prisma.inventoryItem.update({
      where: { id: opened.itemId },
      data: { openedTrackingEnabled: false },
    });
    await expect(
      undo.undo(opened.actorId, opened.householdId, opened.itemId, {
        actionKind: 'INVENTORY',
        actionId: finished.id,
      }),
    ).rejects.toThrow('UNDO_UNSUPPORTED');
  });

  it('rolls back batch restoration when the reversal record cannot be written', async () => {
    const input = await fixture();
    const batch = await prisma.stockBatch.create({
      data: { itemId: input.itemId, quantity: '3' },
    });
    const use = await inventory.useQuantity({ ...input, quantity: '1' });
    const service = undo as unknown as {
      recordUndo: (...args: unknown[]) => Promise<unknown>;
    };
    const spy = vi
      .spyOn(service, 'recordUndo')
      .mockRejectedValueOnce(new ConflictException('Fixture failure'));
    try {
      await expect(
        undo.undo(input.actorId, input.householdId, input.itemId, {
          actionKind: 'INVENTORY',
          actionId: use.id,
        }),
      ).rejects.toThrow('Fixture failure');
    } finally {
      spy.mockRestore();
    }
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } })
      ).quantity.toString(),
    ).toBe('2');
    expect(
      (
        await prisma.inventoryItem.findUniqueOrThrow({
          where: { id: input.itemId },
        })
      ).stockRevision,
    ).toBe(use.postStockRevision);
    expect(
      await prisma.inventoryUndo.count({
        where: { inventoryActionId: use.id },
      }),
    ).toBe(0);
  });

  it('serializes Undo with a concurrent Use and never duplicates restoration', async () => {
    const input = await fixture();
    const batch = await prisma.stockBatch.create({
      data: { itemId: input.itemId, quantity: '5' },
    });
    const first = await inventory.useQuantity({ ...input, quantity: '2' });
    const outcomes = await Promise.allSettled([
      undo.undo(input.actorId, input.householdId, input.itemId, {
        actionKind: 'INVENTORY',
        actionId: first.id,
      }),
      inventory.useQuantity({ ...input, quantity: '1' }),
    ]);
    expect(outcomes[1].status).toBe('fulfilled');
    const restored = outcomes[0].status === 'fulfilled';
    if (outcomes[0].status === 'rejected')
      expect(String(outcomes[0].reason)).toContain('UNDO_STOCK_CHANGED');
    expect(
      (
        await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } })
      ).quantity.toString(),
    ).toBe(restored ? '4' : '2');
    expect(
      await prisma.inventoryUndo.count({
        where: { inventoryActionId: first.id },
      }),
    ).toBe(restored ? 1 : 0);
  });

  it('removes undone consumption from the 14-day rate and distinct-use-day test', async () => {
    const input = await fixture();
    await prisma.inventoryItem.update({
      where: { id: input.itemId },
      data: { predictionEnabled: true },
    });
    await prisma.stockBatch.create({
      data: { itemId: input.itemId, quantity: '10' },
    });
    await prisma.inventoryAction.create({
      data: {
        householdId: input.householdId,
        itemId: input.itemId,
        userId: input.actorId,
        type: 'USE',
        quantity: '2',
        createdAt: new Date(Date.now() - 8 * 86_400_000),
      },
    });
    const todayUse = await inventory.useQuantity({ ...input, quantity: '1' });
    const before = await intelligence.assessHousehold(
      input.actorId,
      input.householdId,
    );
    expect(before.assessments[0].prediction.basis).toBe('USE_14_DAY');
    await undo.undo(input.actorId, input.householdId, input.itemId, {
      actionKind: 'INVENTORY',
      actionId: todayUse.id,
    });
    const after = await intelligence.assessHousehold(
      input.actorId,
      input.householdId,
    );
    expect(after.assessments[0].prediction.basis).toBe('THRESHOLD_FALLBACK');
    expect(after.assessments[0].prediction.dailyRate).toBeNull();
  });
});
