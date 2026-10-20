import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useHousehold } from '../../app/useHousehold';
import { api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  InventoryRead,
  Item,
  NeedsAttention,
  RecentActivityEvent,
  User,
} from '../../shared/api/types';
import { Doodle } from '../../shared/ui/Doodle';
import {
  ExplanationText,
  hasExplanationTranslation,
  Notice,
} from '../../shared/ui/primitives';

import { tr, type TranslationKey } from '../../shared/i18n';
import {
  formatDate,
  formatDateOnly,
  localizedError,
  formatNumber,
  localizedEnum,
} from '../../shared/i18n';
type TripSummary = {
  id: string;
  store: string;
  plannedDate: string;
  status: 'DRAFT' | 'SHOPPING' | 'RESTOCKED';
  _count?: { entries: number };
};

type AttentionItem = NeedsAttention['items'][number];

function alertLabel(entry: AttentionItem): TranslationKey {
  if (entry.action === 'USE_SOON') return 'common:useSoon3';
  if (entry.lowStockRisk === 'OUT') return 'common:outStock';
  if (entry.lowStockRisk === 'BUY') return 'common:timeBuy';
  if (entry.lowStockRisk === 'LOW') return 'common:lowStock';
  return 'home:needsAttention';
}

function alertTone(entry: AttentionItem) {
  if (entry.lowStockRisk === 'OUT') return 'home-pill-critical';
  if (entry.action === 'USE_SOON' || entry.lowStockRisk === 'BUY')
    return 'home-pill-soon';
  return 'home-pill-low';
}

