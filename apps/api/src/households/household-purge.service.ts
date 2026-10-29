import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Transaction = Prisma.TransactionClient;
type JsonObject = { [key: string]: Prisma.JsonValue };

function isObject(value: Prisma.JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectReferences(
  value: Prisma.JsonValue,
  needles: Set<string>,
  path: string[] = [],
  matches: Array<{ value: string; path: string[] }> = [],
) {
  if (typeof value === 'string') {
    if ([...needles].some((needle) => value.includes(needle)))
      matches.push({ value, path });
    return matches;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectReferences(entry, needles, [...path, String(index)], matches),
    );
    return matches;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if ([...needles].some((needle) => key.includes(needle)))
        matches.push({ value: key, path: [...path, key] });
      collectReferences(child, needles, [...path, key], matches);
    }
  }
  return matches;
}

@Injectable()
export class HouseholdPurgeService {
  constructor(private readonly prisma: PrismaService) {}

  async findDueScheduledDeletions(
    activationCutoff: Date | null,
    limit: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('INVALID_HOUSEHOLD_PURGE_BATCH_SIZE');
    return this.prisma.$queryRaw<
      Array<{
        householdId: string;
        requestId: string;
        requestedAt: Date;
        dueAt: Date;
      }>
    >`
      SELECT "id" AS "householdId",
             "deletionRequestId" AS "requestId",
             "deletionRequestedAt" AS "requestedAt",
             "deletionDueAt" AS "dueAt"
      FROM "Household"
      WHERE "deletionRequestId" IS NOT NULL
        AND "deletionDueAt" <= CURRENT_TIMESTAMP
        AND (${activationCutoff}::timestamptz IS NULL
          OR "deletionRequestedAt" >= ${activationCutoff})
      ORDER BY "deletionDueAt" ASC, "id" ASC
      LIMIT ${limit}
    `;
  }

  private requireExplicitIds(householdId: string, requestId: string) {
    if (
      typeof householdId !== 'string' ||
      !householdId.trim() ||
      typeof requestId !== 'string' ||
      !requestId.trim()
    )
      throw new BadRequestException('HOUSEHOLD_PURGE_IDS_REQUIRED');
  }

