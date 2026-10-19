import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/browser.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockIntelligenceService } from './stock-intelligence.service.js';
import { withOpenedStock } from './inventory.service.js';

type Assessment = Awaited<
  ReturnType<StockIntelligenceService['assessHousehold']>
>['assessments'][number];

export interface InventoryReadQuery {
  q?: unknown;
  categoryId?: unknown;
  locationId?: unknown;
  tagId?: unknown;
  status?: unknown;
  groupBy?: unknown;
}

const STATUSES = [
  'ALL',
  'LOW',
  'BUY',
  'OUT',
  'OK',
  'EXPIRING',
  'OPENED',
] as const;
type StatusFilter = (typeof STATUSES)[number];
type GroupBy = 'none' | 'category' | 'location';

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function parseQuery(query: InventoryReadQuery) {
  const keys = Object.keys(query);
  if (
    keys.some(
      (key) =>
        ![
          'q',
          'categoryId',
          'locationId',
          'tagId',
          'status',
          'groupBy',
        ].includes(key),
    )
  ) {
    throw new BadRequestException('Unsupported inventory filter.');
  }
  const q = optionalString(query.q, 'Search')?.toLocaleLowerCase('en-US');
  const categoryId = optionalString(query.categoryId, 'Category ID');
  const locationId = optionalString(query.locationId, 'Location ID');
  const tagId = optionalString(query.tagId, 'Tag ID');
  const status = optionalString(query.status, 'Status') ?? 'ALL';
  if (!STATUSES.includes(status as StatusFilter)) {
    throw new BadRequestException(
      'Status must be ALL, LOW, BUY, OUT, OK, EXPIRING, or OPENED.',
    );
  }
  const groupBy = optionalString(query.groupBy, 'Group by') ?? 'none';
  if (!['none', 'category', 'location'].includes(groupBy)) {
    throw new BadRequestException(
      'Group by must be none, category, or location.',
    );
  }
  return {
    q,
    categoryId,
    locationId,
    tagId,
    status: status as StatusFilter,
    groupBy: groupBy as GroupBy,
  };
}

function statusMatches(assessment: Assessment, status: StatusFilter) {
  if (status === 'ALL') return true;
  if (status === 'OPENED') return true;
  if (status === 'EXPIRING') return assessment.expiryRisk === 'USE_SOON';
  if (status === 'LOW')
    return ['LOW', 'BUY', 'OUT'].includes(assessment.lowStockRisk);
  return assessment.lowStockRisk === status;
}

function hasLocation(item: ItemRow, locationId: string) {
  if (item.trackingMode === 'QUANTITY') {
    return item.batches.some(
      (batch) => batch.locationId === locationId && batch.quantity.gt(0),
    );
  }
  return (
    item.currentLocationId === locationId ||
    item.backupLocationId === locationId
  );
}

type ItemRow = Awaited<ReturnType<InventoryReadService['loadItems']>>[number];

