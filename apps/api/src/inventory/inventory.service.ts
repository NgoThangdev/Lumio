import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/browser.js';
import type { TrackingMode } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  effectiveExpiryDate,
  eligibleBatches,
  localCalendarDate,
  planAutomaticOpen,
  planOpenTransfer,
  planUse,
} from './plan-use.js';
import { addCalendarDays } from './stock-intelligence.js';
import { MAX_QUANTITY, parseQuantity } from './quantity-validation.js';
import { parseAddItem } from './add-item-input.js';
import type { AddItemFields } from './add-item-input.js';
import { undoEligibility } from './undo-eligibility.js';
import { resolveRestockLocation } from './stock-location.js';

export { parseQuantity } from './quantity-validation.js';

export function withOpenedStock<
  T extends {
    batches: Array<{
      quantity: InstanceType<typeof Prisma.Decimal>;
      expiryDate: Date | null;
      openedAt: Date | null;
      openedUseByDate: Date | null;
    }>;
  },
>(item: T) {
  return {
    ...item,
    openedQuantity: item.batches
      .reduce(
        (sum, batch) => (batch.openedAt ? sum.plus(batch.quantity) : sum),
        new Prisma.Decimal(0),
      )
      .toString(),
    unopenedQuantity: item.batches
      .reduce(
        (sum, batch) => (batch.openedAt ? sum : sum.plus(batch.quantity)),
        new Prisma.Decimal(0),
      )
      .toString(),
    batches: item.batches.map((batch) => ({
      ...batch,
      effectiveExpiryDate: effectiveExpiryDate(batch),
    })),
  };
}

export interface UseQuantityInput {
  actorId: string;
  householdId: string;
  itemId: string;
  quantity: string;
}

export interface RestockQuantityInput extends UseQuantityInput {
  expiryDate?: Date | null;
  locationId?: unknown;
}

export interface CreateItemInput extends AddItemFields {
  actorId: string;
  householdId: string;
  name: string;
  primaryUnit: string;
  trackingMode?: TrackingMode;
}

export interface ReadItemInput {
  actorId: string;
  householdId: string;
  itemId: string;
}

export interface ItemConfigurationInput extends ReadItemInput {
  minimumStock: unknown;
  lowStockThreshold: unknown;
  buyThreshold: unknown;
  targetStock: unknown;
  neverRunOut: unknown;
  predictionEnabled: unknown;
}