  /** Read-only internal preflight. No controller exposes this operation. */
  async dryRunScheduledDeletion(
    householdId: string,
    requestId: string,
    activationCutoff: Date | null = null,
  ) {
    this.requireExplicitIds(householdId, requestId);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          deletionRequestId: string | null;
          deletionRequestedAt: Date | null;
          deletionDueAt: Date | null;
        }>
      >`
        SELECT "deletionRequestId", "deletionRequestedAt", "deletionDueAt"
        FROM "Household" WHERE "id" = ${householdId} FOR SHARE
      `;
      const state = rows[0];
      if (!state) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
      if (state.deletionRequestId !== requestId || !state.deletionDueAt)
        return {
          householdId,
          requestId,
          due: false,
          eligible: false,
          reason: 'HOUSEHOLD_DELETION_REQUEST_STALE',
          dueAt: state.deletionDueAt,
        };
      if (
        activationCutoff &&
        (!state.deletionRequestedAt ||
          state.deletionRequestedAt < activationCutoff)
      )
        return {
          householdId,
          requestId,
          due: state.deletionDueAt.getTime() <= Date.now(),
          eligible: false,
          reason: 'HOUSEHOLD_DELETION_BEFORE_ACTIVATION_CUTOFF',
          dueAt: state.deletionDueAt,
        };
      const due = state.deletionDueAt.getTime() <= Date.now();
      return {
        householdId,
        requestId,
        due,
        eligible: due,
        reason: due ? null : 'HOUSEHOLD_DELETION_NOT_DUE',
        dueAt: state.deletionDueAt,
      };
    });
  }

  /** Explicit internal execution boundary; callers must supply both IDs. */
  async executeScheduledDeletion(
    householdId: string,
    requestId: string,
    activationCutoff: Date,
  ) {
    this.requireExplicitIds(householdId, requestId);
    if (
      !(activationCutoff instanceof Date) ||
      Number.isNaN(activationCutoff.getTime())
    )
      throw new BadRequestException(
        'INVALID_HOUSEHOLD_PURGE_ACTIVATION_CUTOFF',
      );
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          deletionRequestId: string | null;
          deletionRequestedAt: Date | null;
          deletionDueAt: Date | null;
        }>
      >`
        SELECT "deletionRequestId", "deletionRequestedAt", "deletionDueAt"
        FROM "Household" WHERE "id" = ${householdId} FOR UPDATE
      `;
      const state = rows[0];
      if (!state) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
      if (state.deletionRequestId !== requestId || !state.deletionDueAt)
        throw new ConflictException({
          code: 'HOUSEHOLD_DELETION_REQUEST_STALE',
        });
      if (
        !state.deletionRequestedAt ||
        state.deletionRequestedAt < activationCutoff
      )
        throw new ConflictException({
          code: 'HOUSEHOLD_DELETION_BEFORE_ACTIVATION_CUTOFF',
        });
      const purgedAt = new Date();
      if (state.deletionDueAt.getTime() > purgedAt.getTime())
        throw new ConflictException({
          code: 'HOUSEHOLD_DELETION_NOT_DUE',
          dueAt: state.deletionDueAt,
        });
      await this.purge(tx, householdId);
      return { purged: true, householdId, requestId, purgedAt };
    });
  }

  /** Must be called inside the caller's transaction after Household FOR UPDATE. */
  async purge(tx: Transaction, householdId: string) {
    const items = await tx.inventoryItem.findMany({
      where: { householdId },
      select: { id: true },
    });
    const itemIds = items.map(({ id }) => id);
    await this.purgeNotificationReferences(tx, householdId, itemIds);

    await tx.locationStockCheck.deleteMany({ where: { householdId } });
    await tx.tripStockCheck.deleteMany({
      where: { trip: { householdId } },
    });
    await tx.shoppingEntry.deleteMany({
      where: { trip: { householdId } },
    });
    await tx.householdInvitation.deleteMany({ where: { householdId } });
    await tx.inventoryUndo.deleteMany({ where: { householdId } });
    await tx.openTransfer.deleteMany({
      where: { action: { householdId } },
    });
    await tx.actionBatchAllocation.deleteMany({
      where: { action: { householdId } },
    });
    await tx.inventoryItemChange.deleteMany({ where: { householdId } });
    await tx.inventoryAction.deleteMany({ where: { householdId } });
    await tx.inventoryStateAction.deleteMany({ where: { householdId } });
    await tx.inventoryItemTag.deleteMany({
      where: { item: { householdId } },
    });
    await tx.stockBatch.deleteMany({ where: { item: { householdId } } });
    await tx.inventoryItem.deleteMany({ where: { householdId } });
    await tx.shoppingTrip.deleteMany({ where: { householdId } });
    await tx.category.deleteMany({ where: { householdId } });
    await tx.location.deleteMany({ where: { householdId } });
    await tx.tag.deleteMany({ where: { householdId } });
    await tx.membership.deleteMany({ where: { householdId } });
    await tx.household.delete({ where: { id: householdId } });
  }

  private async purgeNotificationReferences(
    tx: Transaction,
    householdId: string,
    itemIds: string[],
  ) {
    const itemCandidates = itemIds.map(
      (id) => Prisma.sql`i."content"::text LIKE ${`%${id}%`}`,
    );
    const itemCandidateClause = itemIds.length
      ? Prisma.sql`
          OR i."itemId" IN (${Prisma.join(itemIds)})
          OR (${Prisma.join(itemCandidates, ' OR ')})
        `
      : Prisma.empty;
    const intents = await tx.$queryRaw<
      Array<{
        id: string;
        userId: string;
        householdId: string | null;
        itemId: string | null;
        content: Prisma.JsonValue;
      }>
    >`
      SELECT i."id", i."userId", i."householdId", i."itemId", i."content"
      FROM "NotificationIntent" i
      WHERE i."householdId" = ${householdId}
        OR i."content"::text LIKE ${`%${householdId}%`}
        ${itemCandidateClause}
      ORDER BY i."id" FOR UPDATE
    `;
    const removeIds: string[] = [];
    const updates: Array<{ id: string; content: Prisma.InputJsonValue }> = [];
    const targetIds = new Set([householdId, ...itemIds]);

    for (const intent of intents) {
      if (intent.householdId === householdId) {
        removeIds.push(intent.id);
        continue;
      }
      const matches = collectReferences(intent.content, targetIds);
      if (!matches.length && !itemIds.includes(intent.itemId ?? '')) continue;

      const content = intent.content;
      if (!isObject(content) || !Array.isArray(content.households))
        throw new ConflictException({
          code: 'HOUSEHOLD_PURGE_UNSUPPORTED_NOTIFICATION_REFERENCE',
        });
      const groups = content.households;
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const group = groups[groupIndex];
        if (
          !isObject(group) ||
          typeof group.householdId !== 'string' ||
          !Array.isArray(group.items)
        )
          throw new ConflictException({
            code: 'HOUSEHOLD_PURGE_UNSUPPORTED_NOTIFICATION_REFERENCE',
          });
        for (
          let itemIndex = 0;
          itemIndex < group.items.length;
          itemIndex += 1
        ) {
          const item = group.items[itemIndex];
          if (!isObject(item) || typeof item.itemId !== 'string')
            throw new ConflictException({
              code: 'HOUSEHOLD_PURGE_UNSUPPORTED_NOTIFICATION_REFERENCE',
            });
          if (
            group.householdId !== householdId &&
            itemIds.includes(item.itemId)
          )
            throw new ConflictException({
              code: 'HOUSEHOLD_PURGE_UNSUPPORTED_NOTIFICATION_REFERENCE',
            });
        }
      }

      const unsupported = matches.some(({ value, path }) => {
        const groupIndex = Number(path[1]);
        const itemIndex = Number(path[3]);
        if (
          path.length === 3 &&
          path[0] === 'households' &&
          Number.isInteger(groupIndex) &&
          path[2] === 'householdId' &&
          value === householdId
        )
          return false;
        if (
          path.length === 5 &&
          path[0] === 'households' &&
          Number.isInteger(groupIndex) &&
          path[2] === 'items' &&
          Number.isInteger(itemIndex) &&
          path[4] === 'itemId' &&
          groups[groupIndex] &&
          isObject(groups[groupIndex]) &&
          groups[groupIndex].householdId === householdId &&
          itemIds.includes(value)
        )
          return false;
        return true;
      });
      if (unsupported || (intent.itemId && itemIds.includes(intent.itemId)))
        throw new ConflictException({
          code: 'HOUSEHOLD_PURGE_UNSUPPORTED_NOTIFICATION_REFERENCE',
        });

      const remainingGroups = groups.filter(
        (group) => isObject(group) && group.householdId !== householdId,
      );
      const remainingHouseholdIds = remainingGroups.map(
        (group) => (group as JsonObject).householdId as string,
      );
      const validMemberships = remainingHouseholdIds.length
        ? await tx.membership.findMany({
            where: {
              userId: intent.userId,
              householdId: { in: remainingHouseholdIds },
              household: { deletionRequestId: null },
            },
            select: { householdId: true },
          })
        : [];
      const validIds = new Set(
        validMemberships.map(({ householdId: id }) => id),
      );
      const validGroups = remainingGroups.filter(
        (group) => isObject(group) && validIds.has(group.householdId as string),
      );
      if (!validGroups.length) {
        removeIds.push(intent.id);
        continue;
      }
      updates.push({
        id: intent.id,
        content: {
          ...content,
          households: validGroups,
        } as Prisma.InputJsonValue,
      });
    }

    if (removeIds.length) {
      await tx.notificationDelivery.deleteMany({
        where: { intentId: { in: removeIds } },
      });
      await tx.notificationIntent.deleteMany({
        where: { id: { in: removeIds } },
      });
    }
    for (const update of updates)
      await tx.notificationIntent.update({
        where: { id: update.id },
        data: { content: update.content },
      });
  }
}
