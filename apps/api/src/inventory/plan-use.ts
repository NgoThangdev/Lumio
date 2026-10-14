import { Prisma } from '../generated/prisma/browser.js';

type Decimal = InstanceType<typeof Prisma.Decimal>;

export interface UseBatch {
  id: string;
  quantity: Decimal;
  expiryDate: Date | null;
  createdAt: Date;
  openedAt?: Date | null;
  openedUseByDate?: Date | null;
}

export interface UseAllocation {
  batchId: string;
  quantity: Decimal;
}

export type UsePlan =
  | { ok: true; allocations: UseAllocation[] }
  | { ok: false; reason: 'INVALID_QUANTITY' | 'INSUFFICIENT_STOCK' };

const localDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function localCalendarDate(instant: Date): string {
  const parts = localDateFormatter.formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function effectiveExpiryDate(
  batch: Pick<UseBatch, 'expiryDate' | 'openedUseByDate'>,
): Date | null {
  const opened = batch.openedUseByDate;
  if (!opened) return batch.expiryDate;
  if (!batch.expiryDate) return opened;
  return opened < batch.expiryDate ? opened : batch.expiryDate;
}

export function planOpenTransfer(
  sourceQuantity: Decimal,
): { sourceRemaining: Decimal; openedQuantity: Decimal } | null {
  const openedQuantity = new Prisma.Decimal(1);
  if (!sourceQuantity.isFinite() || sourceQuantity.lt(openedQuantity))
    return null;
  return {
    sourceRemaining: sourceQuantity.minus(openedQuantity),
    openedQuantity,
  };
}

export function eligibleBatches(
  batches: readonly UseBatch[],
  at: Date,
): UseBatch[] {
  const today = localCalendarDate(at);
  return batches
    .filter((batch) => {
      const expiry = effectiveExpiryDate(batch);
      return (
        batch.quantity.gt(0) &&
        (!expiry || expiry.toISOString().slice(0, 10) >= today)
      );
    })
    .sort((left, right) => {
      const leftExpiry = effectiveExpiryDate(left);
      const rightExpiry = effectiveExpiryDate(right);
      if (leftExpiry === null && rightExpiry !== null) return 1;
      if (leftExpiry !== null && rightExpiry === null) return -1;
      if (leftExpiry !== null && rightExpiry !== null) {
        const dateOrder = leftExpiry.getTime() - rightExpiry.getTime();
        if (dateOrder !== 0) return dateOrder;
      } else {
        const creationOrder =
          left.createdAt.getTime() - right.createdAt.getTime();
        if (creationOrder !== 0) return creationOrder;
      }
      return compareIds(left.id, right.id);
    });
}

/** Plans a Use action from a read-only batch snapshot; it does not reserve stock. */
export function planUse(
  requestedQuantity: Decimal,
  batches: readonly UseBatch[],
  at: Date,
): UsePlan {
  if (!requestedQuantity.isFinite() || requestedQuantity.lte(0)) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }

  const eligible = eligibleBatches(batches, at);

  let remaining = requestedQuantity;
  const allocations: UseAllocation[] = [];
  for (const batch of eligible) {
    if (remaining.isZero()) break;
    const quantity = batch.quantity.lte(remaining) ? batch.quantity : remaining;
    allocations.push({ batchId: batch.id, quantity });
    remaining = remaining.minus(quantity);
  }

  if (!remaining.isZero()) {
    return { ok: false, reason: 'INSUFFICIENT_STOCK' };
  }
  return { ok: true, allocations };
}

/** Picks whole unopened containers to open, preserving FEFO within unopened stock. */
export function planAutomaticOpen(
  requestedQuantity: Decimal,
  batches: readonly UseBatch[],
  at: Date,
): { ok: true; sourceBatchIds: string[] } | { ok: false } {
  const opened = batches.filter((batch) => batch.openedAt);
  const unopened = batches.filter((batch) => !batch.openedAt);
  const today = localCalendarDate(at);
  const openedEligible = opened.reduce(
    (sum, batch) =>
      batch.quantity.gt(0) &&
      (!effectiveExpiryDate(batch) ||
        effectiveExpiryDate(batch)!.toISOString().slice(0, 10) >= today)
        ? sum.plus(batch.quantity)
        : sum,
    new Prisma.Decimal(0),
  );
  const shortfall = requestedQuantity.minus(openedEligible);
  if (shortfall.lte(0)) return { ok: true, sourceBatchIds: [] };
  const count = shortfall.ceil().toNumber();
  if (count > 1000) return { ok: false };
  const plan = planUse(new Prisma.Decimal(count), unopened, at);
  if (!plan.ok) return { ok: false };
  return {
    ok: true,
    sourceBatchIds: plan.allocations.flatMap((allocation) =>
      Array<string>(allocation.quantity.toNumber()).fill(allocation.batchId),
    ),
  };
}
