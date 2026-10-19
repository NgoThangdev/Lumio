import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryService } from './inventory.service.js';

const editableFields = new Set([
  'name',
  'categoryId',
  'tagIds',
  'preferredRestockLocationId',
]);

type Client = Prisma.TransactionClient;

@Injectable()
export class InventoryItemLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  private async requireAdmin(tx: Client, actorId: string, householdId: string) {
    const membership = await tx.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { role: true },
    });
    if (membership?.role !== 'ADMIN')
      throw new ForbiddenException('HOUSEHOLD_ADMIN_REQUIRED');
  }

  private async lockItem(tx: Client, householdId: string, itemId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "InventoryItem"
      WHERE "id" = ${itemId} AND "householdId" = ${householdId}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new NotFoundException('ITEM_NOT_FOUND');
  }

  async edit(
    actorId: string,
    householdId: string,
    itemId: string,
    body: Record<string, unknown>,
  ) {
    const fields = Object.keys(body);
    if (!fields.length || fields.some((field) => !editableFields.has(field)))
      throw new BadRequestException('INVALID_ITEM_METADATA');
    if (
      'name' in body &&
      (typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.trim().length > 120)
    )
      throw new BadRequestException('INVALID_ITEM_NAME');
    for (const field of ['categoryId', 'preferredRestockLocationId']) {
      if (
        field in body &&
        body[field] !== null &&
        (typeof body[field] !== 'string' || !body[field])
      )
        throw new BadRequestException('INVALID_ITEM_REFERENCE');
    }
    if (
      'tagIds' in body &&
      (!Array.isArray(body.tagIds) ||
        body.tagIds.some((tag: unknown) => typeof tag !== 'string' || !tag) ||
        new Set(body.tagIds).size !== body.tagIds.length)
    )
      throw new BadRequestException('INVALID_TAG_IDS');

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.requireAdmin(tx, actorId, householdId);
        await this.lockItem(tx, householdId, itemId);
        const item = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: itemId },
          include: { tagLinks: { select: { tagId: true } } },
        });
        if (item.archivedAt) throw new ConflictException('ITEM_ARCHIVED');
        if (
          'categoryId' in body &&
          body.categoryId !== null &&
          !(await tx.category.findFirst({
            where: { id: body.categoryId as string, householdId },
            select: { id: true },
          }))
        )
          throw new BadRequestException('CATEGORY_NOT_IN_HOUSEHOLD');
        if (
          'preferredRestockLocationId' in body &&
          body.preferredRestockLocationId !== null &&
          !(await tx.location.findFirst({
            where: {
              id: body.preferredRestockLocationId as string,
              householdId,
            },
            select: { id: true },
          }))
        )
          throw new BadRequestException('LOCATION_NOT_IN_HOUSEHOLD');
        if ('tagIds' in body && (body.tagIds as string[]).length) {
          const tags = body.tagIds as string[];
          const found = await tx.tag.count({
            where: { id: { in: tags }, householdId },
          });
          if (found !== tags.length)
            throw new BadRequestException('TAG_NOT_IN_HOUSEHOLD');
        }
        const before = {
          name: item.name,
          categoryId: item.categoryId,
          tagIds: item.tagLinks.map((link) => link.tagId).sort(),
          preferredRestockLocationId: item.preferredRestockLocationId,
        };
        const after = {
          name: 'name' in body ? (body.name as string).trim() : before.name,
          categoryId:
            'categoryId' in body
              ? (body.categoryId as string | null)
              : before.categoryId,
          tagIds:
            'tagIds' in body
              ? [...(body.tagIds as string[])].sort()
              : before.tagIds,
          preferredRestockLocationId:
            'preferredRestockLocationId' in body
              ? (body.preferredRestockLocationId as string | null)
              : before.preferredRestockLocationId,
        };
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        await tx.inventoryItem.update({
          where: { id: itemId },
          data: {
            name: after.name,
            categoryId: after.categoryId,
            preferredRestockLocationId: after.preferredRestockLocationId,
          },
        });
        if ('tagIds' in body) {
          await tx.inventoryItemTag.deleteMany({ where: { itemId } });
          if (after.tagIds.length)
            await tx.inventoryItemTag.createMany({
              data: after.tagIds.map((tagId) => ({ itemId, tagId })),
            });
        }
        await tx.inventoryItemChange.create({
          data: { householdId, itemId, actorId, kind: 'EDIT', before, after },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw new ConflictException('CATALOG_REFERENCE_CHANGED');
      throw error;
    }
    return this.inventory.readItem({ actorId, householdId, itemId });
  }

  async archive(actorId: string, householdId: string, itemId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(tx, actorId, householdId);
      await this.lockItem(tx, householdId, itemId);
      const item = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { archivedAt: true },
      });
      if (item.archivedAt) return;
      const blockers = await tx.shoppingEntry.findMany({
        where: {
          itemId,
          trip: { householdId, status: { in: ['DRAFT', 'SHOPPING'] } },
        },
        select: { tripId: true },
        orderBy: { tripId: 'asc' },
      });
      if (blockers.length)
        throw new ConflictException({
          code: 'ACTIVE_TRIP_ENTRY',
          tripIds: [...new Set(blockers.map((entry) => entry.tripId))],
        });
      const archivedAt = new Date();
      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { archivedAt },
      });
      await tx.inventoryItemChange.create({
        data: {
          householdId,
          itemId,
          actorId,
          kind: 'ARCHIVE',
          before: { archivedAt: null },
          after: { archivedAt: archivedAt.toISOString() },
        },
      });
    });
    return this.inventory.readItem({ actorId, householdId, itemId });
  }

  async restore(actorId: string, householdId: string, itemId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(tx, actorId, householdId);
      await this.lockItem(tx, householdId, itemId);
      const item = await tx.inventoryItem.findUniqueOrThrow({
        where: { id: itemId },
        select: { archivedAt: true },
      });
      if (!item.archivedAt) return;
      const archivedAt = item.archivedAt.toISOString();
      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { archivedAt: null },
      });
      await tx.inventoryItemChange.create({
        data: {
          householdId,
          itemId,
          actorId,
          kind: 'RESTORE',
          before: { archivedAt },
          after: { archivedAt: null },
        },
      });
    });
    return this.inventory.readItem({ actorId, householdId, itemId });
  }

  async archived(actorId: string, householdId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(tx, actorId, householdId);
      return tx.inventoryItem.findMany({
        where: { householdId, archivedAt: { not: null } },
        select: { id: true, name: true, primaryUnit: true, archivedAt: true },
        orderBy: [{ archivedAt: 'desc' }, { id: 'asc' }],
      });
    });
  }
}
