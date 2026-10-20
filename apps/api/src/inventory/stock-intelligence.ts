import { Prisma } from '../generated/prisma/browser.js';
import { effectiveExpiryDate, localCalendarDate } from './plan-use.js';
import type { AssessmentExplanation } from './assessment-explanation.js';

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
  let useToday = ZERO;
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
        if (expiry === today) useToday = useToday.plus(batch.quantity);
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
  const reasonExplanations: AssessmentExplanation[] = [];
  const addReason = (reason: string, explanation: AssessmentExplanation) => {
    reasons.push(reason);
    reasonExplanations.push(explanation);
  };
  if (out)
    addReason('No eligible stock remains.', {
      code: 'QUANTITY_NO_ELIGIBLE_STOCK',
    });
  if (minimumReached)
    addReason(
      `Eligible stock is at or below the minimum of ${item.minimumStock?.toString()}.`,
      {
        code: 'QUANTITY_AT_OR_BELOW_MINIMUM',
        params: {
          minimumStock: item.minimumStock!.toString(),
          unit: item.primaryUnit,
        },
      },
    );
  if (buyThresholdReached)
    addReason(
      `Eligible stock is at or below the buy threshold of ${item.buyThreshold?.toString()}.`,
      {
        code: 'QUANTITY_AT_OR_BELOW_BUY_THRESHOLD',
        params: {
          buyThreshold: item.buyThreshold!.toString(),
          unit: item.primaryUnit,
        },
      },
    );
  if (forecastShortage)
    addReason(
      `Projected need through ${shoppingDate} is ${projectedNeed?.toString()} with a 20% buffer.`,
      {
        code: 'QUANTITY_PROJECTED_NEED',
        params: {
          shoppingDate,
          projectedNeed: projectedNeed!.toString(),
          unit: item.primaryUnit,
          bufferPercent: 20,
        },
      },
    );
  if (!buyRisk && lowThresholdReached)
    addReason(
      `Eligible stock is at or below the low threshold of ${item.lowStockThreshold?.toString()}.`,
      {
        code: 'QUANTITY_AT_OR_BELOW_LOW_THRESHOLD',
        params: {
          lowStockThreshold: item.lowStockThreshold!.toString(),
          unit: item.primaryUnit,
        },
      },
    );
  if (reasons.length === 0)
    addReason('Eligible stock is above the configured risk levels.', {
      code: 'QUANTITY_ABOVE_RISK_LEVELS',
    });
  if (buyRisk && item.targetStock === null) {
    addReason('Set a target stock to calculate a purchase quantity.', {
      code: 'QUANTITY_TARGET_REQUIRED',
    });
  }
  const expiry = expiring.gt(0)
    ? {
        reason: `${expiring.toString()} ${item.primaryUnit} expires by ${useSoonThrough}; use eligible batches soon.`,
        explanation: {
          code: 'QUANTITY_USE_SOON',
          params: {
            quantity: expiring.toString(),
            unit: item.primaryUnit,
            throughDate: useSoonThrough,
          },
        } satisfies AssessmentExplanation,
      }
    : null;
  const suggestedGap =
    buyRisk && item.targetStock && item.targetStock.gt(eligible)
      ? item.targetStock.minus(eligible)
      : null;
  const suggestedQuantity = suggestedGap
    ? purchasableSuggestionQuantity(suggestedGap, item.openedTrackingEnabled)
    : null;
  const predictionMessage = !item.predictionEnabled
    ? {
        reason: 'Prediction is off; configured thresholds are used.',
        explanation: { code: 'PREDICTION_DISABLED' },
      }
    : hasHistory
      ? {
          reason:
            'USE and FINISH_OPENED quantities from the last 14 local calendar days are divided by 14; the projected need includes a 20% buffer.',
          explanation: {
            code: 'PREDICTION_USE_14_DAY',
            params: { windowDays: 14, bufferPercent: 20 },
          },
        }
      : {
          reason:
            'At least two consumption dates in the last 14 are required, including one at least seven local calendar days ago; configured thresholds are used.',
          explanation: {
            code: 'PREDICTION_INSUFFICIENT_HISTORY',
            params: {
              windowDays: 14,
              minimumDistinctDays: 2,
              requiredSpanDays: 7,
            },
          },
        };

  return {
    itemId: item.id,
    neverRunOut: item.neverRunOut,
    name: item.name,
    primaryUnit: item.primaryUnit,
    physicalStock: physical.toString(),
    openedQuantity: opened.toString(),
    unopenedQuantity: unopened.toString(),
    eligibleStock: eligible.toString(),
    expiredStock: expired.toString(),
    useSoonQuantity: expiring.toString(),
    useTodayQuantity: useToday.toString(),
    expiryRisk: expiring.gt(0) ? 'USE_SOON' : 'NONE',
    expiryReason: expiry?.reason ?? null,
    expiryExplanation: expiry?.explanation ?? null,
    lowStockRisk: health,
    reasons,
    reasonExplanations,
    prediction: {
      enabled: item.predictionEnabled,
      basis: hasHistory ? 'USE_14_DAY' : 'THRESHOLD_FALLBACK',
      ...predictionMessage,
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
          explanation: {
            code: item.openedTrackingEnabled
              ? 'QUANTITY_BUY_TO_MEET_OR_EXCEED_TARGET'
              : 'QUANTITY_BUY_TO_TARGET',
            params: {
              quantity: suggestedQuantity.toString(),
              unit: item.primaryUnit,
              targetStock: item.targetStock!.toString(),
            },
          },
        }
      : null,
  };
}
