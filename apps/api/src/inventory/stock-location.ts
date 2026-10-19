import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

export type StockLocationClient = Pick<
  PrismaService,
  '$queryRaw' | 'stockBatch' | 'inventoryItem'
>;

export async function resolveRestockLocation(
  tx: StockLocationClient,
  input: {
    householdId: string;
    itemId: string;
    explicitLocationId?: unknown;
    preferredLocationId: string | null;
  },
): Promise<string> {
  let locationId: string | null = null;
  if (
    input.explicitLocationId !== undefined &&
    input.explicitLocationId !== null &&
    input.explicitLocationId !== ''
  ) {
    if (typeof input.explicitLocationId !== 'string') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_LOCATION_ID',
        message: 'locationId must be a location ID.',
        itemId: input.itemId,
      });
    }
    locationId = input.explicitLocationId;
  } else {
    locationId = input.preferredLocationId;
    if (!locationId) {
      const latestLocatedBatch = await tx.stockBatch.findFirst({
        where: {
          itemId: input.itemId,
          locationId: { not: null },
          location: { householdId: input.householdId },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { locationId: true },
      });
      locationId = latestLocatedBatch?.locationId ?? null;
    }
  }
  if (!locationId) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      code: 'LOCATION_REQUIRED',
      message: 'Choose a location before recording this stock.',
      itemId: input.itemId,
    });
  }
  // Serialize with catalog deletion before persisting the preferred location
  // or creating a batch. The caller already owns this transaction.
  const [location] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Location"
    WHERE "id" = ${locationId} AND "householdId" = ${input.householdId}
    FOR KEY SHARE
  `;
  if (!location) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      code: 'LOCATION_NOT_FOUND',
      message: 'Location was not found in this household.',
      itemId: input.itemId,
    });
  }
  await tx.inventoryItem.update({
    where: { id: input.itemId },
    data: { preferredRestockLocationId: location.id },
  });
  return location.id;
}
