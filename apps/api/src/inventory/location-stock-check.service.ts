import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type StockLevel } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LEVELS } from './inventory-state.service.js';
import { MAX_QUANTITY } from './quantity-validation.js';

type Client = Prisma.TransactionClient;
type Item = NonNullable<
  Awaited<ReturnType<LocationStockCheckService['loadItem']>>
>;
const ZERO = new Prisma.Decimal(0);
const STALE_MS = 30 * 86_400_000;

function count(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value))
    throw new BadRequestException(`INVALID_${field}`);
  const parsed = new Prisma.Decimal(value);
  if (parsed.gt(MAX_QUANTITY))
    throw new BadRequestException(`INVALID_${field}`);
  return parsed;
}

function backupCount(value: unknown) {
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 2147483647
  )
    throw new BadRequestException('INVALID_BACKUP_COUNT');
  return value as number;
}

function expiry(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('INVALID_EXPIRY_DATE');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('INVALID_EXPIRY_DATE');
  return date;
}

function associated(item: Item, locationId: string) {
  return item.trackingMode === 'QUANTITY'
    ? item.preferredRestockLocationId === locationId || item.batches.length > 0
    : item.currentLocationId === locationId ||
        item.backupLocationId === locationId;
}

function snapshot(item: Item, locationId: string) {
  if (item.trackingMode === 'QUANTITY')
    return {
      quantity: item.batches
        .reduce((sum, batch) => sum.plus(batch.quantity), ZERO)
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
  return {
    ...(item.currentLocationId === locationId
      ? item.trackingMode === 'FIVE_LEVEL'
        ? { currentLevel: item.currentLevel }
        : { isPresent: item.isPresent }
      : {}),
    ...(item.backupLocationId === locationId
      ? { backupCount: item.backupCount }
      : {}),
  };
}

function viewItem(item: Item, locationId: string, now: Date) {
  const check = item.locationStockChecks[0];
  const stale = !!check?.checkedAt && check.revision !== item.stockRevision;
  const missing =
    item.currentLocationId === locationId &&
    (item.trackingMode === 'FIVE_LEVEL'
      ? item.currentLevel === null
      : item.trackingMode === 'PRESENCE_BACKUP' && item.isPresent === null);
  const dates = [
    ...item.batches.map((batch) => batch.createdAt),
    ...(item.trackingMode === 'QUANTITY'
      ? []
      : item.stateActions
          .filter(
            (action) =>
              (item.currentLocationId === locationId &&
                (action.beforeLevel !== action.afterLevel ||
                  action.beforePresent !== action.afterPresent)) ||
              (item.backupLocationId === locationId &&
                action.beforeBackupCount !== action.afterBackupCount),
          )
          .map((action) => action.createdAt)),
    ...(check?.checkedAt && !stale ? [check.checkedAt] : []),
  ];
  const latest = dates.length
    ? Math.max(...dates.map((date) => date.getTime()))
    : null;
  const reason = stale
    ? 'STOCK_CHANGED'
    : missing
      ? 'MISSING_STATE'
      : latest === null
        ? 'NO_STOCK_RECORD'
        : latest < now.getTime() - STALE_MS
          ? 'STALE_RECORD'
          : 'RECENT_RECORD';
  const status = stale
    ? 'STALE'
    : check?.checkedAt
      ? check.decision
      : 'PENDING';
  return {
    itemId: item.id,
    name: item.name,
    trackingMode: item.trackingMode,
    openedTrackingEnabled: item.openedTrackingEnabled,
    stockRevision: item.stockRevision,
    stock: snapshot(item, locationId),
    status,
    reason,
    checkedAt: check?.checkedAt ?? null,
    checkedByUserId: check?.userId ?? null,
    priority:
      stale ||
      missing ||
      reason === 'NO_STOCK_RECORD' ||
      reason === 'STALE_RECORD'
        ? 0
        : 1,
  };
}

@Injectable()
export class LocationStockCheckService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireAccess(
    tx: Client,
    actorId: string,
    householdId: string,
    locationId: string,
  ) {
    const member = await tx.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!member) throw new ForbiddenException('HOUSEHOLD_MEMBERSHIP_REQUIRED');
    const location = await tx.location.findFirst({
      where: { id: locationId, householdId },
    });
    if (!location) throw new NotFoundException('LOCATION_NOT_FOUND');
    return location;
  }

  private loadItem(
    tx: Client,
    householdId: string,
    locationId: string,
    itemId: string,
  ) {
    return tx.inventoryItem.findFirst({
      where: { id: itemId, householdId },
      include: {
        batches: {
          where: { locationId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        stateActions: {
          select: {
            createdAt: true,
            beforeLevel: true,
            afterLevel: true,
            beforePresent: true,
            afterPresent: true,
            beforeBackupCount: true,
            afterBackupCount: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        locationStockChecks: { where: { locationId }, take: 1 },
      },
    });
  }

  async list(actorId: string, householdId: string, locationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const location = await this.requireAccess(
        tx,
        actorId,
        householdId,
        locationId,
      );
      const items = await tx.inventoryItem.findMany({
        where: {
          householdId,
          OR: [
            {
              trackingMode: 'QUANTITY',
              preferredRestockLocationId: locationId,
            },
            { trackingMode: 'QUANTITY', batches: { some: { locationId } } },
            {
              trackingMode: { in: ['FIVE_LEVEL', 'PRESENCE_BACKUP'] },
              currentLocationId: locationId,
            },
            {
              trackingMode: { in: ['FIVE_LEVEL', 'PRESENCE_BACKUP'] },
              backupLocationId: locationId,
            },
          ],
        },
        include: {
          batches: {
            where: { locationId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
          stateActions: {
            select: {
              createdAt: true,
              beforeLevel: true,
              afterLevel: true,
              beforePresent: true,
              afterPresent: true,
              beforeBackupCount: true,
              afterBackupCount: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          },
          locationStockChecks: { where: { locationId }, take: 1 },
        },
      });
      const now = new Date();
      return {
        location: { id: location.id, name: location.name },
        items: items
          .map((item) => viewItem(item, locationId, now))
          .sort(
            (a, b) =>
              a.priority - b.priority ||
              a.name.localeCompare(b.name) ||
              a.itemId.localeCompare(b.itemId),
          )
          .map(({ priority: _priority, ...item }) => item),
      };
    });
  }

  async save(
    actorId: string,
    householdId: string,
    locationId: string,
    itemId: string,
    body: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.requireAccess(tx, actorId, householdId, locationId);
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "InventoryItem" WHERE "id" = ${itemId} AND "householdId" = ${householdId} FOR UPDATE
      `;
        if (!locked.length) throw new NotFoundException('ITEM_NOT_FOUND');
        const item = await this.loadItem(tx, householdId, locationId, itemId);
        if (!item || !associated(item, locationId))
          throw new NotFoundException('CHECK_ITEM_NOT_FOUND');
        if (
          !Number.isInteger(body?.expectedRevision) ||
          (body.expectedRevision as number) < 0
        )
          throw new BadRequestException('INVALID_EXPECTED_REVISION');
        if (body.expectedRevision !== item.stockRevision)
          throw new ConflictException('STOCK_CHANGED');
        if (body.decision !== 'CONFIRM' && body.decision !== 'CORRECT')
          throw new BadRequestException('INVALID_CHECK_DECISION');
        const check = item.locationStockChecks[0];
        if (
          body.decision === 'CONFIRM' &&
          check?.decision === 'CONFIRM' &&
          check.revision === item.stockRevision &&
          check.userId === actorId
        )
          return {
            item: viewItem(item, locationId, new Date()),
            changed: false,
          };
        const before = snapshot(item, locationId);
        const changed =
          body.decision === 'CORRECT'
            ? item.trackingMode === 'QUANTITY'
              ? await this.correctQuantity(tx, item, locationId, body)
              : await this.correctState(tx, item, locationId, body)
            : false;
        const current = await this.loadItem(
          tx,
          householdId,
          locationId,
          itemId,
        );
        if (!current) throw new NotFoundException('ITEM_NOT_FOUND');
        const after = snapshot(current, locationId);
        const checkedAt = new Date();
        await tx.locationStockCheck.upsert({
          where: { locationId_itemId: { locationId, itemId } },
          create: {
            locationId,
            itemId,
            householdId,
            userId: actorId,
            decision: body.decision,
            revision: current.stockRevision,
            before,
            after,
            checkedAt,
            history: [
              {
                decision: body.decision,
                userId: actorId,
                checkedAt: checkedAt.toISOString(),
                revisionBefore: item.stockRevision,
                revisionAfter: current.stockRevision,
                before,
                after,
              },
            ],
          },
          update: {
            userId: actorId,
            decision: body.decision,
            revision: current.stockRevision,
            before,
            after,
            checkedAt,
            history: [
              ...(check && Array.isArray(check.history) ? check.history : []),
              {
                decision: body.decision,
                userId: actorId,
                checkedAt: checkedAt.toISOString(),
                revisionBefore: item.stockRevision,
                revisionAfter: current.stockRevision,
                before,
                after,
              },
            ],
          },
        });
        const saved = await this.loadItem(tx, householdId, locationId, itemId);
        return { item: viewItem(saved!, locationId, checkedAt), changed };
      },
      { timeout: 10000 },
    );
  }

  private async correctState(
    tx: Client,
    item: Item,
    locationId: string,
    body: Record<string, unknown>,
  ) {
    const currentHere = item.currentLocationId === locationId;
    const backupHere = item.backupLocationId === locationId;
    const hasLevel = Object.hasOwn(body, 'currentLevel');
    const hasPresence = Object.hasOwn(body, 'isPresent');
    const hasBackup = Object.hasOwn(body, 'backupCount');
    if (
      (hasLevel && (!currentHere || item.trackingMode !== 'FIVE_LEVEL')) ||
      (hasPresence &&
        (!currentHere || item.trackingMode !== 'PRESENCE_BACKUP')) ||
      (hasBackup && !backupHere)
    )
      throw new BadRequestException('FIELD_NOT_AT_LOCATION');
    if (!(hasLevel || hasPresence || hasBackup))
      throw new BadRequestException('OBSERVATION_REQUIRED');
    if (hasLevel && !LEVELS.includes(body.currentLevel as StockLevel))
      throw new BadRequestException('INVALID_LEVEL');
    if (hasPresence && typeof body.isPresent !== 'boolean')
      throw new BadRequestException('INVALID_PRESENCE');
    const observedBackups = hasBackup
      ? backupCount(body.backupCount)
      : item.backupCount;
    const changed =
      (hasLevel && body.currentLevel !== item.currentLevel) ||
      (hasPresence && body.isPresent !== item.isPresent) ||
      observedBackups !== item.backupCount;
    if (changed)
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: {
          ...(hasLevel
            ? { currentLevel: body.currentLevel as StockLevel }
            : {}),
          ...(hasPresence ? { isPresent: body.isPresent as boolean } : {}),
          ...(hasBackup ? { backupCount: observedBackups } : {}),
          stockRevision: { increment: 1 },
        },
      });
    return changed;
  }

  private async correctQuantity(
    tx: Client,
    item: Item,
    locationId: string,
    body: Record<string, unknown>,
  ) {
    const observed = count(body.quantity, 'QUANTITY');
    const active = item.batches.filter((batch) => batch.quantity.gt(0));
    const previous = active.reduce(
      (sum, batch) => sum.plus(batch.quantity),
      ZERO,
    );
    const detailed = body.batches !== undefined;
    const changes: {
      id: string;
      before: Prisma.Decimal;
      after: Prisma.Decimal;
    }[] = [];
    let extra = ZERO;
    if (detailed) {
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
        supplied.set(entry.batchId, count(entry.quantity, 'BATCH_COUNT'));
      }
      for (const batch of active) {
        const after = supplied.get(batch.id);
        if (!after || (after.gt(batch.quantity) && !batch.openedAt))
          throw new BadRequestException('INVALID_BATCH_COUNTS');
        changes.push({ id: batch.id, before: batch.quantity, after });
      }
      extra =
        body.extraUnopenedQuantity === undefined
          ? ZERO
          : count(body.extraUnopenedQuantity, 'EXTRA_QUANTITY');
      if (
        !changes
          .reduce((sum, change) => sum.plus(change.after), extra)
          .eq(observed)
      )
        throw new BadRequestException('BATCH_TOTAL_MISMATCH');
    } else if (!observed.eq(previous)) {
      const properties = new Set(
        active.map(
          (batch) =>
            `${batch.expiryDate?.toISOString() ?? ''}|${batch.openedAt?.toISOString() ?? ''}|${batch.openedUseByDate?.toISOString() ?? ''}`,
        ),
      );
      if (properties.size > 1)
        throw new ConflictException('BATCH_DETAIL_REQUIRED');
      if (observed.gt(previous)) extra = observed.minus(previous);
      else {
        let remaining = observed;
        for (const batch of active) {
          const after = Prisma.Decimal.min(batch.quantity, remaining);
          changes.push({ id: batch.id, before: batch.quantity, after });
          remaining = remaining.minus(after);
        }
      }
    }
    if (
      item.openedTrackingEnabled &&
      (!extra.isInteger() ||
        changes.some((change) => {
          const batch = active.find((entry) => entry.id === change.id)!;
          return batch.openedAt
            ? change.after.gt(1)
            : !change.after.isInteger();
        }))
    )
      throw new BadRequestException('INVALID_PACKAGE_COUNT');
    if (body.extraExpiryDate !== undefined && extra.eq(0))
      throw new BadRequestException('INVALID_EXPIRY_DATE');
    const extraExpiry = expiry(body.extraExpiryDate);
    const changed =
      extra.gt(0) || changes.some((change) => !change.after.eq(change.before));
    if (!changed) return false;
    for (const change of changes)
      if (!change.after.eq(change.before))
        await tx.stockBatch.update({
          where: { id: change.id },
          data: { quantity: change.after },
        });
    if (extra.gt(0))
      await tx.stockBatch.create({
        data: {
          itemId: item.id,
          locationId,
          quantity: extra,
          expiryDate: extraExpiry,
        },
      });
    await tx.inventoryItem.update({
      where: { id: item.id },
      data: { stockRevision: { increment: 1 } },
    });
    return true;
  }
}