@Injectable()
export class InventoryReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intelligence: StockIntelligenceService,
  ) {}

  private loadItems(householdId: string) {
    return this.prisma.inventoryItem.findMany({
      where: { householdId, archivedAt: null },
      include: {
        category: { select: { id: true, name: true } },
        currentLocation: { select: { id: true, name: true } },
        backupLocation: { select: { id: true, name: true } },
        preferredRestockLocation: { select: { id: true, name: true } },
        tagLinks: { include: { tag: { select: { id: true, name: true } } } },
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
  }

  async inventory(
    actorId: string,
    householdId: string,
    input: InventoryReadQuery,
  ) {
    const query = parseQuery(input);
    const intelligence = await this.intelligence.assessHousehold(
      actorId,
      householdId,
    );
    const assessments = new Map(
      intelligence.assessments.map((assessment) => [
        assessment.itemId,
        assessment,
      ]),
    );
    const items = await this.loadItems(householdId);
    const filtered = items.filter((item) => {
      const assessment = assessments.get(item.id);
      return (
        assessment !== undefined &&
        (!query.q || item.name.toLocaleLowerCase('en-US').includes(query.q)) &&
        (!query.categoryId || item.categoryId === query.categoryId) &&
        (!query.tagId ||
          item.tagLinks.some((link) => link.tagId === query.tagId)) &&
        (!query.locationId || hasLocation(item, query.locationId)) &&
        (query.status !== 'OPENED' ||
          item.batches.some(
            (batch) => batch.openedAt !== null && batch.quantity.gt(0),
          )) &&
        statusMatches(assessment, query.status)
      );
    });
    const result = {
      items: filtered.map((item) => ({
        item: withOpenedStock(item),
        assessment: assessments.get(item.id)!,
      })),
      ...(query.groupBy === 'none'
        ? {}
        : {
            groups: await this.groups(
              householdId,
              filtered,
              assessments,
              query.groupBy,
              query.locationId,
            ),
          }),
    };
    return result;
  }

  private async groups(
    householdId: string,
    items: ItemRow[],
    assessments: Map<string, Assessment>,
    groupBy: Exclude<GroupBy, 'none'>,
    locationFilter?: string,
  ) {
    const names =
      groupBy === 'location'
        ? new Map(
            (
              await this.prisma.location.findMany({
                where: { householdId },
                select: { id: true, name: true },
              })
            ).map((location) => [location.id, location.name]),
          )
        : new Map<string, string>();
    const groups = new Map<
      string | null,
      {
        id: string | null;
        name: string;
        entries: Array<Record<string, unknown>>;
      }
    >();
    const add = (
      id: string | null,
      name: string,
      entry: Record<string, unknown>,
    ) => {
      let group = groups.get(id);
      if (!group) {
        group = { id, name, entries: [] };
        groups.set(id, group);
      }
      group.entries.push(entry);
    };
    for (const item of items) {
      const assessment = assessments.get(item.id)!;
      const base = {
        itemId: item.id,
        name: item.name,
        primaryUnit: item.primaryUnit,
        trackingMode: item.trackingMode,
        lowStockRisk: assessment.lowStockRisk,
        expiryRisk: assessment.expiryRisk,
      };
      if (groupBy === 'category') {
        add(item.categoryId, item.category?.name ?? 'Uncategorized', {
          ...base,
          quantity:
            item.trackingMode === 'QUANTITY' ? assessment.physicalStock : null,
          currentLevel: item.currentLevel,
          isPresent: item.isPresent,
          backupCount: item.backupCount,
        });
        continue;
      }
      if (item.trackingMode === 'QUANTITY') {
        const subtotals = new Map<
          string | null,
          InstanceType<typeof Prisma.Decimal>
        >();
        for (const batch of item.batches) {
          if (batch.quantity.lte(0)) continue;
          if (locationFilter && batch.locationId !== locationFilter) continue;
          subtotals.set(
            batch.locationId,
            (subtotals.get(batch.locationId) ?? new Prisma.Decimal(0)).plus(
              batch.quantity,
            ),
          );
        }
        if (subtotals.size === 0) subtotals.set(null, new Prisma.Decimal(0));
        for (const [locationId, quantity] of subtotals) {
          add(
            locationId,
            locationId
              ? (names.get(locationId) ?? 'Unknown location')
              : 'Unlocated',
            { ...base, quantity: quantity.toString() },
          );
        }
      } else {
        const locations = new Set([
          item.currentLocationId,
          item.backupLocationId,
        ]);
        for (const locationId of locations) {
          if (locationFilter && locationId !== locationFilter) continue;
          add(
            locationId,
            locationId
              ? (names.get(locationId) ?? 'Unknown location')
              : 'Unlocated',
            {
              ...base,
              quantity: null,
              currentLevel:
                locationId === item.currentLocationId
                  ? item.currentLevel
                  : null,
              isPresent:
                locationId === item.currentLocationId ? item.isPresent : null,
              backupCount:
                locationId === item.backupLocationId ? item.backupCount : 0,
            },
          );
        }
      }
    }
    return [...groups.values()].sort((left, right) =>
      left.id === null
        ? 1
        : right.id === null
          ? -1
          : left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
    );
  }
}
