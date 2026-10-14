import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { parseQuantity } from '../inventory/quantity-validation.js';
import { LEVELS } from '../inventory/inventory-state.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { rankStockChecks } from './stock-check-ranking.js';

type Client = Prisma.TransactionClient;
type StockItem = Awaited<ReturnType<StockCheckService['loadItem']>>;

function observedQuantity(value: unknown): Prisma.Decimal {
  if (value === '0') return new Prisma.Decimal(0);
  if (typeof value !== 'string')
    throw new BadRequestException('QUANTITY_REQUIRED');
  return parseQuantity(value, 'Restock');
}

function observedBackup(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 2147483647
  )
    throw new BadRequestException('INVALID_BACKUP_COUNT');
  return value as number;
}

function snapshot(item: NonNullable<StockItem>) {
  if (item.trackingMode !== 'QUANTITY')
    return {
      currentLevel: item.currentLevel,
      isPresent: item.isPresent,
      backupCount: item.backupCount,
    };
  return {
    quantity: item.batches
      .reduce((sum, batch) => sum.plus(batch.quantity), new Prisma.Decimal(0))
      .toString(),
    batches: item.batches.map((batch) => ({
      id: batch.id,
      quantity: batch.quantity.toString(),
      expiryDate: batch.expiryDate?.toISOString().slice(0, 10) ?? null,
      openedAt: batch.openedAt,
      openedUseByDate:
        batch.openedUseByDate?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

@Injectable()
export class StockCheckService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMember(
    client: Client,
    actorId: string,
    householdId: string,
  ) {
    const member = await client.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!member) throw new ForbiddenException('HOUSEHOLD_MEMBERSHIP_REQUIRED');
  }

  private async requireCheckableTrip(
    client: Client,
    householdId: string,
    tripId: string,
  ) {
    const rows = await client.$queryRaw<
      Array<{ id: string; status: string; suggestionsImportedAt: Date | null }>
    >`
      SELECT "id", "status", "suggestionsImportedAt" FROM "ShoppingTrip"
      WHERE "id" = ${tripId} AND "householdId" = ${householdId} FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('TRIP_NOT_FOUND');
    if (rows[0].status !== 'DRAFT')
      throw new ConflictException('TRIP_NOT_DRAFT');
    if (rows[0].suggestionsImportedAt)
      throw new ConflictException('SUGGESTIONS_ALREADY_IMPORTED');
    const imported = await client.shoppingEntry.count({
      where: { tripId, source: 'SUGGESTED' },
    });
    if (imported) throw new ConflictException('SUGGESTIONS_ALREADY_IMPORTED');
  }

  private loadItem(client: Client, householdId: string, itemId: string) {
    return client.inventoryItem.findFirst({
      where: { id: itemId, householdId },
      include: { batches: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
  }

  private async view(client: Client, householdId: string, tripId: string) {
    const checks = await client.tripStockCheck.findMany({
      where: { tripId, item: { householdId } },
      include: {
        item: {
          include: {
            batches: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          },
        },
      },
      orderBy: { itemId: 'asc' },
    });
    return {
      tripId,
      items: checks.map((check) => ({
        itemId: check.itemId,
        name: check.item.name,
        trackingMode: check.item.trackingMode,
        openedTrackingEnabled: check.item.openedTrackingEnabled,
        reason:
          check.decision !== 'PENDING' &&
          check.revision !== check.item.stockRevision
            ? 'STOCK_CHANGED'
            : ((check.before as { reason?: string } | null)?.reason ??
              'STALE_RECORD'),
        status:
          check.decision !== 'PENDING' &&
          check.revision !== check.item.stockRevision
            ? 'STALE'
            : check.decision,
        stockRevision: check.item.stockRevision,
        stock: snapshot(check.item),
        checkedAt: check.checkedAt,
        checkedByUserId: check.userId,
      })),
    };
  }

  async list(actorId: string, householdId: string, tripId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, actorId, householdId);
      await this.requireCheckableTrip(tx, householdId, tripId);
      if (!(await tx.tripStockCheck.count({ where: { tripId } }))) {
        const items = await tx.inventoryItem.findMany({
          where: { householdId },
          include: {
            batches: { select: { createdAt: true } },
            actions: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            stateActions: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            stockChecks: {
              where: { checkedAt: { not: null } },
              select: { checkedAt: true, revision: true },
              orderBy: { checkedAt: 'desc' },
              take: 1,
            },
          },
        });
        const ranked = rankStockChecks(items, new Date());
        await tx.tripStockCheck.createMany({
          data: ranked.map((item) => ({
            tripId,
            itemId: item.itemId,
            revision: item.revision,
            before: { reason: item.reason },
          })),
          skipDuplicates: true,
        });
      }
      return this.view(tx, householdId, tripId);
    });
  }

  async save(
    actorId: string,
    householdId: string,
    tripId: string,
    itemId: string,
    body: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireMember(tx, actorId, householdId);
      await this.requireCheckableTrip(tx, householdId, tripId);
      const check = await tx.tripStockCheck.findUnique({
        where: { tripId_itemId: { tripId, itemId } },
      });
      if (!check) throw new NotFoundException('CHECK_ITEM_NOT_FOUND');
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "InventoryItem" WHERE "id" = ${itemId} AND "householdId" = ${householdId} FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('ITEM_NOT_FOUND');
      const item = await this.loadItem(tx, householdId, itemId);
      if (!item) throw new NotFoundException('ITEM_NOT_FOUND');
      if (!Number.isInteger(body.expectedRevision))
        throw new BadRequestException('INVALID_EXPECTED_REVISION');
      if (body.expectedRevision !== item.stockRevision)
        throw new ConflictException('STOCK_CHANGED');
      if (body.decision !== 'CONFIRM' && body.decision !== 'CORRECT')
        throw new BadRequestException('INVALID_CHECK_DECISION');
      if (
        body.decision === 'CONFIRM' &&
        check.decision === 'CONFIRM' &&
        check.revision === item.stockRevision &&
        check.userId === actorId
      )
        return {
          ...(await this.view(tx, householdId, tripId)),
          changed: false,
        };
      const before = snapshot(item);
      let changed = false;
      if (body.decision === 'CORRECT') {
        if (item.trackingMode === 'QUANTITY') {
          changed = await this.correctQuantity(tx, item, body);
        } else {
          const backupCount = observedBackup(body.backupCount);
          if (item.trackingMode === 'FIVE_LEVEL') {
            if (!LEVELS.includes(body.currentLevel as (typeof LEVELS)[number]))
              throw new BadRequestException('INVALID_LEVEL');
            changed =
              item.currentLevel !== body.currentLevel ||
              item.backupCount !== backupCount;
            if (changed)
              await tx.inventoryItem.update({
                where: { id: itemId },
                data: {
                  currentLevel: body.currentLevel as (typeof LEVELS)[number],
                  backupCount,
                  stockRevision: { increment: 1 },
                },
              });
          } else {
            if (typeof body.isPresent !== 'boolean')
              throw new BadRequestException('INVALID_PRESENCE');
            changed =
              item.isPresent !== body.isPresent ||
              item.backupCount !== backupCount;
            if (changed)
              await tx.inventoryItem.update({
                where: { id: itemId },
                data: {
                  isPresent: body.isPresent,
                  backupCount,
                  stockRevision: { increment: 1 },
                },
              });
          }
        }
      }
      const current = await this.loadItem(tx, householdId, itemId);
      if (!current) throw new NotFoundException('ITEM_NOT_FOUND');
      await tx.tripStockCheck.update({
        where: { tripId_itemId: { tripId, itemId } },
        data: {
          decision: body.decision,
          revision: current.stockRevision,
          userId: actorId,
          checkedAt: new Date(),
          before: {
            reason:
              (check.before as { reason?: string } | null)?.reason ??
              'STALE_RECORD',
            stock: before,
          },
          after: snapshot(current),
          history: [
            ...(Array.isArray(check.history) ? check.history : []),
            {
              decision: body.decision,
              userId: actorId,
              checkedAt: new Date().toISOString(),
              before,
              after: snapshot(current),
            },
          ],
        },
      });
      return { ...(await this.view(tx, householdId, tripId)), changed };
    });
  }

  private async correctQuantity(
    client: Client,
    item: NonNullable<StockItem>,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const total = observedQuantity(body.quantity);
    if (
      item.openedTrackingEnabled &&
      total.gt(0) &&
      !body.batches &&
      !total.isInteger() &&
      !item.batches.some((batch) => batch.openedAt && batch.quantity.gt(0))
    )
      throw new BadRequestException('INVALID_PACKAGE_COUNT');
    const active = item.batches.filter((batch) => batch.quantity.gt(0));
    const beforeTotal = active.reduce(
      (sum, batch) => sum.plus(batch.quantity),
      new Prisma.Decimal(0),
    );
    if (beforeTotal.eq(total) && body.batches === undefined) return false;
    let changes: { id: string; quantity: Prisma.Decimal }[] = [];
    let extra = new Prisma.Decimal(0);
    if (body.batches !== undefined) {
      if (!Array.isArray(body.batches) || body.batches.length !== active.length)
        throw new BadRequestException('INVALID_BATCH_COUNTS');
      const supplied = new Map<string, Prisma.Decimal>();
      for (const entry of body.batches as Record<string, unknown>[]) {
        if (
          !entry ||
          typeof entry.batchId !== 'string' ||
          supplied.has(entry.batchId)
        )
          throw new BadRequestException('INVALID_BATCH_COUNTS');
        supplied.set(entry.batchId, observedQuantity(entry.quantity));
      }
      changes = active.map((batch) => {
        const quantity = supplied.get(batch.id);
        if (!quantity) throw new BadRequestException('INVALID_BATCH_COUNTS');
        return { id: batch.id, quantity };
      });
      extra =
        body.extraUnopenedQuantity === undefined
          ? new Prisma.Decimal(0)
          : observedQuantity(body.extraUnopenedQuantity);
      if (
        !changes
          .reduce((sum, change) => sum.plus(change.quantity), extra)
          .eq(total)
      )
        throw new BadRequestException('BATCH_TOTAL_MISMATCH');
    } else {
      const distinct = new Set(
        active.map(
          (batch) =>
            `${batch.expiryDate?.toISOString() ?? ''}|${batch.openedAt?.toISOString() ?? ''}|${batch.openedUseByDate?.toISOString() ?? ''}`,
        ),
      );
      if (distinct.size > 1)
        throw new ConflictException('BATCH_DETAIL_REQUIRED');
      if (active.length === 0) extra = total;
      else if (total.gte(beforeTotal))
        changes = active.map((batch, index) => ({
          id: batch.id,
          quantity:
            index === 0
              ? batch.quantity.plus(total.minus(beforeTotal))
              : batch.quantity,
        }));
      else {
        let remaining = total;
        changes = active.map((batch) => {
          const quantity = Prisma.Decimal.min(batch.quantity, remaining);
          remaining = remaining.minus(quantity);
          return { id: batch.id, quantity };
        });
      }
    }
    for (const change of changes) {
      const batch = active.find((entry) => entry.id === change.id)!;
      if (body.batches === undefined && batch.openedAt && change.quantity.gt(1))
        throw new ConflictException('BATCH_DETAIL_REQUIRED');
      if (
        item.openedTrackingEnabled &&
        (batch.openedAt ? change.quantity.gt(1) : !change.quantity.isInteger())
      )
        throw new BadRequestException('INVALID_PACKAGE_COUNT');
    }
    if (item.openedTrackingEnabled && !extra.isInteger())
      throw new BadRequestException('INVALID_PACKAGE_COUNT');
    const changed =
      extra.gt(0) ||
      changes.some(
        (change) =>
          !change.quantity.eq(
            active.find((batch) => batch.id === change.id)!.quantity,
          ),
      );
    if (!changed) return false;
    for (const change of changes)
      await client.stockBatch.update({
        where: { id: change.id },
        data: { quantity: change.quantity },
      });
    if (extra.gt(0))
      await client.stockBatch.create({
        data: { itemId: item.id, quantity: extra },
      });
    await client.inventoryItem.update({
      where: { id: item.id },
      data: { stockRevision: { increment: 1 } },
    });
    return true;
  }
}
