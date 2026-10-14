import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/browser.js';

export const MAX_QUANTITY = new Prisma.Decimal('999999999999.999999');

export function parseQuantity(
  value: string,
  action: 'Use' | 'Restock',
): InstanceType<typeof Prisma.Decimal> {
  const match = /^(?:\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new BadRequestException(
      `${action} quantity must be a positive decimal number.`,
    );
  }
  if ((match[1]?.length ?? 0) > 6) {
    throw new BadRequestException(
      `${action} quantity cannot have more than six decimal places; no rounding is applied.`,
    );
  }
  const quantity = new Prisma.Decimal(value);
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new BadRequestException(
      `${action} quantity must be greater than zero.`,
    );
  }
  if (quantity.gt(MAX_QUANTITY)) {
    throw new BadRequestException(
      `${action} quantity exceeds the Decimal(18,6) maximum of 999999999999.999999.`,
    );
  }
  return quantity;
}