function activityTypeLabel(event: RecentActivityEvent) {
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

function activityDetail(event: RecentActivityEvent) {
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

export function HomePage() {
  const household = useHousehold();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = `/households/${household.id}`;
  const [search, setSearch] = useState('');
  const attention = useQuery({
    queryKey: keys.needsAttention(household.id),
    queryFn: () => api<NeedsAttention>(`${base}/home/needs-attention`),
  });
  const stock = useQuery({
    queryKey: keys.inventoryRead(household.id, 'groupBy=none'),
    queryFn: async () => {
      const result = await api<InventoryRead | Item[]>(
        `${base}/items?groupBy=none`,
      );
      if (Array.isArray(result) || !result || !Array.isArray(result.items)) {
        throw new Error(tr('home:inventoryResponseMissing'));
      }
      return result;
    },
    enabled: !!attention.data?.items.length,
  });
  const snapshot = useQuery({
    queryKey: keys.inventoryRead(household.id, 'groupBy=location'),
    queryFn: async () => {
      const result = await api<InventoryRead | Item[]>(
        `${base}/items?groupBy=location`,
      );
      if (Array.isArray(result) || !result || !Array.isArray(result.groups)) {
        throw new Error(tr('home:locationGroupsMissing'));
      }
      return result;
    },
  });
  const trips = useQuery({
    queryKey: keys.trips(household.id),
    queryFn: () => api<TripSummary[]>(`${base}/trips`),
  });
  const activity = useQuery({
    queryKey: keys.recentActivity(household.id),
    queryFn: () =>
      api<{ items: RecentActivityEvent[] }>(
        `/households/${household.id}/home/activity`,
      ),
  });
  const currentUserId = queryClient.getQueryData<User>(keys.session)?.id;
  const nextTrip = trips.data
    ?.filter((trip) => trip.status !== 'RESTOCKED')
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))[0];
  const locationGroups =
    snapshot.data?.groups?.filter(
      (group): group is typeof group & { id: string } => group.id !== null,
    ) ?? [];

  return (
    <div className="home-page">
      <form
        className="home-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate(
            `${base}/inventory${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`,
          );
        }}
      >
        <label className="sr-only" htmlFor="home-search-input">
          {tr('common:searchItem')}
        </label>
        <input
          id="home-search-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tr('home:searchItemPrompt')}
        />
        <button type="submit" aria-label={tr('home:searchInventory')}>
          {tr('common:search')}
        </button>
      </form>

      {(attention.isPending ||
        attention.isError ||
        !!attention.data?.items.length) && (
        <section
          className="home-attention"
          aria-labelledby="home-attention-title"
        >
          <div className="home-section-heading">
            <h2 id="home-attention-title">{tr('home:needsAttention')}</h2>
            <Link to={`${base}/inventory`}>
              {tr('home:seeAll')} <span aria-hidden="true">›</span>
            </Link>
          </div>
          {attention.isPending ? (
            <p className="muted" role="status">
              {tr('home:loadingNeedsAttention')}
            </p>
          ) : attention.isError ? (
            <Notice kind="error">{localizedError(attention.error)}</Notice>
          ) : (
            <div className="home-attention-grid">
              {attention.data.items.slice(0, 2).map((entry) => {
                const match = stock.data?.items.find(
                  ({ item }) => item.id === entry.itemId,
                );
                const amount = match
                  ? match.item.trackingMode === 'QUANTITY'
                    ? match.assessment.eligibleStock === null
                      ? tr('home:stockUnavailable')
                      : `${formatNumber(match.assessment.eligibleStock)} ${match.item.primaryUnit} ${tr('common:available')}`
                    : `${formatNumber(match.item.backupCount)} ${tr(match.item.backupCount === 1 ? 'common:backup' : 'common:backups2')}`
                  : stock.isPending
                    ? tr('common:loadingStock')
                    : tr('home:stockUnavailable');
                // Pair legacy fallback text in the API's full explanation
                // order. The displayed primary descriptor remains API-owned.
                const primaryReasonIndex =
                  entry.action === 'USE_SOON'
                    ? 0
                    : entry.action === 'OPEN_REFILL' ||
                        entry.trackingMode !== 'QUANTITY'
                      ? entry.reasons.length - 1
                      : entry.expiryRisk === 'USE_SOON'
                        ? 1
                        : 0;
                const supportingFallbacks = entry.reasons.filter(
                  (_, index) => index !== primaryReasonIndex,
                );
                return (
                  <Link
                    className="home-attention-card"
                    key={entry.itemId}
                    to={`${base}/inventory/${entry.itemId}`}
                  >
                    <span className={`home-attention-pill ${alertTone(entry)}`}>
                      {tr(alertLabel(entry))}
                    </span>
                    <span className="home-attention-body">
                      <span className="home-attention-visual">
                        <Doodle itemName={entry.name} />
                      </span>
                      <div className="home-attention-copy">
                        <strong>{entry.name}</strong>
                        <small>{amount}</small>
                        {entry.primaryExplanation ? (
                          <>
                            <ExplanationText
                              className="home-attention-explanation"
                              explanation={entry.primaryExplanation}
                              fallback={entry.reason}
                            />
                            {hasExplanationTranslation(
                              entry.primaryExplanation,
                            ) &&
                              (entry.supportingExplanations?.length
                                ? entry.supportingExplanations.map(
                                    (explanation, index) => (
                                      <ExplanationText
                                        className="home-attention-explanation"
                                        key={`${explanation.code}-${index}`}
                                        explanation={explanation}
                                        fallback={supportingFallbacks[index]}
                                      />
                                    ),
                                  )
                                : supportingFallbacks.map((reason, index) => (
                                    <ExplanationText
                                      className="home-attention-explanation"
                                      key={`${reason}-${index}`}
                                      explanation={undefined}
                                      fallback={reason}
                                    />
                                  )))}
                          </>
                        ) : (
                          entry.reasons.map((reason, index) => (
                            <ExplanationText
                              className="home-attention-explanation"
                              key={`fallback-${reason}-${index}`}
                              explanation={undefined}
                              fallback={reason}
                            />
                          ))
                        )}
                      </div>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section
        className="home-quick-actions"
        aria-label={tr('home:quickActions')}
      >
        <Link
          className="home-quick-card home-quick-use"
          to={`${base}/inventory`}
        >
          <span className="home-quick-icon">
            <Doodle kind="jar" />
          </span>
          <span>
            <strong>{tr('common:use')}</strong>
            <small>{tr('home:chooseItemUse')}</small>
          </span>
          <span className="home-quick-arrow" aria-hidden="true">
            ›
          </span>
        </Link>
        <Link
          className="home-quick-card home-quick-restock"
          to={`${base}/inventory`}
        >
          <span className="home-quick-icon">
            <Doodle kind="basket" />
          </span>
          <span>
            <strong>{tr('common:restock')}</strong>
            <small>{tr('home:chooseItemRestock')}</small>
          </span>
          <span className="home-quick-arrow" aria-hidden="true">
            ›
          </span>
        </Link>
      </section>

      <section className="home-trip" aria-labelledby="home-trip-title">
        <div className="home-section-heading">
          <h2 id="home-trip-title">{tr('home:nextShoppingTrip')}</h2>
          <Link to={`${base}/shopping`}>
            {tr('home:seeList')} <span aria-hidden="true">›</span>
          </Link>
        </div>
        {trips.isPending ? (
          <p className="muted" role="status">
            {tr('home:loadingShoppingTrips')}
          </p>
        ) : trips.isError ? (
          <Notice kind="error">{localizedError(trips.error)}</Notice>
        ) : nextTrip ? (
          <Link
            className="home-trip-link"
            to={`${base}/shopping/${nextTrip.id}`}
          >
            <span className="home-trip-visual">
              <Doodle kind="basket" />
            </span>
            <span className="home-trip-copy">
              <strong>
                {formatNumber(nextTrip._count?.entries ?? 0)}{' '}
                {tr('common:items')}
              </strong>
              <small>
                {nextTrip.store} · {formatDateOnly(nextTrip.plannedDate)}
              </small>
            </span>
            <span className="home-trip-arrow" aria-hidden="true">
              ›
            </span>
          </Link>
        ) : (
          <div className="home-trip-empty">
            <Doodle kind="basket" />
            <span>{tr('home:upcomingTripYet')}</span>
            <Link to={`${base}/shopping`}>
              {tr('home:planShopping')} <span aria-hidden="true">›</span>
            </Link>
          </div>
        )}
      </section>

      <section className="home-snapshot" aria-labelledby="home-snapshot-title">
        <div className="home-section-heading">
          <h2 id="home-snapshot-title">{tr('home:inventoryLocation')}</h2>
          <Link to={`${base}/inventory`}>{tr('home:seeAll')}</Link>
        </div>
        {snapshot.isPending ? (
          <p className="muted" role="status">
            {tr('common:loadingLocations2')}
          </p>
        ) : snapshot.isError ? (
          <Notice kind="error">
            {tr('common:locationsLoaded')} {localizedError(snapshot.error)}
          </Notice>
        ) : locationGroups.length ? (
          <div className="home-snapshot-list">
            {locationGroups.slice(0, 3).map((group) => (
              <Link
                className="home-snapshot-row"
                key={group.id}
                to={`${base}/inventory?locationId=${encodeURIComponent(group.id)}`}
              >
                <strong>{group.name}</strong>
                <span>
                  {formatNumber(group.entries.length)}{' '}
                  {tr(
                    group.entries.length === 1 ? 'common:item' : 'common:items',
                  )}
                </span>
                <span aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">{tr('home:itemsNamedLocations')}</p>
        )}
      </section>

      <section className="home-activity" aria-labelledby="home-activity-title">
        <div className="home-section-heading">
          <h2 id="home-activity-title">{tr('home:recentHouseholdActivity')}</h2>
        </div>
        {activity.isPending ? (
          <p className="muted" role="status">
            {tr('home:loadingRecentActivity')}
          </p>
        ) : activity.isError ? (
          <Notice kind="error">
            {tr('home:recentActivityLoaded')} {localizedError(activity.error)}
          </Notice>
        ) : !activity.data.items.length ? (
          <p className="muted">{tr('home:householdActivityYet')}</p>
        ) : (
          <ol className="home-activity-list">
            {activity.data.items.slice(0, 5).map((event) => {
              const actor =
                event.actorId === null
                  ? tr('home:unknownMember')
                  : event.actorId === currentUserId
                    ? tr('common:you')
                    : tr('home:householdMember');
              const content = (
                <>
                  <span className="home-activity-copy">
                    <strong>{activityTypeLabel(event)}</strong>
                    <small>
                      {[event.item?.name, activityDetail(event), actor]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  <time dateTime={event.occurredAt}>
                    {formatDate(event.occurredAt)}
                  </time>
                </>
              );
              const itemPath = event.item?.id
                ? `${base}/inventory/${event.item.id}`
                : null;
              const tripPath = event.trip?.id
                ? `${base}/shopping/${event.trip.id}`
                : null;
              return (
                <li className="home-activity-row" key={event.id}>
                  {itemPath ? (
                    <Link to={itemPath}>{content}</Link>
                  ) : tripPath ? (
                    <Link to={tripPath}>{content}</Link>
                  ) : (
                    <div>{content}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
