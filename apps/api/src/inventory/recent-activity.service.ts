import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const LIMIT = 20;

type StockValue = string | number | boolean | null;
type StockSummary = Record<string, StockValue>;

export interface RecentActivityEvent {
  id: string;
  type: string;
  occurredAt: Date;
  actorId: string | null;
  item: { id: string; name: string; primaryUnit: string } | null;
  trip: { id: string; store: string } | null;
  location: { id: string; name: string } | null;
  quantity: string | null;
  change: { before: StockSummary; after: StockSummary } | null;
  isUndone: boolean;
  undoneAt: Date | null;
  reversesEventId: string | null;
  reversesType: string | null;
}

function stockSummary(value: unknown): StockSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: StockSummary = {};
  if (
    typeof source.quantity === 'string' ||
    typeof source.quantity === 'number'
  )
    result.quantity = String(source.quantity);
  if (source.currentLevel === null || typeof source.currentLevel === 'string')
    result.currentLevel = source.currentLevel;
  if (source.isPresent === null || typeof source.isPresent === 'boolean')
    result.isPresent = source.isPresent;
  if (source.backupCount === null || Number.isInteger(source.backupCount))
    result.backupCount = source.backupCount as number | null;
  return result;
}

function correctionEvents(
  history: unknown,
  prefix: string,
  type: 'TRIP_STOCK_CORRECTED' | 'LOCATION_STOCK_CORRECTED',
  item: RecentActivityEvent['item'],
  trip: RecentActivityEvent['trip'],
  location: RecentActivityEvent['location'],
): RecentActivityEvent[] {
  if (!Array.isArray(history)) return [];
  return history.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    if (
      entry.decision !== 'CORRECT' ||
      typeof entry.userId !== 'string' ||
      !entry.userId ||
      typeof entry.checkedAt !== 'string'
    )
      return [];
    const occurredAt = new Date(entry.checkedAt);
    if (Number.isNaN(occurredAt.getTime())) return [];
    return [
      {
        id: `${prefix}:${index}`,
        type,
        occurredAt,
        actorId: entry.userId,
        item,
        trip,
        location,
        quantity: null,
        change: {
          before: stockSummary(entry.before),
          after: stockSummary(entry.after),
        },
        isUndone: false,
        undoneAt: null,
        reversesEventId: null,
        reversesType: null,
      },
    ];
  });
}

export function orderRecentActivity(events: RecentActivityEvent[]) {
  return events
    .sort(
      (left, right) =>
        right.occurredAt.getTime() - left.occurredAt.getTime() ||
        right.id.localeCompare(left.id),
    )
    .slice(0, LIMIT);
}

