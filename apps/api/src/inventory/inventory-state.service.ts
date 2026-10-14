import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, StockLevel } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { undoEligibility } from './undo-eligibility.js';

export const LEVELS: StockLevel[] = [
  'EMPTY',
  'QUARTER',
  'HALF',
  'THREE_QUARTERS',
  'FULL',
];

type StateCommand =
  | { type: 'UPDATE_LEVEL'; level: unknown }
  | { type: 'ADD_BACKUP'; count: unknown }
  | { type: 'OPEN_REFILL' }
  | { type: 'SET_PRESENCE'; present: unknown };

export function parseBackupCount(value: unknown): number {
  const count =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (
    !Number.isInteger(count) ||
    (count as number) <= 0 ||
    (count as number) > 2147483647
  ) {
    throw new BadRequestException(
      'Backup count must be a positive 32-bit integer.',
    );
  }
  return count as number;
}

@Injectable()
export class InventoryStateService {
  constructor(private readonly prisma: PrismaService) {}

  async configure(
    actorId: string,
    householdId: string,
    itemId: string,
    lowAtLevel: unknown,
    buyAtLevel: unknown,
    neverRunOut: unknown,
  ) {
    if (
      !LEVELS.includes(lowAtLevel as StockLevel) ||
      !LEVELS.includes(buyAtLevel as StockLevel)
    ) {
      throw new BadRequestException(
        'Thresholds must be one of the five stock levels.',
      );
    }
    if (
      LEVELS.indexOf(buyAtLevel as StockLevel) >
      LEVELS.indexOf(lowAtLevel as StockLevel)
    ) {
      throw new BadRequestException('Buy level must be at or below low level.');
    }
    if (typeof neverRunOut !== 'boolean') {
      throw new BadRequestException('Never-run-out must be true or false.');
    }
    const membership = await this.prisma.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { role: true },
    });
    if (membership?.role !== 'ADMIN')
      throw new ForbiddenException(
        'Household Admin membership is required to change stock settings.',
      );
    const updated = await this.prisma.inventoryItem.updateMany({
      where: { id: itemId, householdId, trackingMode: 'FIVE_LEVEL' },
      data: {
        lowAtLevel: lowAtLevel as StockLevel,
        buyAtLevel: buyAtLevel as StockLevel,
        neverRunOut,
      },
    });
    if (updated.count !== 1)
      throw new NotFoundException(
        'Five-level item was not found in this household.',
      );
    return this.prisma.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
    });
  }

  async transition(
    actorId: string,
    householdId: string,
    itemId: string,
    command: StateCommand,
  ) {
    return this.prisma.$transaction((tx) =>
      this.transitionInTransaction(tx, actorId, householdId, itemId, command),
    );
  }

  async transitionInTransaction(
    tx: Prisma.TransactionClient,
    actorId: string,
    householdId: string,
    itemId: string,
    command: StateCommand,
  ) {
    if (
      command.type === 'UPDATE_LEVEL' &&
      !LEVELS.includes(command.level as StockLevel)
    ) {
      throw new BadRequestException(
        'Level must be FULL, THREE_QUARTERS, HALF, QUARTER, or EMPTY.',
      );
    }
    const backupToAdd =
      command.type === 'ADD_BACKUP' ? parseBackupCount(command.count) : 0;
    if (
      command.type === 'SET_PRESENCE' &&
      typeof command.present !== 'boolean'
    ) {
      throw new BadRequestException('Presence must be true or false.');
    }
    const membership = await tx.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!membership)
      throw new ForbiddenException(
        'Household membership is required for stock actions.',
      );
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "InventoryItem"
        WHERE "id" = ${itemId} AND "householdId" = ${householdId}
        FOR UPDATE
      `;
    if (locked.length !== 1)
      throw new NotFoundException(
        'Inventory item was not found in this household.',
      );
    const item = await tx.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    if (item.trackingMode === 'QUANTITY')
      throw new BadRequestException(
        'State actions require five-level or presence/backup tracking.',
      );
    const before = {
      beforeLevel: item.currentLevel,
      beforePresent: item.isPresent,
      beforeBackupCount: item.backupCount,
    };
    let currentLevel = item.currentLevel;
    let isPresent = item.isPresent;
    let backupCount = item.backupCount;
    if (command.type === 'UPDATE_LEVEL') {
      if (item.trackingMode !== 'FIVE_LEVEL')
        throw new BadRequestException(
          'Level updates require five-level tracking.',
        );
      currentLevel = command.level as StockLevel;
    } else if (command.type === 'SET_PRESENCE') {
      if (item.trackingMode !== 'PRESENCE_BACKUP')
        throw new BadRequestException(
          'Presence updates require presence/backup tracking.',
        );
      isPresent = command.present as boolean;
    } else if (command.type === 'ADD_BACKUP') {
      backupCount += backupToAdd;
      if (backupCount > 2147483647)
        throw new BadRequestException(
          'Backup count exceeds the supported maximum.',
        );
    } else {
      if (item.trackingMode === 'FIVE_LEVEL') {
        if (currentLevel !== 'EMPTY' || backupCount < 1)
          throw new ConflictException(
            'Open refill requires an Empty current container and available backup.',
          );
        currentLevel = 'FULL';
      } else {
        if (isPresent || backupCount < 1)
          throw new ConflictException(
            'Open backup requires no current item and available backup.',
          );
        isPresent = true;
      }
      backupCount -= 1;
    }
    if (
      currentLevel === item.currentLevel &&
      isPresent === item.isPresent &&
      backupCount === item.backupCount
    ) {
      throw new ConflictException('This action would not change stock state.');
    }
    const updated = await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        currentLevel,
        isPresent,
        backupCount,
        stockRevision: { increment: 1 },
      },
    });
    const canUndo =
      command.type === 'UPDATE_LEVEL' || command.type === 'SET_PRESENCE';
    const action = await tx.inventoryStateAction.create({
      data: {
        householdId,
        itemId,
        userId: actorId,
        type: command.type,
        ...before,
        afterLevel: currentLevel,
        afterPresent: isPresent,
        afterBackupCount: backupCount,
        postStockRevision: canUndo ? updated.stockRevision : null,
      },
    });
    return {
      item: updated,
      action,
      undoEligibility: undoEligibility(action.createdAt, canUndo),
    };
  }
}
