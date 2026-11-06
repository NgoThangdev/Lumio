import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  checkActiveHousehold,
  requireActiveHousehold,
} from '../households/active-household.js';
import {
  hasNumericDefaults,
  parseDefaultUpdate,
  resolveQuantityDefaults,
  validateThresholdOrder,
} from './inventory-defaults.js';

export type CatalogKind = 'categories' | 'locations' | 'tags';

const shoppingSections = [
  'FRESH_FOOD',
  'MEAT_SEAFOOD',
  'DAIRY',
  'PANTRY',
  'DRINKS',
  'HOUSEHOLD',
  'PERSONAL_CARE',
] as const;

function sectionUpdate(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('INVALID_SHOPPING_SECTION');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || !('shoppingSection' in body))
    throw new BadRequestException('INVALID_SHOPPING_SECTION');
  const section = body.shoppingSection;
  if (
    section !== null &&
    !shoppingSections.includes(section as (typeof shoppingSections)[number])
  )
    throw new BadRequestException('INVALID_SHOPPING_SECTION');
  return section as (typeof shoppingSections)[number] | null;
}

const categorySelect = {
  id: true,
  name: true,
  shoppingSection: true,
  defaultTrackingMode: true,
  defaultPrimaryUnit: true,
  defaultLowStockThreshold: true,
  defaultBuyThreshold: true,
  defaultTargetStock: true,
  defaultSafetyBuffer: true,
  defaultExpiryReminderDays: true,
} as const;

function catalogName(value: unknown) {
  if (typeof value !== 'string')
    throw new BadRequestException('Name is required.');
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80)
    throw new BadRequestException('Name must be 1 to 80 characters.');
  return { name, nameKey: name.toLocaleLowerCase('en-US') };
}

function renameInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('INVALID_CATALOG_NAME');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || !('name' in body))
    throw new BadRequestException('INVALID_CATALOG_NAME');
  return catalogName(body.name);
}

