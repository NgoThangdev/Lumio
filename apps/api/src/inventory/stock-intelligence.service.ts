import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireActiveHousehold } from '../households/active-household.js';
import { addCalendarDays, assessItem } from './stock-intelligence.js';
import { localCalendarDate } from './plan-use.js';
import { assessStateItem } from './state-assessment.js';

@Injectable()
export class StockIntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  async assessHousehold(
    actorId: string,
    householdId: string,
    shoppingDateInput?: string,
    at = new Date(),
  ) {
    return this.prisma.$transaction(async (tx) => {
      await requireActiveHousehold(tx, actorId, householdId);
      return this.assessWithClient(tx, householdId, shoppingDateInput, at);
    });
  }

  async assessInTransaction(
    tx: Prisma.TransactionClient,
    actorId: string,
    householdId: string,
    shoppingDateInput?: string,
    at = new Date(),
  ) {
    await requireActiveHousehold(tx, actorId, householdId);
    return this.assessWithClient(tx, householdId, shoppingDateInput, at);
  }

  private async assessWithClient(
    client: Pick<
      Prisma.TransactionClient,
      'membership' | 'inventoryItem' | 'shoppingTrip' | 'household'
    >,
    householdId: string,
    shoppingDateInput?: string,
    at = new Date(),
  ) {
    const now = at;
    const today = localCalendarDate(now);
    let shoppingDate = shoppingDateInput;
    if (shoppingDate === undefined) {
      const trip = await client.shoppingTrip.findFirst({
        where: {
          householdId,
          status: { not: 'RESTOCKED' },
          archivedAt: null,
          plannedDate: { gte: new Date(`${today}T00:00:00.000Z`) },
        },
        select: { plannedDate: true },
        orderBy: [{ plannedDate: 'asc' }, { id: 'asc' }],
      });
      if (trip) shoppingDate = trip.plannedDate.toISOString().slice(0, 10);
      else {
        const household = await client.household.findUniqueOrThrow({
          where: { id: householdId },
          select: { defaultShoppingCycleDays: true },
        });
        shoppingDate = addCalendarDays(
          today,
          household.defaultShoppingCycleDays,
        );
      }
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(shoppingDate) ||
      Number.isNaN(Date.parse(`${shoppingDate}T00:00:00.000Z`)) ||
      new Date(`${shoppingDate}T00:00:00.000Z`).toISOString().slice(0, 10) !==
        shoppingDate ||
      shoppingDate < today ||
      shoppingDate > addCalendarDays(today, 30)
    ) {
      throw new BadRequestException(
        'Shopping date must be a valid date from today through 30 days ahead.',
      );
    }
    const windowStart = addCalendarDays(today, -13);
    const items = await client.inventoryItem.findMany({
      where: { householdId, archivedAt: null },
      include: {
        batches: {
          select: {
            quantity: true,
            expiryDate: true,
            openedAt: true,
            openedUseByDate: true,
          },
        },
        actions: {
          where: {
            type: { in: ['USE', 'FINISH_OPENED'] },
            undo: { is: null },
            createdAt: {
              gte: new Date(`${windowStart}T00:00:00+07:00`),
              lte: now,
            },
          },
          select: { quantity: true, createdAt: true, type: true },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const assessments = items.map((item) =>
      item.trackingMode === 'QUANTITY'
        ? {
            ...assessItem(item, now, shoppingDate),
            trackingMode: 'QUANTITY' as const,
          }
        : assessStateItem(item),
    );
    return {
      shoppingDate,
      assessments,
      useSoon: assessments.filter((item) => item.expiryRisk === 'USE_SOON'),
      suggestions: assessments.filter((item) => item.suggestion !== null),
    };
  }
}
