import { Prisma } from '../generated/prisma/browser.js';
import { effectiveExpiryDate, localCalendarDate } from './plan-use.js';

type Decimal = InstanceType<typeof Prisma.Decimal>;
const ZERO = new Prisma.Decimal(0);
const BUFFER = new Prisma.Decimal('1.2');

export interface IntelligenceItem {
  id: string;
  name: string;
  primaryUnit: string;
  minimumStock: Decimal | null;
  lowStockThreshold: Decimal | null;
  buyThreshold: Decimal | null;
  targetStock: Decimal | null;
  openedTrackingEnabled: boolean;
  neverRunOut: boolean;
  predictionEnabled: boolean;
  batches: {
    quantity: Decimal;
    expiryDate: Date | null;
    openedAt?: Date | null;
    openedUseByDate?: Date | null;
  }[];
  actions: { quantity: Decimal; createdAt: Date; type?: string }[];
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function purchasableSuggestionQuantity(
  gap: Decimal,
  openedTrackingEnabled: boolean,
): Decimal {
  return openedTrackingEnabled
    ? gap.toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL)
    : gap;
}

export function assessItem(
  item: IntelligenceItem,
  at: Date,
  shoppingDate: string,
) {
  const today = localCalendarDate(at);
  const useSoonThrough = addCalendarDays(today, 3);
  let physical = ZERO;
  let eligible = ZERO;
  let expiring = ZERO;
  let expired = ZERO;
  let opened = ZERO;
  let unopened = ZERO;
  for (const batch of item.batches) {
    if (batch.quantity.lte(0)) continue;
    physical = physical.plus(batch.quantity);
    if (batch.openedAt) opened = opened.plus(batch.quantity);
    else unopened = unopened.plus(batch.quantity);
    const expiry = effectiveExpiryDate(batch)?.toISOString().slice(0, 10);
    if (expiry && expiry < today) {
      expired = expired.plus(batch.quantity);
    } else {
      eligible = eligible.plus(batch.quantity);
      if (expiry && expiry <= useSoonThrough) {
        expiring = expiring.plus(batch.quantity);
      }
    }
  }

  const windowStart = addCalendarDays(today, -13);
  const recentUses = item.actions.filter((action) => {
    const date = localCalendarDate(action.createdAt);
    return (
      (action.type === undefined ||
        action.type === 'USE' ||
        action.type === 'FINISH_OPENED') &&
      date >= windowStart &&
      date <= today
    );
  });
  const useDays = new Set(
    recentUses.map((action) => localCalendarDate(action.createdAt)),
  );
  const hasHistory =
    item.predictionEnabled &&
    useDays.size >= 2 &&
    [...useDays].some((date) => date <= addCalendarDays(today, -7));
  const usedIn14Days = recentUses.reduce(
    (sum, action) => sum.plus(action.quantity),
    ZERO,
  );
  const shoppingDays = Math.max(
    0,
    Math.round(
      (Date.parse(`${shoppingDate}T00:00:00.000Z`) -
        Date.parse(`${today}T00:00:00.000Z`)) /
        86_400_000,
    ),
  );
  const dailyRate = hasHistory
    ? usedIn14Days.div(14).toDecimalPlaces(6, Prisma.Decimal.ROUND_UP)
    : null;
  const projectedNeed = hasHistory
    ? usedIn14Days
        .mul(shoppingDays)
        .mul(BUFFER)
        .div(14)
        .toDecimalPlaces(6, Prisma.Decimal.ROUND_UP)
    : null;

  const out = eligible.isZero();
  const minimumReached =
    item.minimumStock !== null && eligible.lte(item.minimumStock);
  const buyThresholdReached =
    item.buyThreshold !== null && eligible.lte(item.buyThreshold);
  const forecastShortage = projectedNeed !== null && eligible.lt(projectedNeed);
  const buyRisk =
    out || minimumReached || buyThresholdReached || forecastShortage;
  const lowThresholdReached =
    item.lowStockThreshold !== null && eligible.lte(item.lowStockThreshold);
  const health = out
    ? 'OUT'
    : buyRisk
      ? 'BUY'
      : lowThresholdReached
        ? 'LOW'
        : 'OK';
  const reasons: string[] = [];
  if (out) reasons.push('No eligible stock remains.');
  if (minimumReached)
    reasons.push(
      `Eligible stock is at or below the minimum of ${item.minimumStock?.toString()}.`,
    );
  if (buyThresholdReached)
    reasons.push(
      `Eligible stock is at or below the buy threshold of ${item.buyThreshold?.toString()}.`,
    );
  if (forecastShortage)
    reasons.push(
      `Projected need through ${shoppingDate} is ${projectedNeed?.toString()} with a 20% buffer.`,
    );
  if (!buyRisk && lowThresholdReached)
    reasons.push(
      `Eligible stock is at or below the low threshold of ${item.lowStockThreshold?.toString()}.`,
    );
  if (reasons.length === 0)
    reasons.push('Eligible stock is above the configured risk levels.');
  if (buyRisk && item.targetStock === null) {
    reasons.push('Set a target stock to calculate a purchase quantity.');
  }
  const expiryReason = expiring.gt(0)
    ? `${expiring.toString()} ${item.primaryUnit} expires by ${useSoonThrough}; use eligible batches soon.`
    : null;
  const suggestedGap =
    buyRisk && item.targetStock && item.targetStock.gt(eligible)
      ? item.targetStock.minus(eligible)
      : null;
  const suggestedQuantity = suggestedGap
    ? purchasableSuggestionQuantity(suggestedGap, item.openedTrackingEnabled)
    : null;

  return {
    itemId: item.id,
    name: item.name,
    primaryUnit: item.primaryUnit,
    physicalStock: physical.toString(),
    openedQuantity: opened.toString(),
    unopenedQuantity: unopened.toString(),
    eligibleStock: eligible.toString(),
    expiredStock: expired.toString(),
    useSoonQuantity: expiring.toString(),
    expiryRisk: expiring.gt(0) ? 'USE_SOON' : 'NONE',
    expiryReason,
    lowStockRisk: health,
    reasons,
    prediction: {
      enabled: item.predictionEnabled,
      basis: hasHistory ? 'USE_14_DAY' : 'THRESHOLD_FALLBACK',
      reason: !item.predictionEnabled
        ? 'Prediction is off; configured thresholds are used.'
        : hasHistory
          ? 'USE and FINISH_OPENED quantities from the last 14 local calendar days are divided by 14; the projected need includes a 20% buffer.'
          : 'At least two consumption dates in the last 14 are required, including one at least seven local calendar days ago; configured thresholds are used.',
      usedIn14Days: usedIn14Days.toString(),
      dailyRate: dailyRate?.toString() ?? null,
      projectedNeed: projectedNeed?.toString() ?? null,
      shoppingDays,
    },
    suggestion: suggestedQuantity
      ? {
          quantity: suggestedQuantity.toString(),
          priority: out || item.neverRunOut ? 'MUST_BUY' : 'SHOULD_BUY',
          reason: `Buy ${suggestedQuantity.toString()} ${item.primaryUnit} to ${item.openedTrackingEnabled ? 'meet or exceed' : 'reach'} the target of ${item.targetStock?.toString()}. ${reasons.join(' ')}`,
        }
      : null,
  };
}
