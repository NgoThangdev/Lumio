import type {
  NeedsAttention,
  RecentActivityEvent,
} from '../../shared/api/types';
import { tr, type TranslationKey } from '../../shared/i18n';
import { formatNumber, localizedEnum } from '../../shared/i18n';

type AttentionItem = NeedsAttention['items'][number];

export function alertLabel(entry: AttentionItem): TranslationKey {
  if (entry.action === 'USE_SOON') return 'common:useSoon3';
  if (entry.lowStockRisk === 'OUT') return 'common:outStock';
  if (entry.lowStockRisk === 'BUY') return 'common:timeBuy';
  if (entry.lowStockRisk === 'LOW') return 'common:lowStock';
  return 'home:needsAttention';
}

export function alertTone(entry: AttentionItem) {
  if (entry.lowStockRisk === 'OUT') return 'home-pill-critical';
  if (entry.action === 'USE_SOON' || entry.lowStockRisk === 'BUY')
    return 'home-pill-soon';
  return 'home-pill-low';
}

export function activityTypeLabel(event: RecentActivityEvent) {
  const labels: Record<RecentActivityEvent['type'], string> = {
    USE: 'common:used2',
    RESTOCK: 'common:restocked2',
    INITIAL_STOCK: 'home:initialStockAdded',
    OPEN: 'home:openedPackage',
    FINISH_OPENED: 'common:finishedOpenedStock',
    INITIALIZE: 'home:initialStateRecorded',
    UPDATE_LEVEL: 'common:levelUpdated',
    ADD_BACKUP: 'home:backupAdded',
    OPEN_REFILL: 'home:openedRefill',
    SET_PRESENCE: 'home:presenceUpdated',
    UNDO: 'common:undo',
    SHOPPING_TRIP_COMPLETED: 'home:shoppingTripFinished',
    TRIP_STOCK_CORRECTED: 'home:shoppingStockCheck',
    LOCATION_STOCK_CORRECTED: 'home:locationStockCorrected',
  };
  return tr(labels[event.type] as Parameters<typeof tr>[0]);
}

function activityChangeText(event: RecentActivityEvent) {
  const change = event.change;
  if (!change) return '';
  const field =
    change.after.quantity !== undefined
      ? 'quantity'
      : change.after.currentLevel != null
        ? 'currentLevel'
        : change.after.isPresent != null
          ? 'isPresent'
          : change.after.backupCount != null
            ? 'backupCount'
            : null;
  if (!field) return '';
  const describe = (value: typeof change.before) => {
    const entry = value[field];
    if (entry === undefined || entry === null) return 'not set';
    if (field === 'quantity')
      return `${formatNumber(String(entry))}${event.item?.primaryUnit ? ` ${event.item.primaryUnit}` : ''}`;
    if (field === 'currentLevel') return localizedEnum(String(entry));
    if (field === 'isPresent') return entry ? 'present' : 'absent';
    return `${formatNumber(Number(entry))} ${tr(entry === 1 ? 'common:backup' : 'common:backups2')}`;
  };
  const before = describe(change.before);
  const after = describe(change.after);
  return before && after ? `${before} → ${after}` : after;
}

export function activityDetail(event: RecentActivityEvent) {
  if (event.isUndone) return tr('home:undone');
  if (event.type === 'UNDO')
    return event.reversesType
      ? tr('home:reversed', { action: localizedEnum(event.reversesType) })
      : tr('home:reversalRecorded');
  if (event.type === 'SHOPPING_TRIP_COMPLETED')
    return event.trip?.store
      ? tr('home:shopping3', { store: event.trip.store })
      : tr('home:shoppingTripCompleted');
  if (event.type === 'TRIP_STOCK_CORRECTED')
    return activityChangeText(event) || tr('home:stockObservationUpdated');
  if (event.type === 'LOCATION_STOCK_CORRECTED') {
    const change = activityChangeText(event);
    return (
      [event.location?.name, change].filter(Boolean).join(' · ') ||
      tr('home:stockObservationUpdated')
    );
  }
  const change = activityChangeText(event);
  if (change) return change;
  if (event.quantity !== null)
    return `${formatNumber(event.quantity)}${event.item?.primaryUnit ? ` ${event.item.primaryUnit}` : ''}`;
  return '';
}
