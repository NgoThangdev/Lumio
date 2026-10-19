import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/browser.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UNDO_WINDOW_MS } from './undo-eligibility.js';

type ActionKind = 'INVENTORY' | 'STATE';

function result(
  undo: {
    id: string;
    createdAt: Date;
    postStockRevision: number;
    inventoryActionId: string | null;
    stateActionId: string | null;
  },
  alreadyUndone: boolean,
) {
  return {
    undoId: undo.id,
    originalActionId: undo.inventoryActionId ?? undo.stateActionId,
    actionKind: undo.inventoryActionId ? 'INVENTORY' : 'STATE',
    undoneAt: undo.createdAt,
    stockRevision: undo.postStockRevision,
    alreadyUndone,
  };
}

@Injectable()
export class InventoryUndoService {
  constructor(private readonly prisma: PrismaService) {}

  async undo(
    actorId: string,
    householdId: string,
    itemId: string,
    body: { actionKind?: unknown; actionId?: unknown },
  ) {
    if (
      (body?.actionKind !== 'INVENTORY' && body?.actionKind !== 'STATE') ||
      typeof body.actionId !== 'string' ||
      !body.actionId
    )
      throw new BadRequestException('INVALID_UNDO_REQUEST');
    const actionKind: ActionKind = body.actionKind;
    const actionId = body.actionId;
    return this.prisma.$transaction(
      async (tx) => {
        const member = await tx.membership.findUnique({
          where: { userId_householdId: { userId: actorId, householdId } },
          select: { userId: true },
        });
        if (!member)
          throw new ForbiddenException('HOUSEHOLD_MEMBERSHIP_REQUIRED');
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            stockRevision: number;
            trackingMode: string;
            openedTrackingEnabled: boolean;
            archivedAt: Date | null;
          }>
        >`
          SELECT "id", "stockRevision", "trackingMode", "openedTrackingEnabled", "archivedAt"
          FROM "InventoryItem"
          WHERE "id" = ${itemId} AND "householdId" = ${householdId}
          FOR UPDATE
        `;
        if (rows.length !== 1) throw new NotFoundException('ITEM_NOT_FOUND');
        const item = rows[0];
        if (actionKind === 'INVENTORY') {
          const action = await tx.inventoryAction.findFirst({
            where: { id: actionId, householdId, itemId },
            include: {
              undo: true,
              allocations: { include: { batch: true } },
            },
          });
          if (!action) throw new NotFoundException('ACTION_NOT_FOUND');
          if (action.userId !== actorId)
            throw new ForbiddenException('UNDO_ACTOR_REQUIRED');
          if (action.undo) return result(action.undo, true);
          if (item.archivedAt) throw new ConflictException('ITEM_ARCHIVED');
          const supported =
            (action.type === 'USE' &&
              item.trackingMode === 'QUANTITY' &&
              !item.openedTrackingEnabled) ||
            (action.type === 'FINISH_OPENED' &&
              item.trackingMode === 'QUANTITY' &&
              item.openedTrackingEnabled);
          if (
            !supported ||
            action.postStockRevision === null ||
            action.allocations.length === 0 ||
            action.allocations.some(
              (allocation) => allocation.quantityAfter === null,
            )
          )
            throw new ConflictException('UNDO_UNSUPPORTED');
          this.checkWindowAndRevision(
            action.createdAt,
            action.postStockRevision,
            item.stockRevision,
          );
          const allocated = action.allocations.reduce(
            (sum, allocation) => sum.plus(allocation.quantity),
            new Prisma.Decimal(0),
          );
          if (
            !allocated.eq(action.quantity) ||
            (action.type === 'FINISH_OPENED' && action.allocations.length !== 1)
          )
            throw new ConflictException('UNDO_TARGET_CHANGED');
          for (const allocation of action.allocations) {
            const batch = allocation.batch;
            if (
              batch.itemId !== itemId ||
              !batch.quantity.eq(allocation.quantityAfter!) ||
              allocation.quantity.lte(0) ||
              (action.type === 'USE' && batch.openedAt !== null) ||
              (action.type === 'FINISH_OPENED' &&
                (batch.openedAt === null ||
                  batch.quantity.plus(allocation.quantity).gt(1)))
            )
              throw new ConflictException('UNDO_TARGET_CHANGED');
          }
          for (const allocation of action.allocations) {
            const changed = await tx.stockBatch.updateMany({
              where: {
                id: allocation.batchId,
                itemId,
                quantity: allocation.quantityAfter!,
              },
              data: { quantity: { increment: allocation.quantity } },
            });
            if (changed.count !== 1)
              throw new ConflictException('UNDO_TARGET_CHANGED');
          }
          const updated = await tx.inventoryItem.update({
            where: { id: itemId },
            data: { stockRevision: { increment: 1 } },
          });
          const undo = await this.recordUndo(tx, {
            householdId,
            itemId,
            userId: actorId,
            inventoryActionId: action.id,
            postStockRevision: updated.stockRevision,
          });
          return result(undo, false);
        }

        const action = await tx.inventoryStateAction.findFirst({
          where: { id: actionId, householdId, itemId },
          include: { undo: true },
        });
        if (!action) throw new NotFoundException('ACTION_NOT_FOUND');
        if (action.userId !== actorId)
          throw new ForbiddenException('UNDO_ACTOR_REQUIRED');
        if (action.undo) return result(action.undo, true);
        if (item.archivedAt) throw new ConflictException('ITEM_ARCHIVED');
        const supported =
          (action.type === 'UPDATE_LEVEL' &&
            item.trackingMode === 'FIVE_LEVEL' &&
            action.beforeLevel !== null) ||
          (action.type === 'SET_PRESENCE' &&
            item.trackingMode === 'PRESENCE_BACKUP' &&
            action.beforePresent !== null);
        if (!supported || action.postStockRevision === null)
          throw new ConflictException('UNDO_UNSUPPORTED');
        this.checkWindowAndRevision(
          action.createdAt,
          action.postStockRevision,
          item.stockRevision,
        );
        const current = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: itemId },
        });
        if (
          current.currentLevel !== action.afterLevel ||
          current.isPresent !== action.afterPresent ||
          current.backupCount !== action.afterBackupCount
        )
          throw new ConflictException('UNDO_TARGET_CHANGED');
        const updated = await tx.inventoryItem.update({
          where: { id: itemId },
          data: {
            currentLevel: action.beforeLevel,
            isPresent: action.beforePresent,
            backupCount: action.beforeBackupCount,
            stockRevision: { increment: 1 },
          },
        });
        const undo = await this.recordUndo(tx, {
          householdId,
          itemId,
          userId: actorId,
          stateActionId: action.id,
          postStockRevision: updated.stockRevision,
        });
        return result(undo, false);
      },
      { timeout: 10000 },
    );
  }

  private checkWindowAndRevision(
    createdAt: Date,
    postStockRevision: number,
    currentRevision: number,
  ) {
    if (Date.now() > createdAt.getTime() + UNDO_WINDOW_MS)
      throw new ConflictException('UNDO_WINDOW_EXPIRED');
    if (currentRevision !== postStockRevision)
      throw new ConflictException('UNDO_STOCK_CHANGED');
  }

  private recordUndo(
    tx: Pick<PrismaService, 'inventoryUndo'>,
    data: {
      householdId: string;
      itemId: string;
      userId: string;
      inventoryActionId?: string;
      stateActionId?: string;
      postStockRevision: number;
    },
  ) {
    return tx.inventoryUndo.create({ data });
  }
}