@Injectable()
export class RecentActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actorId: string, householdId: string) {
    const member = await this.prisma.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!member) throw new ForbiddenException('HOUSEHOLD_MEMBERSHIP_REQUIRED');

    const [
      quantityActions,
      stateActions,
      undos,
      trips,
      tripChecks,
      locationChecks,
    ] = await Promise.all([
      this.prisma.inventoryAction.findMany({
        where: { householdId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIMIT,
        include: {
          item: { select: { id: true, name: true, primaryUnit: true } },
          undo: { select: { createdAt: true } },
        },
      }),
      this.prisma.inventoryStateAction.findMany({
        where: { householdId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIMIT,
        include: {
          item: { select: { id: true, name: true, primaryUnit: true } },
          undo: { select: { createdAt: true } },
        },
      }),
      this.prisma.inventoryUndo.findMany({
        where: { householdId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIMIT,
        include: {
          item: { select: { id: true, name: true, primaryUnit: true } },
          inventoryAction: { select: { id: true, type: true, quantity: true } },
          stateAction: {
            select: {
              id: true,
              type: true,
              beforeLevel: true,
              afterLevel: true,
              beforePresent: true,
              afterPresent: true,
              beforeBackupCount: true,
              afterBackupCount: true,
            },
          },
        },
      }),
      this.prisma.shoppingTrip.findMany({
        where: { householdId, status: 'RESTOCKED', completedAt: { not: null } },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        take: LIMIT,
        select: {
          id: true,
          store: true,
          completedAt: true,
          completedByUserId: true,
        },
      }),
      this.prisma.tripStockCheck.findMany({
        where: { trip: { householdId }, checkedAt: { not: null } },
        orderBy: [{ checkedAt: 'desc' }, { itemId: 'desc' }],
        take: LIMIT,
        select: {
          itemId: true,
          history: true,
          item: { select: { id: true, name: true, primaryUnit: true } },
          trip: { select: { id: true, store: true } },
        },
      }),
      this.prisma.locationStockCheck.findMany({
        where: { householdId, checkedAt: { not: null } },
        orderBy: [{ checkedAt: 'desc' }, { itemId: 'desc' }],
        take: LIMIT,
        select: {
          itemId: true,
          history: true,
          item: { select: { id: true, name: true, primaryUnit: true } },
          location: { select: { id: true, name: true } },
        },
      }),
    ]);

    const events: RecentActivityEvent[] = [];
    for (const action of quantityActions) {
      events.push({
        id: `inventory:${action.id}`,
        type: action.type,
        occurredAt: action.createdAt,
        actorId: action.userId,
        item: action.item,
        trip: null,
        location: null,
        quantity: action.quantity.toString(),
        change: null,
        isUndone: action.undo !== null,
        undoneAt: action.undo?.createdAt ?? null,
        reversesEventId: null,
        reversesType: null,
      });
    }
    for (const action of stateActions) {
      events.push({
        id: `state:${action.id}`,
        type: action.type,
        occurredAt: action.createdAt,
        actorId: action.userId,
        item: action.item,
        trip: null,
        location: null,
        quantity: null,
        change: {
          before: {
            currentLevel: action.beforeLevel,
            isPresent: action.beforePresent,
            backupCount: action.beforeBackupCount,
          },
          after: {
            currentLevel: action.afterLevel,
            isPresent: action.afterPresent,
            backupCount: action.afterBackupCount,
          },
        },
        isUndone: action.undo !== null,
        undoneAt: action.undo?.createdAt ?? null,
        reversesEventId: null,
        reversesType: null,
      });
    }
    for (const undo of undos) {
      const original = undo.inventoryAction ?? undo.stateAction;
      if (!original) continue;
      events.push({
        id: `undo:${undo.id}`,
        type: 'UNDO',
        occurredAt: undo.createdAt,
        actorId: undo.userId,
        item: undo.item,
        trip: null,
        location: null,
        quantity: undo.inventoryAction?.quantity.toString() ?? null,
        change: undo.stateAction
          ? {
              before: {
                currentLevel: undo.stateAction.afterLevel,
                isPresent: undo.stateAction.afterPresent,
                backupCount: undo.stateAction.afterBackupCount,
              },
              after: {
                currentLevel: undo.stateAction.beforeLevel,
                isPresent: undo.stateAction.beforePresent,
                backupCount: undo.stateAction.beforeBackupCount,
              },
            }
          : null,
        isUndone: false,
        undoneAt: null,
        reversesEventId: `${undo.inventoryAction ? 'inventory' : 'state'}:${original.id}`,
        reversesType: original.type,
      });
    }
    for (const trip of trips) {
      events.push({
        id: `trip:${trip.id}`,
        type: 'SHOPPING_TRIP_COMPLETED',
        occurredAt: trip.completedAt!,
        actorId: trip.completedByUserId,
        item: null,
        trip: { id: trip.id, store: trip.store },
        location: null,
        quantity: null,
        change: null,
        isUndone: false,
        undoneAt: null,
        reversesEventId: null,
        reversesType: null,
      });
    }
    for (const check of tripChecks) {
      events.push(
        ...correctionEvents(
          check.history,
          `trip-check:${check.trip.id}:${check.itemId}`,
          'TRIP_STOCK_CORRECTED',
          check.item,
          check.trip,
          null,
        ),
      );
    }
    for (const check of locationChecks) {
      events.push(
        ...correctionEvents(
          check.history,
          `location-check:${check.location.id}:${check.itemId}`,
          'LOCATION_STOCK_CORRECTED',
          check.item,
          null,
          check.location,
        ),
      );
    }
    return { items: orderRecentActivity(events) };
  }
}