function settingDecimal(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new BadRequestException(
      `${label} must be a non-negative decimal with at most six fractional digits.`,
    );
  }
  const decimal = new Prisma.Decimal(value);
  if (decimal.gt(MAX_QUANTITY)) {
    throw new BadRequestException(
      `${label} exceeds the Decimal(18,6) maximum.`,
    );
  }
  return decimal;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async createItem({
    actorId,
    householdId,
    name,
    primaryUnit,
    trackingMode = 'QUANTITY',
    categoryId,
    locationId,
    tagIds,
    initialStock,
  }: CreateItemInput) {
    const itemName = name.trim();
    const unit = primaryUnit.trim();
    if (!itemName || !unit) {
      throw new BadRequestException('Item name and primary unit are required.');
    }
    if (!['QUANTITY', 'FIVE_LEVEL', 'PRESENCE_BACKUP'].includes(trackingMode)) {
      throw new BadRequestException('Invalid tracking mode.');
    }
    const isAddItem = [categoryId, locationId, tagIds, initialStock].some(
      (value) => value !== undefined,
    );
    const addItem = isAddItem
      ? parseAddItem(trackingMode, {
          categoryId,
          locationId,
          tagIds,
          initialStock,
        })
      : null;

    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { userId_householdId: { userId: actorId, householdId } },
        select: { userId: true },
      });
      if (!membership) {
        throw new ForbiddenException(
          'Household membership is required to create an item.',
        );
      }

      if (addItem) {
        const [category, location, tags] = await Promise.all([
          tx.category.findFirst({
            where: { id: addItem.categoryId, householdId },
            select: { id: true },
          }),
          tx.location.findFirst({
            where: { id: addItem.locationId, householdId },
            select: { id: true },
          }),
          tx.tag.findMany({
            where: { id: { in: addItem.tagIds }, householdId },
            select: { id: true },
          }),
        ]);
        if (!category || !location || tags.length !== addItem.tagIds.length) {
          throw new BadRequestException(
            'Category, location, and tags must belong to this household.',
          );
        }
      }

      const stock = addItem?.initialStock;
      const currentLevel =
        trackingMode === 'FIVE_LEVEL'
          ? stock && 'level' in stock
            ? stock.level
            : 'EMPTY'
          : null;
      const isPresent =
        trackingMode === 'PRESENCE_BACKUP'
          ? stock && 'present' in stock
            ? stock.present
            : false
          : null;
      const backupCount =
        stock && 'backupCount' in stock ? (stock.backupCount ?? 0) : 0;

      const item = await tx.inventoryItem.create({
        data: {
          householdId,
          name: itemName,
          primaryUnit: unit,
          trackingMode,
          currentLevel,
          isPresent,
          backupCount,
          categoryId: addItem?.categoryId ?? null,
          currentLocationId:
            addItem && trackingMode !== 'QUANTITY' ? addItem.locationId : null,
          backupLocationId:
            addItem && trackingMode !== 'QUANTITY' ? addItem.locationId : null,
          preferredRestockLocationId: addItem?.locationId ?? null,
        },
      });
      if (!addItem) return item;
      if (addItem.tagIds.length > 0) {
        await tx.inventoryItemTag.createMany({
          data: addItem.tagIds.map((tagId) => ({ itemId: item.id, tagId })),
        });
      }
      if (stock && 'quantity' in stock && stock.quantity !== '0') {
        await this.createBatchAction(tx, {
          actorId,
          householdId,
          itemId: item.id,
          quantity: stock.quantity,
          expiryDate: stock.expiryDate,
          locationId: addItem.locationId,
          type: 'INITIAL_STOCK',
        });
      } else if (stock && !('quantity' in stock)) {
        await tx.inventoryStateAction.create({
          data: {
            householdId,
            itemId: item.id,
            userId: actorId,
            type: 'INITIALIZE',
            beforeLevel: null,
            afterLevel: currentLevel,
            beforePresent: null,
            afterPresent: isPresent,
            beforeBackupCount: 0,
            afterBackupCount: backupCount,
          },
        });
      }
      return tx.inventoryItem.findUniqueOrThrow({
        where: { id: item.id },
        include: {
          category: true,
          currentLocation: true,
          backupLocation: true,
          preferredRestockLocation: true,
          tagLinks: { include: { tag: true } },
          batches: { include: { location: true } },
          actions: {
            include: { allocations: true, openTransfer: true, undo: true },
          },
          stateActions: { include: { undo: true } },
          undos: true,
        },
      });
    });
  }

  async readItem({ actorId, householdId, itemId }: ReadItemInput) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'Household membership is required to read this item.',
      );
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, householdId },
      include: {
        category: true,
        currentLocation: true,
        backupLocation: true,
        preferredRestockLocation: true,
        tagLinks: { include: { tag: true } },
        batches: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { location: true },
        },
        stateActions: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { undo: true },
        },
        undos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        stockChecks: {
          orderBy: { checkedAt: 'asc' },
        },
        actions: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { allocations: true, openTransfer: true, undo: true },
        },
      },
    });
    if (!item) {
      throw new NotFoundException(
        'Inventory item was not found in this household.',
      );
    }
    return withOpenedStock(item);
  }

  async listItems(actorId: string, householdId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'Household membership is required to list items.',
      );
    }
    const items = await this.prisma.inventoryItem.findMany({
      where: { householdId },
      include: {
        category: true,
        currentLocation: true,
        backupLocation: true,
        preferredRestockLocation: true,
        tagLinks: { include: { tag: true } },
        batches: {
          select: {
            id: true,
            quantity: true,
            expiryDate: true,
            openedAt: true,
            openedUseByDate: true,
            locationId: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return items.map(withOpenedStock);
  }

  async configureItem(input: ItemConfigurationInput) {
    const minimumStock = settingDecimal(input.minimumStock, 'Minimum stock');
    const lowStockThreshold = settingDecimal(
      input.lowStockThreshold,
      'Low threshold',
    );
    const buyThreshold = settingDecimal(input.buyThreshold, 'Buy threshold');
    const targetStock = settingDecimal(input.targetStock, 'Target stock');
    if (
      typeof input.neverRunOut !== 'boolean' ||
      typeof input.predictionEnabled !== 'boolean'
    ) {
      throw new BadRequestException(
        'Never-run-out and prediction settings must be true or false.',
      );
    }
    if (targetStock?.isZero()) {
      throw new BadRequestException('Target stock must be greater than zero.');
    }
    const ordered = [
      minimumStock,
      buyThreshold,
      lowStockThreshold,
      targetStock,
    ].filter((value): value is NonNullable<typeof value> => value !== null);
    for (let index = 1; index < ordered.length; index++) {
      const earlier = ordered[index - 1];
      const later = ordered[index];
      if (earlier && later && earlier.gt(later)) {
        throw new BadRequestException(
          'Stock settings must follow minimum ≤ buy ≤ low ≤ target.',
        );
      }
    }
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_householdId: {
          userId: input.actorId,
          householdId: input.householdId,
        },
      },
      select: { role: true },
    });
    if (membership?.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Household Admin membership is required to change stock settings.',
      );
    }
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: input.itemId, householdId: input.householdId },
      select: { trackingMode: true },
    });
    if (!item)
      throw new NotFoundException(
        'Inventory item was not found in this household.',
      );
    if (item.trackingMode !== 'QUANTITY') {
      throw new BadRequestException(
        'Quantity stock settings require QUANTITY tracking.',
      );
    }
    const result = await this.prisma.inventoryItem.updateMany({
      where: { id: input.itemId, householdId: input.householdId },
      data: {
        minimumStock,
        lowStockThreshold,
        buyThreshold,
        targetStock,
        neverRunOut: input.neverRunOut,
        predictionEnabled: input.predictionEnabled,
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException(
        'Inventory item was not found in this household.',
      );
    }
    return this.prisma.inventoryItem.findUniqueOrThrow({
      where: { id: input.itemId },
    });
  }

  async configureOpening(
    actorId: string,
    householdId: string,
    itemId: string,
    enabled: unknown,
    days: unknown,
    packageCountConfirmed: unknown,
  ) {
    if (
      typeof enabled !== 'boolean' ||
      (days !== null &&
        (!Number.isInteger(days) ||
          (days as number) <= 0 ||
          (days as number) > 2147483647))
    )
      throw new BadRequestException(
        'Opening settings require enabled and a positive integer day rule or null.',
      );
    if (enabled && packageCountConfirmed !== true)
      throw new BadRequestException(
        'Confirm that one package equals one primary unit.',
      );
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.membership.findUnique({
        where: { userId_householdId: { userId: actorId, householdId } },
        select: { role: true },
      });
      if (member?.role !== 'ADMIN')
        throw new ForbiddenException(
          'Household Admin membership is required to change opening settings.',
        );
      const locked = await tx.$queryRaw<
        Array<{ id: string; trackingMode: string }>
      >`
        SELECT "id", "trackingMode" FROM "InventoryItem" WHERE "id" = ${itemId} AND "householdId" = ${householdId} FOR UPDATE
      `;
      if (locked.length !== 1)
        throw new NotFoundException(
          'Inventory item was not found in this household.',
        );
      if (locked[0].trackingMode !== 'QUANTITY')
        throw new BadRequestException(
          'Opening settings require QUANTITY tracking.',
        );
      const batches = await tx.stockBatch.findMany({
        where: { itemId, quantity: { gt: 0 } },
        select: { quantity: true, openedAt: true },
      });
      if (
        enabled &&
        batches.some((batch) => !batch.openedAt && !batch.quantity.isInteger())
      )
        throw new BadRequestException(
          'Unopened package counts must be whole units.',
        );
      if (!enabled && batches.some((batch) => batch.openedAt))
        throw new ConflictException(
          'Finish opened stock before disabling opening tracking.',
        );
      return tx.inventoryItem.update({
        where: { id: itemId },
        data: {
          openedTrackingEnabled: enabled,
          recommendedDaysAfterOpening: days as number | null,
        },
      });
    });
  }

  private async openOneInTransaction(
    tx: Pick<
      PrismaService,
      'stockBatch' | 'inventoryAction' | 'openTransfer' | 'inventoryItem'
    >,
    input: {
      actorId: string;
      householdId: string;
      itemId: string;
      sourceBatchId: string;
      days: number | null;
      at: Date;
    },
  ) {
    const source = await tx.stockBatch.findFirst({
      where: { id: input.sourceBatchId, itemId: input.itemId, openedAt: null },
    });
    const transfer = source && planOpenTransfer(source.quantity);
    if (
      !source ||
      !transfer ||
      !planUse(transfer.openedQuantity, [source], input.at).ok
    )
      throw new ConflictException(
        'No eligible unopened container is available.',
      );
    const moved = await tx.stockBatch.updateMany({
      where: {
        id: source.id,
        itemId: input.itemId,
        openedAt: null,
        quantity: { gte: transfer.openedQuantity },
      },
      data: { quantity: { decrement: transfer.openedQuantity } },
    });
    if (moved.count !== 1)
      throw new ConflictException('Stock changed while opening this item.');
    const opened = await tx.stockBatch.create({
      data: {
        itemId: input.itemId,
        locationId: source.locationId,
        quantity: transfer.openedQuantity,
        expiryDate: source.expiryDate,
        openedAt: input.at,
        openedUseByDate:
          input.days === null
            ? null
            : new Date(
                `${addCalendarDays(localCalendarDate(input.at), input.days)}T00:00:00.000Z`,
              ),
      },
    });
    const action = await tx.inventoryAction.create({
      data: {
        householdId: input.householdId,
        itemId: input.itemId,
        userId: input.actorId,
        type: 'OPEN',
        quantity: transfer.openedQuantity,
      },
    });
    await tx.openTransfer.create({
      data: {
        actionId: action.id,
        sourceBatchId: source.id,
        openedBatchId: opened.id,
        quantity: transfer.openedQuantity,
      },
    });
    await tx.inventoryItem.update({
      where: { id: input.itemId },
      data: { stockRevision: { increment: 1 } },
    });
    return { batch: opened, action };
  }

  async openQuantity(actorId: string, householdId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.membership.findUnique({
        where: { userId_householdId: { userId: actorId, householdId } },
        select: { userId: true },
      });
      if (!member)
        throw new ForbiddenException(
          'Household membership is required to open this item.',
        );
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          openedTrackingEnabled: boolean;
          recommendedDaysAfterOpening: number | null;
        }>
      >`
        SELECT "id", "openedTrackingEnabled", "recommendedDaysAfterOpening" FROM "InventoryItem"
        WHERE "id" = ${itemId} AND "householdId" = ${householdId} AND "trackingMode" = 'QUANTITY' FOR UPDATE
      `;
      if (locked.length !== 1)
        throw new NotFoundException(
          'Quantity item was not found in this household.',
        );
      if (!locked[0].openedTrackingEnabled)
        throw new BadRequestException(
          'Opening tracking is not enabled for this item.',
        );
      const at = new Date();
      const sources = await tx.stockBatch.findMany({
        where: { itemId, openedAt: null },
        select: { id: true, quantity: true, expiryDate: true, createdAt: true },
      });
      const source = eligibleBatches(sources, at).find((batch) =>
        batch.quantity.gte(1),
      );
      if (!source)
        throw new ConflictException(
          'No eligible unopened container is available.',
        );
      return this.openOneInTransaction(tx, {
        actorId,
        householdId,
        itemId,
        sourceBatchId: source.id,
        days: locked[0].recommendedDaysAfterOpening,
        at,
      });
    });
  }

  async finishOpened(actorId: string, householdId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.membership.findUnique({
        where: { userId_householdId: { userId: actorId, householdId } },
        select: { userId: true },
      });
      if (!member)
        throw new ForbiddenException(
          'Household membership is required to finish this item.',
        );
      const locked = await tx.$queryRaw<
        Array<{ id: string; openedTrackingEnabled: boolean }>
      >`
        SELECT "id", "openedTrackingEnabled" FROM "InventoryItem"
        WHERE "id" = ${itemId} AND "householdId" = ${householdId} AND "trackingMode" = 'QUANTITY' FOR UPDATE
      `;
      if (locked.length !== 1)
        throw new NotFoundException(
          'Quantity item was not found in this household.',
        );
      if (!locked[0].openedTrackingEnabled)
        throw new BadRequestException(
          'Opening tracking is not enabled for this item.',
        );
      const opened = await tx.stockBatch.findMany({
        where: { itemId, openedAt: { not: null } },
      });
      const batch = eligibleBatches(opened, new Date())[0];
      if (!batch)
        throw new ConflictException('No eligible opened container remains.');
      const updated = await tx.stockBatch.updateMany({
        where: { id: batch.id, itemId, quantity: { gte: batch.quantity } },
        data: { quantity: { decrement: batch.quantity } },
      });
      if (updated.count !== 1)
        throw new ConflictException('Stock changed while finishing this item.');
      const updatedItem = await tx.inventoryItem.update({
        where: { id: itemId },
        data: { stockRevision: { increment: 1 } },
      });
      const action = await tx.inventoryAction.create({
        data: {
          householdId,
          itemId,
          userId: actorId,
          type: 'FINISH_OPENED',
          quantity: batch.quantity,
          postStockRevision: updatedItem.stockRevision,
          allocations: {
            create: {
              batchId: batch.id,
              quantity: batch.quantity,
              quantityAfter: new Prisma.Decimal(0),
            },
          },
        },
        include: { allocations: true },
      });
      return {
        ...action,
        undoEligibility: undoEligibility(action.createdAt, true),
      };
    });
  }

  async useQuantity({
    actorId,
    householdId,
    itemId,
    quantity,
  }: UseQuantityInput) {
    const requestedQuantity = parseQuantity(quantity, 'Use');

    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { userId_householdId: { userId: actorId, householdId } },
        select: { userId: true },
      });
      if (!membership) {
        throw new ForbiddenException(
          'Household membership is required to use this item.',
        );
      }

      const lockedItems = await tx.$queryRaw<
        Array<{
          id: string;
          trackingMode: string;
          openedTrackingEnabled: boolean;
          recommendedDaysAfterOpening: number | null;
        }>
      >`
        SELECT "id", "trackingMode", "openedTrackingEnabled", "recommendedDaysAfterOpening" FROM "InventoryItem"
        WHERE "id" = ${itemId} AND "householdId" = ${householdId}
        FOR UPDATE
      `;
      if (lockedItems.length !== 1) {
        throw new NotFoundException(
          'Inventory item was not found in this household.',
        );
      }
      if (lockedItems[0].trackingMode !== 'QUANTITY') {
        throw new BadRequestException(
          'Use quantity requires QUANTITY tracking.',
        );
      }

      let batches = await tx.stockBatch.findMany({
        where: { itemId },
        select: {
          id: true,
          quantity: true,
          expiryDate: true,
          openedAt: true,
          openedUseByDate: true,
          createdAt: true,
        },
      });
      const at = new Date();
      if (lockedItems[0].openedTrackingEnabled) {
        const opening = planAutomaticOpen(requestedQuantity, batches, at);
        if (!opening.ok)
          throw new ConflictException(
            'Insufficient eligible stock for this Use quantity.',
          );
        for (const sourceBatchId of opening.sourceBatchIds) {
          await this.openOneInTransaction(tx, {
            actorId,
            householdId,
            itemId,
            sourceBatchId,
            days: lockedItems[0].recommendedDaysAfterOpening,
            at,
          });
        }
        if (opening.sourceBatchIds.length > 0) {
          batches = await tx.stockBatch.findMany({
            where: { itemId },
            select: {
              id: true,
              quantity: true,
              expiryDate: true,
              openedAt: true,
              openedUseByDate: true,
              createdAt: true,
            },
          });
        }
        batches = batches.filter((batch) => batch.openedAt !== null);
      }
      const plan = planUse(requestedQuantity, batches, at);
      if (!plan.ok) {
        throw new ConflictException(
          'Insufficient eligible stock for this Use quantity.',
        );
      }

      for (const allocation of plan.allocations) {
        const updated = await tx.stockBatch.updateMany({
          where: {
            id: allocation.batchId,
            itemId,
            quantity: { gte: allocation.quantity },
          },
          data: { quantity: { decrement: allocation.quantity } },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'Stock changed while using this item; retry the action.',
          );
        }
      }

      const updatedItem = await tx.inventoryItem.update({
        where: { id: itemId },
        data: { stockRevision: { increment: 1 } },
      });

      const canUndo = !lockedItems[0].openedTrackingEnabled;
      const action = await tx.inventoryAction.create({
        data: {
          household: { connect: { id: householdId } },
          item: { connect: { id: itemId } },
          user: { connect: { id: actorId } },
          type: 'USE',
          quantity: requestedQuantity,
          postStockRevision: canUndo ? updatedItem.stockRevision : null,
          allocations: {
            create: plan.allocations.map((allocation) => ({
              batch: { connect: { id: allocation.batchId } },
              quantity: allocation.quantity,
              quantityAfter: canUndo
                ? batches
                    .find((batch) => batch.id === allocation.batchId)!
                    .quantity.minus(allocation.quantity)
                : null,
            })),
          },
        },
        include: { allocations: true },
      });
      return {
        ...action,
        undoEligibility: undoEligibility(action.createdAt, canUndo),
      };
    });
  }

  async restockQuantity({
    actorId,
    householdId,
    itemId,
    quantity,
    expiryDate,
    locationId,
  }: RestockQuantityInput) {
    parseQuantity(quantity, 'Restock');
    return this.prisma.$transaction((tx) =>
      this.restockInTransaction(tx, {
        actorId,
        householdId,
        itemId,
        quantity,
        expiryDate,
        locationId,
      }),
    );
  }

  async restockInTransaction(
    tx: Pick<
      PrismaService,
      | 'membership'
      | '$queryRaw'
      | 'stockBatch'
      | 'inventoryAction'
      | 'inventoryItem'
      | 'location'
    >,
    {
      actorId,
      householdId,
      itemId,
      quantity,
      expiryDate,
      locationId,
    }: RestockQuantityInput,
  ) {
    const membership = await tx.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!membership) {
      throw new ForbiddenException(
        'Household membership is required to restock this item.',
      );
    }
    const lockedItems = await tx.$queryRaw<
      Array<{
        id: string;
        trackingMode: string;
        openedTrackingEnabled: boolean;
        preferredRestockLocationId: string | null;
      }>
    >`
      SELECT "id", "trackingMode", "openedTrackingEnabled", "preferredRestockLocationId" FROM "InventoryItem"
      WHERE "id" = ${itemId} AND "householdId" = ${householdId}
      FOR UPDATE
    `;
    if (lockedItems.length !== 1) {
      throw new NotFoundException(
        'Inventory item was not found in this household.',
      );
    }
    if (lockedItems[0].trackingMode !== 'QUANTITY') {
      throw new BadRequestException(
        'Restock quantity requires QUANTITY tracking.',
      );
    }
    if (
      lockedItems[0].openedTrackingEnabled &&
      !parseQuantity(quantity, 'Restock').isInteger()
    ) {
      throw new BadRequestException(
        'Package-count Restock requires a whole number of containers.',
      );
    }
    return this.createBatchAction(tx, {
      actorId,
      householdId,
      itemId,
      quantity,
      expiryDate,
      locationId: await resolveRestockLocation(tx, {
        householdId,
        itemId,
        explicitLocationId: locationId,
        preferredLocationId: lockedItems[0].preferredRestockLocationId,
      }),
      type: 'RESTOCK',
    });
  }

  private async createBatchAction(
    tx: Pick<PrismaService, 'stockBatch' | 'inventoryAction' | 'inventoryItem'>,
    input: RestockQuantityInput & {
      locationId: string | null;
      type: 'RESTOCK' | 'INITIAL_STOCK';
    },
  ) {
    const actualQuantity = parseQuantity(input.quantity, 'Restock');
    const batch = await tx.stockBatch.create({
      data: {
        itemId: input.itemId,
        quantity: actualQuantity,
        expiryDate: input.expiryDate ?? null,
        locationId: input.locationId,
      },
      include: { location: true },
    });
    const action = await tx.inventoryAction.create({
      data: {
        household: { connect: { id: input.householdId } },
        item: { connect: { id: input.itemId } },
        user: { connect: { id: input.actorId } },
        type: input.type,
        quantity: actualQuantity,
        allocations: {
          create: {
            batch: { connect: { id: batch.id } },
            quantity: actualQuantity,
          },
        },
      },
      include: { allocations: true },
    });
    await tx.inventoryItem.update({
      where: { id: input.itemId },
      data: { stockRevision: { increment: 1 } },
    });
    return { batch, action };
  }
}
