import { addCalendarDays } from '../inventory/stock-intelligence.js';
import { localCalendarDate } from '../inventory/plan-use.js';
import type { StockIntelligenceService } from '../inventory/stock-intelligence.service.js';

type Assessment = Awaited<
  ReturnType<StockIntelligenceService['assessHousehold']>
>['assessments'][number];
export type AlertPreference = {
  expiryAlertsEnabled: boolean;
  lowStockAlertsEnabled: boolean;
  dailyDigestEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};
export type HouseholdAssessments = {
  householdId: string;
  assessments: Assessment[];
};
type DigestItem = { itemId: string; signals: ('LOW_STOCK' | 'USE_SOON')[] };
export type Candidate = {
  kind: 'IMMEDIATE_ITEM' | 'DAILY_DIGEST';
  subjectKey: string;
  householdId: string | null;
  itemId: string | null;
  content:
    | { signal: 'OUT' | 'USE_TODAY'; householdId: string; itemId: string }
    | { households: { householdId: string; items: DigestItem[] }[] };
};

export function localQuietEnd(
  at: Date,
  preference: AlertPreference,
): Date | null {
  const start = preference.quietHoursStart;
  const end = preference.quietHoursEnd;
  if (!start || !end) return null;
  const minute = (at.getUTCHours() * 60 + at.getUTCMinutes() + 7 * 60) % 1440;
  const startMinute =
    Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const endMinute = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));
  const active =
    startMinute < endMinute
      ? minute >= startMinute && minute < endMinute
      : minute >= startMinute || minute < endMinute;
  if (!active) return null;
  const today = localCalendarDate(at);
  const endDay =
    startMinute > endMinute && minute >= startMinute
      ? addCalendarDays(today, 1)
      : today;
  return new Date(`${endDay}T${end}:00+07:00`);
}

export function notificationCandidates(
  households: HouseholdAssessments[],
  preference: AlertPreference,
): Candidate[] {
  const immediate: Candidate[] = [];
  const digestHouseholds: { householdId: string; items: DigestItem[] }[] = [];
  for (const household of [...households].sort((a, b) =>
    a.householdId.localeCompare(b.householdId),
  )) {
    const digestItems: DigestItem[] = [];
    for (const item of [...household.assessments].sort((a, b) =>
      a.itemId.localeCompare(b.itemId),
    )) {
      const out =
        preference.lowStockAlertsEnabled &&
        item.neverRunOut &&
        item.lowStockRisk === 'OUT';
      const today =
        preference.expiryAlertsEnabled &&
        item.useTodayQuantity !== null &&
        item.useTodayQuantity !== '0';
      if (out || today)
        immediate.push({
          kind: 'IMMEDIATE_ITEM',
          subjectKey: `${household.householdId}:${item.itemId}`,
          householdId: household.householdId,
          itemId: item.itemId,
          content: {
            signal: out ? 'OUT' : 'USE_TODAY',
            householdId: household.householdId,
            itemId: item.itemId,
          },
        });
      if (!preference.dailyDigestEnabled) continue;
      const signals: DigestItem['signals'] = [];
      if (preference.lowStockAlertsEnabled && item.lowStockRisk !== 'OK')
        signals.push('LOW_STOCK');
      if (preference.expiryAlertsEnabled && item.expiryRisk === 'USE_SOON')
        signals.push('USE_SOON');
      if (signals.length) digestItems.push({ itemId: item.itemId, signals });
    }
    if (digestItems.length)
      digestHouseholds.push({
        householdId: household.householdId,
        items: digestItems,
      });
  }
  if (digestHouseholds.length)
    immediate.push({
      kind: 'DAILY_DIGEST',
      subjectKey: 'all',
      householdId: null,
      itemId: null,
      content: { households: digestHouseholds },
    });
  return immediate;
}
