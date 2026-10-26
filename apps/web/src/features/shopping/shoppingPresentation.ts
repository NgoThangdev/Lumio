import type { TrackingMode } from '@/shared/api/types';
import { tr } from '@/shared/i18n';
import type { Entry } from './shoppingTypes';

export const priorityOrder = ['MUST_BUY', 'SHOULD_BUY', 'OPTIONAL'] as const;

export function priorityLabel(priority: Entry['priority']) {
  return priority === 'MUST_BUY'
    ? tr('shopping:must')
    : priority === 'SHOULD_BUY'
      ? tr('shopping:should')
      : tr('common:optional');
}

export function validPurchaseAmount(
  value: string,
  mode: TrackingMode,
  packageCount = false,
) {
  if (mode !== 'QUANTITY') {
    return (
      /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647
    );
  }
  return (
    (packageCount ? /^\d+$/.test(value) : /^\d+(?:\.\d{1,6})?$/.test(value)) &&
    Number(value) > 0
  );
}

export function plannedDateFromCycle(days: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day') + days))
    .toISOString()
    .slice(0, 10);
}