function isPrismaError(error: unknown, code: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function inUse(
  code: 'CATEGORY_IN_USE' | 'LOCATION_IN_USE',
  references: Record<string, number>,
) {
  return new ConflictException({ code, references });
}

function hasReferences(references: Record<string, number>) {
  return Object.values(references).some((count) => count > 0);
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(
    actorId: string,
    householdId: string,
    admin: boolean,
  ) {
    await checkActiveHousehold(
      this.prisma,
      actorId,
      householdId,
      admin ? 'ADMIN' : 'MEMBER',
    );
    const membership = await this.prisma.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { role: true },
    });
    if (!membership || (admin && membership.role !== 'ADMIN')) {
      throw new ForbiddenException(
        admin
          ? 'Household Admin membership is required to manage catalog options.'
          : 'Household membership is required to view catalog options.',
      );
    }
  }

  private withActive<T>(
    actorId: string,
    householdId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await requireActiveHousehold(tx, actorId, householdId, 'ADMIN');
      return work(tx);
    });
  }

  async list(actorId: string, householdId: string, kind: CatalogKind) {
    return this.prisma.$transaction(async (tx) => {
      await requireActiveHousehold(tx, actorId, householdId);
      if (kind === 'categories')
        return tx.category.findMany({
          where: { householdId },
          select: categorySelect,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
      const query = {
        where: { householdId },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }],
      };
      if (kind === 'locations') return tx.location.findMany(query);
      return tx.tag.findMany(query);
    });
  }

  async create(
    actorId: string,
    householdId: string,
    kind: CatalogKind,
    inputName: unknown,
  ) {
    const parsed = catalogName(inputName);
    await this.requireMembership(actorId, householdId, true);
    const data = { householdId, ...parsed };
    try {
      return await this.withActive(actorId, householdId, async (tx) => {
        if (kind === 'categories')
          return tx.category.create({
            data,
            select: categorySelect,
          });
        if (kind === 'locations')
          return tx.location.create({
            data,
            select: { id: true, name: true },
          });
        return tx.tag.create({
          data,
          select: { id: true, name: true },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A catalog option with this name already exists in the household.',
        );
      }
      throw error;
    }
  }

  async updateCategorySection(
    actorId: string,
    householdId: string,
    categoryId: string,
    input: unknown,
  ) {
    await this.requireMembership(actorId, householdId, true);
    const shoppingSection = sectionUpdate(input);
    try {
      return await this.withActive(actorId, householdId, (tx) =>
        tx.category.update({
          where: { id: categoryId, householdId },
          data: { shoppingSection },
          select: categorySelect,
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw new NotFoundException('CATEGORY_NOT_FOUND');
      throw error;
    }
  }

  async updateCategoryInventoryDefaults(
    actorId: string,
    householdId: string,
    categoryId: string,
    input: unknown,
  ) {
    await this.requireMembership(actorId, householdId, true);
    const data = parseDefaultUpdate(input);
    try {
      return await this.withActive(actorId, householdId, async (tx) => {
        const current = await tx.category.findFirst({
          where: { id: categoryId, householdId },
          select: categorySelect,
        });
        if (!current) throw new NotFoundException('CATEGORY_NOT_FOUND');
        const next = { ...current, ...data };
        validateThresholdOrder(next);
        if (
          hasNumericDefaults(current) &&
          hasNumericDefaults(next) &&
          (next.defaultTrackingMode !== current.defaultTrackingMode ||
            next.defaultPrimaryUnit !== current.defaultPrimaryUnit)
        )
          throw new BadRequestException('DEFAULT_THRESHOLDS_REQUIRE_REVIEW');
        const household = await tx.household.findUniqueOrThrow({
          where: { id: householdId },
          select: {
            defaultTrackingMode: true,
            defaultPrimaryUnit: true,
            defaultLowStockThreshold: true,
            defaultBuyThreshold: true,
            defaultTargetStock: true,
            defaultSafetyBuffer: true,
            defaultExpiryReminderDays: true,
          },
        });
        const mode = next.defaultTrackingMode ?? household.defaultTrackingMode;
        const unit = next.defaultPrimaryUnit ?? household.defaultPrimaryUnit;
        if (hasNumericDefaults(next) && (mode !== 'QUANTITY' || !unit))
          throw new BadRequestException(
            'DEFAULT_THRESHOLDS_REQUIRE_QUANTITY_UNIT',
          );
        if (mode && unit) resolveQuantityDefaults(mode, unit, household, next);
        return tx.category.update({
          where: { id: categoryId, householdId },
          data,
          select: categorySelect,
        });
      });
    } catch (error) {
      if (isPrismaError(error, 'P2025'))
        throw new NotFoundException('CATEGORY_NOT_FOUND');
      throw error;
    }
  }

  async updateCategory(
    actorId: string,
    householdId: string,
    categoryId: string,
    input: unknown,
  ) {
    if (
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      'name' in input
    )
      return this.renameCategory(actorId, householdId, categoryId, input);
    return this.updateCategorySection(actorId, householdId, categoryId, input);
  }

  async renameCategory(
    actorId: string,
    householdId: string,
    categoryId: string,
    input: unknown,
  ) {
    await this.requireMembership(actorId, householdId, true);
    const parsed = renameInput(input);
    return this.withActive(actorId, householdId, async (tx) => {
      const existing = await tx.category.findFirst({
        where: { id: categoryId, householdId },
        select: categorySelect,
      });
      if (!existing) throw new NotFoundException('CATEGORY_NOT_FOUND');
      if (existing.name === parsed.name) return existing;
      try {
        return await tx.category.update({
          where: { id: categoryId, householdId },
          data: parsed,
          select: categorySelect,
        });
      } catch (error) {
        if (isPrismaError(error, 'P2002'))
          throw new ConflictException('CATALOG_NAME_EXISTS');
        if (isPrismaError(error, 'P2025'))
          throw new NotFoundException('CATEGORY_NOT_FOUND');
        throw error;
      }
    });
  }

  async renameLocation(
    actorId: string,
    householdId: string,
    locationId: string,
    input: unknown,
  ) {
    await this.requireMembership(actorId, householdId, true);
    const parsed = renameInput(input);
    return this.withActive(actorId, householdId, async (tx) => {
      const existing = await tx.location.findFirst({
        where: { id: locationId, householdId },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundException('LOCATION_NOT_FOUND');
      if (existing.name === parsed.name) return existing;
      try {
        return await tx.location.update({
          where: { id: locationId, householdId },
          data: parsed,
          select: { id: true, name: true },
        });
      } catch (error) {
        if (isPrismaError(error, 'P2002'))
          throw new ConflictException('CATALOG_NAME_EXISTS');
        if (isPrismaError(error, 'P2025'))
          throw new NotFoundException('LOCATION_NOT_FOUND');
        throw error;
      }
    });
  }

  async renameTag(
    actorId: string,
    householdId: string,
    tagId: string,
    input: unknown,
  ) {
    await this.requireMembership(actorId, householdId, true);
    const parsed = renameInput(input);
    return this.withActive(actorId, householdId, async (tx) => {
      const existing = await tx.tag.findFirst({
        where: { id: tagId, householdId },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundException('TAG_NOT_FOUND');
      if (existing.name === parsed.name) return existing;
      try {
        return await tx.tag.update({
          where: { id: tagId, householdId },
          data: parsed,
          select: { id: true, name: true },
        });
      } catch (error) {
        if (isPrismaError(error, 'P2002'))
          throw new ConflictException('CATALOG_NAME_EXISTS');
        if (isPrismaError(error, 'P2025'))
          throw new NotFoundException('TAG_NOT_FOUND');
        throw error;
      }
    });
  }

  private async categoryReferences(
    tx: Prisma.TransactionClient,
    householdId: string,
    categoryId: string,
  ) {
    const [activeItems, archivedItems, history] = await Promise.all([
      tx.inventoryItem.count({
        where: { householdId, categoryId, archivedAt: null },
      }),
      tx.inventoryItem.count({
        where: { householdId, categoryId, archivedAt: { not: null } },
      }),
      tx.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS "count" FROM "InventoryItemChange"
        WHERE "householdId" = ${householdId}
          AND ("before"->>'categoryId' = ${categoryId} OR "after"->>'categoryId' = ${categoryId})
      `,
    ]);
    return { activeItems, archivedItems, itemChanges: history[0]?.count ?? 0 };
  }

  private async locationReferences(
    tx: Prisma.TransactionClient,
    householdId: string,
    locationId: string,
  ) {
    const [
      currentItems,
      backupItems,
      preferredItems,
      batches,
      shoppingEntries,
      stockChecks,
      history,
    ] = await Promise.all([
      tx.inventoryItem.count({
        where: { householdId, currentLocationId: locationId },
      }),
      tx.inventoryItem.count({
        where: { householdId, backupLocationId: locationId },
      }),
      tx.inventoryItem.count({
        where: { householdId, preferredRestockLocationId: locationId },
      }),
      tx.stockBatch.count({ where: { locationId, item: { householdId } } }),
      tx.shoppingEntry.count({ where: { locationId, trip: { householdId } } }),
      tx.locationStockCheck.count({ where: { locationId, householdId } }),
      tx.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS "count" FROM "InventoryItemChange"
          WHERE "householdId" = ${householdId}
            AND ("before"->>'preferredRestockLocationId' = ${locationId}
              OR "after"->>'preferredRestockLocationId' = ${locationId})
        `,
    ]);
    return {
      currentItems,
      backupItems,
      preferredItems,
      batches,
      shoppingEntries,
      stockChecks,
      itemChanges: history[0]?.count ?? 0,
    };
  }

  async removeCategory(
    actorId: string,
    householdId: string,
    categoryId: string,
  ) {
    await this.requireMembership(actorId, householdId, true);
    try {
      await this.prisma.$transaction(async (tx) => {
        await requireActiveHousehold(tx, actorId, householdId, 'ADMIN');
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Category" WHERE "id" = ${categoryId}
            AND "householdId" = ${householdId} FOR UPDATE
        `;
        if (!locked.length) throw new NotFoundException('CATEGORY_NOT_FOUND');
        const references = await this.categoryReferences(
          tx,
          householdId,
          categoryId,
        );
        if (hasReferences(references))
          throw inUse('CATEGORY_IN_USE', references);
        await tx.category.delete({ where: { id: categoryId, householdId } });
      });
    } catch (error) {
      if (isPrismaError(error, 'P2003')) {
        const references = await this.prisma.$transaction(async (tx) => {
          await requireActiveHousehold(tx, actorId, householdId, 'ADMIN');
          return this.categoryReferences(tx, householdId, categoryId);
        });
        throw inUse('CATEGORY_IN_USE', references);
      }
      throw error;
    }
  }

  async removeLocation(
    actorId: string,
    householdId: string,
    locationId: string,
  ) {
    await this.requireMembership(actorId, householdId, true);
    try {
      await this.prisma.$transaction(async (tx) => {
        await requireActiveHousehold(tx, actorId, householdId, 'ADMIN');
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Location" WHERE "id" = ${locationId}
            AND "householdId" = ${householdId} FOR UPDATE
        `;
        if (!locked.length) throw new NotFoundException('LOCATION_NOT_FOUND');
        const references = await this.locationReferences(
          tx,
          householdId,
          locationId,
        );
        if (hasReferences(references))
          throw inUse('LOCATION_IN_USE', references);
        await tx.location.delete({ where: { id: locationId, householdId } });
      });
    } catch (error) {
      if (isPrismaError(error, 'P2003')) {
        const references = await this.prisma.$transaction(async (tx) => {
          await requireActiveHousehold(tx, actorId, householdId, 'ADMIN');
          return this.locationReferences(tx, householdId, locationId);
        });
        throw inUse('LOCATION_IN_USE', references);
      }
      throw error;
    }
  }
}
