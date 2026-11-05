import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/browser.js';
type Decimal = InstanceType<typeof Prisma.Decimal>;

export const defaultFields = [
  'defaultTrackingMode',
  'defaultPrimaryUnit',
  'defaultLowStockThreshold',
  'defaultBuyThreshold',
  'defaultTargetStock',
  'defaultSafetyBuffer',
  'defaultExpiryReminderDays',
] as const;

const modes = ['QUANTITY', 'FIVE_LEVEL', 'PRESENCE_BACKUP'] as const;

function decimal(value: unknown, label: string, max: string) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value))
    throw new BadRequestException(`INVALID_${label}`);
  const parsed = new Prisma.Decimal(value);
  if (!parsed.isFinite() || parsed.gt(max))
    throw new BadRequestException(`INVALID_${label}`);
  return parsed;
}

export function parseDefaultUpdate(input: unknown, household = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('INVALID_INVENTORY_DEFAULTS');
  const body = input as Record<string, unknown>;
  const keys = Object.keys(body);
  if (
    !keys.length ||
    keys.some(
      (key) => !defaultFields.includes(key as (typeof defaultFields)[number]),
    )
  )
    throw new BadRequestException('INVALID_INVENTORY_DEFAULTS');
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const value = body[key];
    if (key === 'defaultTrackingMode') {
      if (value !== null && !modes.includes(value as (typeof modes)[number]))
        throw new BadRequestException('INVALID_DEFAULT_TRACKING_MODE');
      data[key] = value;
    } else if (key === 'defaultPrimaryUnit') {
      if (
        value !== null &&
        (typeof value !== 'string' || !value.trim() || value.trim().length > 40)
      )
        throw new BadRequestException('INVALID_DEFAULT_PRIMARY_UNIT');
      data[key] = typeof value === 'string' ? value.trim() : null;
    } else if (key === 'defaultSafetyBuffer') {
      if (value === null && household)
        throw new BadRequestException('INVALID_DEFAULT_SAFETY_BUFFER');
      if (
        value !== null &&
        (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value))
      )
        throw new BadRequestException('INVALID_DEFAULT_SAFETY_BUFFER');
      const parsed = decimal(value, 'DEFAULT_SAFETY_BUFFER', '3');
      if (parsed && parsed.lt(1))
        throw new BadRequestException('INVALID_DEFAULT_SAFETY_BUFFER');
      data[key] = parsed;
    } else if (key === 'defaultExpiryReminderDays') {
      if (
        (value === null && household) ||
        (value !== null &&
          (!Number.isInteger(value) ||
            (value as number) < 0 ||
            (value as number) > 30))
      )
        throw new BadRequestException('INVALID_DEFAULT_EXPIRY_REMINDER_DAYS');
      data[key] = value;
    } else {
      data[key] = decimal(value, 'DEFAULT_THRESHOLD', '999999999999.999999');
      if (
        key === 'defaultTargetStock' &&
        data[key] &&
        (data[key] as Decimal).isZero()
      )
        throw new BadRequestException('INVALID_DEFAULT_TARGET_STOCK');
    }
  }
  return data;
}

export function validateThresholdOrder(values: {
  defaultBuyThreshold: Decimal | null;
  defaultLowStockThreshold: Decimal | null;
  defaultTargetStock: Decimal | null;
}) {
  const {
    defaultBuyThreshold: buy,
    defaultLowStockThreshold: low,
    defaultTargetStock: target,
  } = values;
  if (
    (buy && low && buy.gt(low)) ||
    (low && target && low.gt(target)) ||
    (buy && target && buy.gt(target))
  )
    throw new BadRequestException('INVALID_DEFAULT_THRESHOLD_ORDER');
}

export function hasNumericDefaults(values: {
  defaultBuyThreshold: Decimal | null;
  defaultLowStockThreshold: Decimal | null;
  defaultTargetStock: Decimal | null;
}) {
  return (
    values.defaultBuyThreshold != null ||
    values.defaultLowStockThreshold != null ||
    values.defaultTargetStock != null
  );
}

export function resolveQuantityDefaults(
  mode: string,
  unit: string,
  household: {
    defaultTrackingMode: string | null;
    defaultPrimaryUnit: string | null;
    defaultLowStockThreshold: Decimal | null;
    defaultBuyThreshold: Decimal | null;
    defaultTargetStock: Decimal | null;
    defaultSafetyBuffer: Decimal;
    defaultExpiryReminderDays: number;
  },
  category: {
    defaultTrackingMode: string | null;
    defaultPrimaryUnit: string | null;
    defaultLowStockThreshold: Decimal | null;
    defaultBuyThreshold: Decimal | null;
    defaultTargetStock: Decimal | null;
    defaultSafetyBuffer: Decimal | null;
    defaultExpiryReminderDays: number | null;
  } | null,
) {
  const householdCompatible =
    mode === 'QUANTITY' &&
    household.defaultTrackingMode === mode &&
    household.defaultPrimaryUnit === unit;
  const categoryMode =
    category?.defaultTrackingMode ?? household.defaultTrackingMode;
  const categoryUnit =
    category?.defaultPrimaryUnit ?? household.defaultPrimaryUnit;
  const categoryCompatible =
    mode === 'QUANTITY' && categoryMode === mode && categoryUnit === unit;
  const threshold = (
    field:
      'defaultLowStockThreshold' | 'defaultBuyThreshold' | 'defaultTargetStock',
  ) =>
    categoryCompatible && category?.[field] != null
      ? category[field]
      : householdCompatible
        ? household[field]
        : null;
  const resolved = {
    lowStockThreshold: threshold('defaultLowStockThreshold'),
    buyThreshold: threshold('defaultBuyThreshold'),
    targetStock: threshold('defaultTargetStock'),
    safetyBuffer:
      categoryCompatible && category?.defaultSafetyBuffer != null
        ? category.defaultSafetyBuffer
        : household.defaultSafetyBuffer,
    expiryReminderDays:
      categoryCompatible && category?.defaultExpiryReminderDays != null
        ? category.defaultExpiryReminderDays
        : household.defaultExpiryReminderDays,
  };
  validateThresholdOrder({
    defaultLowStockThreshold: resolved.lowStockThreshold,
    defaultBuyThreshold: resolved.buyThreshold,
    defaultTargetStock: resolved.targetStock,
  });
  return resolved;
}
