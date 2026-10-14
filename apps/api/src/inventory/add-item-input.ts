import { BadRequestException } from '@nestjs/common';
import type { StockLevel, TrackingMode } from '../generated/prisma/client.js';
import { parseQuantity } from './quantity-validation.js';

export type InitialStock =
  | { quantity: string; expiryDate?: Date | null }
  | { level: StockLevel; backupCount?: number }
  | { present: boolean; backupCount?: number };

export interface AddItemFields {
  categoryId?: unknown;
  locationId?: unknown;
  tagIds?: unknown;
  initialStock?: unknown;
}

export interface ParsedAddItem {
  categoryId: string;
  locationId: string;
  tagIds: string[];
  initialStock: InitialStock;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${label} is required.`);
  }
  return value;
}

export function parseAddItem(
  mode: TrackingMode,
  fields: AddItemFields,
): ParsedAddItem {
  const categoryId = id(fields.categoryId, 'Category ID');
  const locationId = id(fields.locationId, 'Location ID');
  const tagIds = fields.tagIds ?? [];
  if (
    !Array.isArray(tagIds) ||
    tagIds.some((tagId) => typeof tagId !== 'string' || !tagId.trim()) ||
    new Set(tagIds).size !== tagIds.length
  ) {
    throw new BadRequestException('Tag IDs must be a list of distinct IDs.');
  }
  const stock = fields.initialStock;
  if (!stock || typeof stock !== 'object' || Array.isArray(stock)) {
    throw new BadRequestException('Initial stock is required.');
  }
  const value = stock as Record<string, unknown>;
  if (mode === 'QUANTITY') {
    if (
      typeof value.quantity !== 'string' ||
      value.level !== undefined ||
      value.present !== undefined ||
      value.backupCount !== undefined
    ) {
      throw new BadRequestException(
        'Quantity tracking requires an initial quantity.',
      );
    }
    if (value.quantity !== '0') parseQuantity(value.quantity, 'Restock');
    if (value.quantity === '0' && value.expiryDate != null) {
      throw new BadRequestException(
        'An empty starting quantity cannot have an expiry date.',
      );
    }
    if (
      value.expiryDate !== undefined &&
      value.expiryDate !== null &&
      !(
        value.expiryDate instanceof Date &&
        !Number.isNaN(value.expiryDate.getTime())
      )
    ) {
      throw new BadRequestException('Initial expiry date is invalid.');
    }
    return {
      categoryId,
      locationId,
      tagIds,
      initialStock: {
        quantity: value.quantity,
        expiryDate: (value.expiryDate as Date | null | undefined) ?? null,
      },
    };
  }
  const backupCount = value.backupCount ?? 0;
  if (
    !Number.isInteger(backupCount) ||
    (backupCount as number) < 0 ||
    (backupCount as number) > 2147483647
  ) {
    throw new BadRequestException(
      'Backup count must be a non-negative 32-bit integer.',
    );
  }
  if (value.quantity !== undefined || value.expiryDate !== undefined) {
    throw new BadRequestException(
      'Quantity and expiry are only valid for quantity tracking.',
    );
  }
  if (mode === 'FIVE_LEVEL') {
    if (
      !['FULL', 'THREE_QUARTERS', 'HALF', 'QUARTER', 'EMPTY'].includes(
        value.level as string,
      ) ||
      value.present !== undefined
    ) {
      throw new BadRequestException(
        'Five-level tracking requires one of the five stock levels.',
      );
    }
    return {
      categoryId,
      locationId,
      tagIds,
      initialStock: {
        level: value.level as StockLevel,
        backupCount: backupCount as number,
      },
    };
  }
  if (typeof value.present !== 'boolean' || value.level !== undefined) {
    throw new BadRequestException('Presence tracking requires true or false.');
  }
  return {
    categoryId,
    locationId,
    tagIds,
    initialStock: {
      present: value.present,
      backupCount: backupCount as number,
    },
  };
}
