import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import {
  InventoryService,
  parseQuantity,
} from '../inventory/inventory.service.js';
import {
  InventoryStateService,
  parseBackupCount,
} from '../inventory/inventory-state.service.js';
import {
  addCalendarDays,
  purchasableSuggestionQuantity,
} from '../inventory/stock-intelligence.js';
import { StockIntelligenceService } from '../inventory/stock-intelligence.service.js';
import {
  effectiveExpiryDate,
  localCalendarDate,
} from '../inventory/plan-use.js';
import { PrismaService } from '../prisma/prisma.service.js';

function calendarDate(value: unknown, label: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${label} must be YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${label} must be a valid calendar date.`);
  }
  return date;
}

@Injectable()
export class ShoppingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly state: InventoryStateService,
    private readonly intelligence: StockIntelligenceService,
  ) {}

  private async lockDraftDestination(
    tx: Prisma.TransactionClient,
    householdId: string,
    sourceTripId: string,
    destinationTripId: string,
  ) {
    if (destinationTripId === sourceTripId)
      throw new BadRequestException('INVALID_DESTINATION_TRIP');
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status" FROM "ShoppingTrip"
      WHERE "id" = ${destinationTripId} AND "householdId" = ${householdId}
      FOR UPDATE
    `;
    if (rows.length !== 1)
      throw new NotFoundException('DESTINATION_TRIP_NOT_FOUND');
    if (rows[0].status !== 'DRAFT')
      throw new ConflictException('DESTINATION_NOT_DRAFT');
  }

  private async carryMovesInTransaction(
    tx: Prisma.TransactionClient,
    moved: Array<{
      moveToTripId: string | null;
      itemId: string;
      priority: 'MUST_BUY' | 'SHOULD_BUY' | 'OPTIONAL';
    }>,
  ) {
    if (moved.length === 0) return;
    await tx.shoppingEntry.createMany({
      data: moved.map((entry) => ({
        tripId: entry.moveToTripId!,
        itemId: entry.itemId,
        status: 'PENDING' as const,
        source: 'MANUAL' as const,
        priority: entry.priority,
      })),
      skipDuplicates: true,
    });
  }

  private async requireMember(actorId: string, householdId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!membership)
      throw new ForbiddenException(
        'Household membership is required for shopping trips.',
      );
  }

  async list(actorId: string, householdId: string) {
    await this.requireMember(actorId, householdId);
    return this.prisma.shoppingTrip.findMany({
      where: { householdId },
      include: { _count: { select: { entries: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async read(actorId: string, householdId: string, tripId: string) {
    await this.requireMember(actorId, householdId);
    const trip = await this.prisma.shoppingTrip.findFirst({
      where: { id: tripId, householdId },
      include: {
        entries: {
          include: {
            location: true,
            moveToTrip: {
              select: {
                id: true,
                store: true,
                plannedDate: true,
                status: true,
              },
            },
            item: {
              select: {
                id: true,
                name: true,
                primaryUnit: true,
                trackingMode: true,
                openedTrackingEnabled: true,
                category: {
                  select: { householdId: true, shoppingSection: true },
                },
                preferredRestockLocationId: true,
                preferredRestockLocation: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: [{ priority: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!trip)
      throw new NotFoundException(
        'Shopping trip was not found in this household.',
      );
    return {
      ...trip,
      entries: trip.entries.map((entry) => {
        const { category, ...item } = entry.item;
        return {
          ...entry,
          item,
          shoppingSection:
            category?.householdId === householdId
              ? (category.shoppingSection ?? 'OTHER')
              : 'OTHER',
        };
      }),
    };
  }

  async create(
    actorId: string,
    householdId: string,
    store: unknown,
    plannedDateInput: unknown,
  ) {
    if (
      typeof store !== 'string' ||
      !store.trim() ||
      store.trim().length > 120
    ) {
      throw new BadRequestException(
        'Store is required and must be at most 120 characters.',
      );
    }
    const plannedDate = calendarDate(plannedDateInput, 'Planned date');
    const today = localCalendarDate(new Date());
    const date = plannedDate.toISOString().slice(0, 10);
    if (date < today || date > addCalendarDays(today, 30)) {
      throw new BadRequestException(
        'Planned date must be from today through 30 days ahead.',
      );
    }
    await this.requireMember(actorId, householdId);
    return this.prisma.shoppingTrip.create({
      data: {
        householdId,
        createdByUserId: actorId,
        store: store.trim(),
        plannedDate,
      },
    });
  }

  async importSuggestions(
    actorId: string,
    householdId: string,
    tripId: string,
  ) {
    await this.requireMember(actorId, householdId);
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          status: string;
          plannedDate: Date;
          suggestionsImportedAt: Date | null;
        }>
      >`
        SELECT "status", "plannedDate", "suggestionsImportedAt" FROM "ShoppingTrip"
        WHERE "id" = ${tripId} AND "householdId" = ${householdId}
        FOR UPDATE
      `;
      if (locked.length !== 1)
        throw new NotFoundException(
          'Shopping trip was not found in this household.',
        );
      if (locked[0]?.status !== 'DRAFT') {
        throw new ConflictException(
          'Suggestions can only be added to a draft trip.',
        );
      }
      if (locked[0].suggestionsImportedAt) return;
      const legacySuggestion = await tx.shoppingEntry.findFirst({
        where: { tripId, source: 'SUGGESTED' },
        select: { id: true },
      });
      if (legacySuggestion) {
        await tx.shoppingTrip.update({
          where: { id: tripId },
          data: { suggestionsImportedAt: new Date() },
        });
        return;
      }
      // Serialize candidate assessment and insertion with item Archive.
      // Archive also locks its item row before checking active entries.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "InventoryItem"
        WHERE "householdId" = ${householdId} AND "archivedAt" IS NULL
        ORDER BY "id" FOR UPDATE
      `;
      const previousTrip = await tx.shoppingTrip.findFirst({
        where: {
          householdId,
          id: { not: tripId },
          status: 'RESTOCKED',
          plannedDate: { lte: locked[0].plannedDate },
          completedAt: { lte: new Date() },
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        select: {
          entries: {
            where: { status: 'SKIPPED' },
            select: { itemId: true },
          },
        },
      });
      const skippedIds = new Set(
        previousTrip?.entries.map((entry) => entry.itemId) ?? [],
      );
      const assessment = await this.intelligence.assessInTransaction(
        tx,
        actorId,
        householdId,
        locked[0].plannedDate.toISOString().slice(0, 10),
      );
      const skippedTargets = skippedIds.size
        ? await tx.inventoryItem.findMany({
            where: {
              householdId,
              archivedAt: null,
              id: { in: [...skippedIds] },
            },
            select: {
              id: true,
              targetStock: true,
              openedTrackingEnabled: true,
              batches: {
                select: {
                  quantity: true,
                  expiryDate: true,
                  openedAt: true,
                  openedUseByDate: true,
                },
              },
            },
          })
        : [];
      const targetById = new Map(skippedTargets.map((item) => [item.id, item]));
      const plannedDate = locked[0].plannedDate.toISOString().slice(0, 10);
      const skippedReason = 'Skipped on the previous trip.';
      const quantitySuggestions = assessment.suggestions.map((entry) => ({
        tripId,
        itemId: entry.itemId,
        source: 'SUGGESTED' as const,
        priority: entry.suggestion!.priority as 'MUST_BUY' | 'SHOULD_BUY',
        suggestedQuantity: entry.suggestion!.quantity,
        suggestedReason: skippedIds.has(entry.itemId)
          ? `${entry.suggestion!.reason} ${skippedReason}`
          : entry.suggestion!.reason,
      }));
      const skippedOptional = assessment.assessments.flatMap((entry) => {
        if (
          !skippedIds.has(entry.itemId) ||
          'purchasePriority' in entry ||
          entry.suggestion
        )
          return [];
        const item = targetById.get(entry.itemId);
        if (!item?.targetStock) return [];
        const eligible = item.batches.reduce((sum, batch) => {
          const expiry = effectiveExpiryDate(batch)?.toISOString().slice(0, 10);
          return batch.quantity.gt(0) && (!expiry || expiry >= plannedDate)
            ? sum.plus(batch.quantity)
            : sum;
        }, new Prisma.Decimal(0));
        const gap = item.targetStock.minus(eligible);
        if (gap.lte(0)) return [];
        const purchaseQuantity = purchasableSuggestionQuantity(
          gap,
          item.openedTrackingEnabled,
        );
        return [
          {
            tripId,
            itemId: entry.itemId,
            source: 'SUGGESTED' as const,
            priority: 'OPTIONAL' as const,
            suggestedQuantity: purchaseQuantity.toString(),
            suggestedReason: `${skippedReason} Buy ${purchaseQuantity.toString()} ${entry.primaryUnit} to ${item.openedTrackingEnabled ? 'meet or exceed' : 'reach'} the target of ${item.targetStock.toString()}.`,
          },
        ];
      });
      const backupSuggestions = assessment.assessments.flatMap((entry) => {
        if (
          !('purchasePriority' in entry) ||
          entry.recommendedAction !== 'BUY_BACKUP'
        )
          return [];
        return [
          {
            tripId,
            itemId: entry.itemId,
            source: 'SUGGESTED' as const,
            priority: entry.purchasePriority as 'MUST_BUY' | 'SHOULD_BUY',
            suggestedQuantity: null,
            suggestedReason: skippedIds.has(entry.itemId)
              ? `${entry.reasons[1]} ${skippedReason}`
              : entry.reasons[1],
          },
        ];
      });
      await tx.shoppingEntry.createMany({
        data: [
          ...quantitySuggestions,
          ...backupSuggestions,
          ...skippedOptional,
        ],
        skipDuplicates: true,
      });
      await tx.shoppingTrip.updateMany({
        where: { id: tripId, suggestionsImportedAt: null },
        data: { suggestionsImportedAt: new Date() },
      });
    });
    return this.read(actorId, householdId, tripId);
  }

  async addManual(
    actorId: string,
    householdId: string,
    tripId: string,
    itemId: unknown,
  ) {
    if (typeof itemId !== 'string')
      throw new BadRequestException('Item ID is required.');
    await this.requireMember(actorId, householdId);
    try {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT "status" FROM "ShoppingTrip"
          WHERE "id" = ${tripId} AND "householdId" = ${householdId}
          FOR UPDATE
        `;
        if (locked.length !== 1)
          throw new NotFoundException(
            'Shopping trip was not found in this household.',
          );
        if (!['DRAFT', 'SHOPPING'].includes(locked[0].status)) {
          throw new ConflictException('This trip is already finished.');
        }
        const item = await tx.$queryRaw<
          Array<{ id: string; archivedAt: Date | null }>
        >`
          SELECT "id", "archivedAt" FROM "InventoryItem"
          WHERE "id" = ${itemId} AND "householdId" = ${householdId}
          FOR UPDATE
        `;
        if (!item.length)
          throw new NotFoundException(
            'Inventory item was not found in this household.',
          );
        if (item[0].archivedAt) throw new ConflictException('ITEM_ARCHIVED');
        await tx.shoppingEntry.create({
          data: { tripId, itemId, source: 'MANUAL', priority: 'OPTIONAL' },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This item is already on the trip.');
      }
      throw error;
    }
    return this.read(actorId, householdId, tripId);
  }

  async start(actorId: string, householdId: string, tripId: string) {
    await this.requireMember(actorId, householdId);
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "ShoppingTrip"
        WHERE "id" = ${tripId} AND "householdId" = ${householdId}
        FOR UPDATE
      `;
      if (locked.length !== 1)
        throw new NotFoundException(
          'Shopping trip was not found in this household.',
        );
      if (locked[0].status !== 'DRAFT')
        throw new ConflictException('Only a draft trip can start shopping.');
      await tx.shoppingTrip.update({
        where: { id: tripId },
        data: { status: 'SHOPPING' },
      });
    });
    return this.read(actorId, householdId, tripId);
  }

  async removeEntry(
    actorId: string,
    householdId: string,
    tripId: string,
    entryId: string,
  ) {
    await this.requireMember(actorId, householdId);
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "ShoppingTrip"
        WHERE "id" = ${tripId} AND "householdId" = ${householdId}
        FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException('TRIP_NOT_FOUND');
      if (!['DRAFT', 'SHOPPING'].includes(locked[0].status))
        throw new ConflictException('TRIP_ALREADY_FINISHED');
      const removed = await tx.shoppingEntry.deleteMany({
        where: { id: entryId, tripId },
      });
      if (removed.count !== 1) throw new NotFoundException('ENTRY_NOT_FOUND');
    });
    return this.read(actorId, householdId, tripId);
  }

  async decideEntry(
    actorId: string,
    householdId: string,
    tripId: string,
    entryId: string,
    status: unknown,
    actualQuantity: unknown,
    expiryDateInput: unknown,
    locationIdInput?: unknown,
    destinationTripIdInput?: unknown,
  ) {
    if (
      typeof status !== 'string' ||
      !['PENDING', 'PURCHASED', 'SKIPPED', 'MOVED'].includes(status)
    ) {
      throw new BadRequestException(
        'Entry status must be PENDING, PURCHASED, SKIPPED, or MOVED.',
      );
    }
    if (status === 'MOVED') {
      if (typeof destinationTripIdInput !== 'string' || !destinationTripIdInput)
        throw new BadRequestException('INVALID_DESTINATION_TRIP');
    } else if (
      destinationTripIdInput !== undefined &&
      destinationTripIdInput !== null &&
      destinationTripIdInput !== ''
    ) {
      throw new BadRequestException('DESTINATION_NOT_SUPPORTED');
    }
    const purchased = status === 'PURCHASED';
    await this.requireMember(actorId, householdId);
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "ShoppingTrip"
        WHERE "id" = ${tripId} AND "householdId" = ${householdId}
        FOR UPDATE
      `;
      if (locked.length !== 1)
        throw new NotFoundException(
          'Shopping trip was not found in this household.',
        );
      if (locked[0].status !== 'SHOPPING')
        throw new ConflictException(
          'Shopping decisions require an active trip.',
        );
      const entry = await tx.shoppingEntry.findFirst({
        where: { id: entryId, tripId },
        select: {
          id: true,
          itemId: true,
          locationId: true,
          item: { select: { trackingMode: true } },
        },
      });
      if (!entry)
        throw new NotFoundException(
          'Shopping entry was not found in this trip.',
        );
      if (status === 'MOVED')
        await this.lockDraftDestination(
          tx,
          householdId,
          tripId,
          destinationTripIdInput as string,
        );
      let quantity: Prisma.Decimal | null = null;
      let expiryDate: Date | null = null;
      let locationId: string | null = null;
      if (purchased) {
        if (entry.item.trackingMode === 'QUANTITY') {
          if (typeof actualQuantity !== 'string')
            throw new BadRequestException(
              'Actual quantity is required for a purchase.',
            );
          quantity = parseQuantity(actualQuantity, 'Restock');
          if (
            expiryDateInput !== null &&
            expiryDateInput !== undefined &&
            expiryDateInput !== ''
          )
            expiryDate = calendarDate(expiryDateInput, 'Expiry date');
          if (locationIdInput === undefined) {
            locationId = entry.locationId;
          } else if (locationIdInput === null || locationIdInput === '') {
            locationId = null;
          } else if (typeof locationIdInput === 'string') {
            const [location] = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT "id" FROM "Location"
              WHERE "id" = ${locationIdInput} AND "householdId" = ${householdId}
              FOR KEY SHARE
            `;
            if (!location) {
              throw new BadRequestException({
                statusCode: 400,
                error: 'Bad Request',
                code: 'LOCATION_NOT_FOUND',
                message: 'Location was not found in this household.',
                itemId: entry.itemId,
              });
            }
            locationId = location.id;
          } else {
            throw new BadRequestException({
              statusCode: 400,
              error: 'Bad Request',
              code: 'INVALID_LOCATION_ID',
              message: 'locationId must be a location ID.',
              itemId: entry.itemId,
            });
          }
        } else {
          if (
            locationIdInput !== undefined &&
            locationIdInput !== null &&
            locationIdInput !== ''
          ) {
            throw new BadRequestException({
              statusCode: 400,
              error: 'Bad Request',
              code: 'LOCATION_NOT_SUPPORTED',
              message: 'Location is only supported for quantity purchases.',
              itemId: entry.itemId,
            });
          }
          const count = parseBackupCount(actualQuantity);
          if (expiryDateInput !== null && expiryDateInput !== undefined)
            throw new BadRequestException(
              'Expiry date is not supported for backup purchases.',
            );
          quantity = new Prisma.Decimal(count);
        }
      }
      await tx.shoppingEntry.update({
        where: { id: entryId },
        data: {
          status: status as 'PENDING' | 'PURCHASED' | 'SKIPPED' | 'MOVED',
          actualQuantity: quantity,
          expiryDate,
          locationId,
          moveToTripId:
            status === 'MOVED' ? (destinationTripIdInput as string) : null,
        },
      });
    });
    return this.read(actorId, householdId, tripId);
  }

  async finish(actorId: string, householdId: string, tripId: string) {
    await this.requireMember(actorId, householdId);
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "ShoppingTrip"
        WHERE "id" = ${tripId} AND "householdId" = ${householdId}
        FOR UPDATE
      `;
        if (locked.length !== 1)
          throw new NotFoundException(
            'Shopping trip was not found in this household.',
          );
        if (locked[0].status === 'RESTOCKED') return;
        if (locked[0].status !== 'SHOPPING')
          throw new ConflictException(
            'Start shopping before finishing this trip.',
          );
        const entries = await tx.shoppingEntry.findMany({
          where: { tripId },
          include: { item: { select: { trackingMode: true } } },
        });
        const moved = entries.filter((entry) => entry.status === 'MOVED');
        const destinationIds = [
          ...new Set(moved.map((entry) => entry.moveToTripId)),
        ];
        if (destinationIds.includes(null))
          throw new ConflictException('MOVE_DESTINATION_REQUIRED');
        for (const destinationId of destinationIds
          .filter((id): id is string => id !== null)
          .sort())
          await this.lockDraftDestination(
            tx,
            householdId,
            tripId,
            destinationId,
          );
        const purchased = entries
          .filter((entry) => entry.status === 'PURCHASED')
          .sort((left, right) => left.itemId.localeCompare(right.itemId));
        for (const entry of purchased) {
          if (!entry.actualQuantity)
            throw new BadRequestException(
              'Purchased entries need an actual quantity.',
            );
          if (entry.item.trackingMode === 'QUANTITY') {
            parseQuantity(entry.actualQuantity.toString(), 'Restock');
          } else {
            parseBackupCount(entry.actualQuantity.toString());
            if (entry.expiryDate)
              throw new BadRequestException(
                'Expiry date is not supported for backup purchases.',
              );
          }
        }
        await this.carryMovesInTransaction(tx, moved);
        for (const entry of purchased) {
          if (entry.item.trackingMode === 'QUANTITY') {
            await this.inventory.restockInTransaction(tx, {
              actorId,
              householdId,
              itemId: entry.itemId,
              quantity: entry.actualQuantity!.toString(),
              expiryDate: entry.expiryDate,
              locationId: entry.locationId,
            });
          } else {
            await this.state.transitionInTransaction(
              tx,
              actorId,
              householdId,
              entry.itemId,
              {
                type: 'ADD_BACKUP',
                count: parseBackupCount(entry.actualQuantity!.toString()),
              },
            );
          }
        }
        await tx.shoppingEntry.updateMany({
          where: { tripId, status: 'PENDING' },
          data: { status: 'SKIPPED' },
        });
        await tx.shoppingTrip.update({
          where: { id: tripId },
          data: {
            status: 'RESTOCKED',
            completedAt: new Date(),
            completedByUserId: actorId,
          },
        });
      },
      { timeout: 10000 },
    );
    return this.read(actorId, householdId, tripId);
  }
}
