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
import { Notice } from '../../shared/ui/primitives';

type TripSummary = {
  id: string;
  store: string;
  plannedDate: string;
  status: 'DRAFT' | 'SHOPPING' | 'RESTOCKED';
  _count?: { entries: number };
};

type AttentionItem = NeedsAttention['items'][number];

function alertLabel(entry: AttentionItem) {
  if (entry.action === 'USE_SOON') return 'Use soon';
  if (entry.lowStockRisk === 'OUT') return 'Out of stock';
  if (entry.lowStockRisk === 'BUY') return 'Time to buy';
  if (entry.lowStockRisk === 'LOW') return 'Low stock';
  return 'Needs attention';
}

function alertTone(entry: AttentionItem) {
  if (entry.lowStockRisk === 'OUT') return 'home-pill-critical';
  if (entry.action === 'USE_SOON' || entry.lowStockRisk === 'BUY')
    return 'home-pill-soon';
  return 'home-pill-low';
}

function activityTypeLabel(event: RecentActivityEvent) {
  const labels: Record<RecentActivityEvent['type'], string> = {
    USE: 'Used',
    RESTOCK: 'Restocked',
    INITIAL_STOCK: 'Initial stock added',
    OPEN: 'Opened a package',
    FINISH_OPENED: 'Finished opened stock',
    INITIALIZE: 'Initial state recorded',
    UPDATE_LEVEL: 'Level updated',
    ADD_BACKUP: 'Backup added',
    OPEN_REFILL: 'Opened refill',
    SET_PRESENCE: 'Presence updated',
    UNDO: 'Undo',
    SHOPPING_TRIP_COMPLETED: 'Shopping trip finished',
    TRIP_STOCK_CORRECTED: 'Shopping stock check corrected',
    LOCATION_STOCK_CORRECTED: 'Location stock corrected',
  };
  return labels[event.type];
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
      return `${entry}${event.item?.primaryUnit ? ` ${event.item.primaryUnit}` : ''}`;
    if (field === 'currentLevel')
      return String(entry).replaceAll('_', ' ').toLowerCase();
    if (field === 'isPresent') return entry ? 'present' : 'absent';
    return `${entry} ${entry === 1 ? 'backup' : 'backups'}`;
  };
  const before = describe(change.before);
  const after = describe(change.after);
  return before && after ? `${before} → ${after}` : after;
}

function activityDetail(event: RecentActivityEvent) {
  if (event.isUndone) return 'Đã hoàn tác';
  if (event.type === 'UNDO')
    return event.reversesType
      ? `Reversed ${event.reversesType.replaceAll('_', ' ').toLowerCase()}`
      : 'Reversal recorded';
  if (event.type === 'SHOPPING_TRIP_COMPLETED')
    return event.trip?.store
      ? `Shopping at ${event.trip.store}`
      : 'Shopping trip completed';
  if (event.type === 'TRIP_STOCK_CORRECTED')
    return activityChangeText(event) || 'Stock observation updated';
  if (event.type === 'LOCATION_STOCK_CORRECTED') {
    const change = activityChangeText(event);
    return (
      [event.location?.name, change].filter(Boolean).join(' · ') ||
      'Stock observation updated'
    );
  }
  const change = activityChangeText(event);
  if (change) return change;
  if (event.quantity !== null)
    return `${event.quantity}${event.item?.primaryUnit ? ` ${event.item.primaryUnit}` : ''}`;
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
        throw new Error(
          'The API did not return the queried Inventory response.',
        );
      }
      return result;
    },
    enabled: !!attention.data?.items.length,
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
          Search for an item
        </label>
        <input
          id="home-search-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search for an item..."
        />
        <button type="submit" aria-label="Search inventory">
          Search
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
            <h2 id="home-attention-title">Needs attention</h2>
            <Link to={`${base}/inventory`}>
              See all <span aria-hidden="true">›</span>
            </Link>
          </div>
          {attention.isPending ? (
            <p className="muted" role="status">
              Loading what needs attention…
            </p>
          ) : attention.isError ? (
            <Notice kind="error">{attention.error.message}</Notice>
          ) : (
            <div className="home-attention-grid">
              {attention.data.items.slice(0, 2).map((entry) => {
                const match = stock.data?.items.find(
                  ({ item }) => item.id === entry.itemId,
                );
                const amount = match
                  ? match.item.trackingMode === 'QUANTITY'
                    ? match.assessment.eligibleStock === null
                      ? 'Stock unavailable'
                      : `${match.assessment.eligibleStock} ${match.item.primaryUnit} available`
                    : `${match.item.backupCount} ${match.item.backupCount === 1 ? 'backup' : 'backups'}`
                  : stock.isPending
                    ? 'Loading stock…'
                    : 'Stock unavailable';
                return (
                  <Link
                    className="home-attention-card"
                    key={entry.itemId}
                    to={`${base}/inventory/${entry.itemId}`}
                  >
                    <span className={`home-attention-pill ${alertTone(entry)}`}>
                      {alertLabel(entry)}
                    </span>
                    <span className="home-attention-body">
                      <span className="home-attention-visual">
                        <Doodle itemName={entry.name} />
                      </span>
                      <span className="home-attention-copy">
                        <strong>{entry.name}</strong>
                        <small>{amount}</small>
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="home-quick-actions" aria-label="Quick actions">
        <Link
          className="home-quick-card home-quick-use"
          to={`${base}/inventory`}
        >
          <span className="home-quick-icon">
            <Doodle kind="jar" />
          </span>
          <span>
            <strong>Use</strong>
            <small>Choose an item to use</small>
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
            <strong>Restock</strong>
            <small>Choose an item to restock</small>
          </span>
          <span className="home-quick-arrow" aria-hidden="true">
            ›
          </span>
        </Link>
      </section>

      <section className="home-trip" aria-labelledby="home-trip-title">
        <div className="home-section-heading">
          <h2 id="home-trip-title">Next shopping trip</h2>
          <Link to={`${base}/shopping`}>
            See list <span aria-hidden="true">›</span>
          </Link>
        </div>
        {trips.isPending ? (
          <p className="muted" role="status">
            Loading shopping trips…
          </p>
        ) : trips.isError ? (
          <Notice kind="error">{trips.error.message}</Notice>
        ) : nextTrip ? (
          <Link
            className="home-trip-link"
            to={`${base}/shopping/${nextTrip.id}`}
          >
            <span className="home-trip-visual">
              <Doodle kind="basket" />
            </span>
            <span className="home-trip-copy">
              <strong>{nextTrip._count?.entries ?? 0} items</strong>
              <small>
                {nextTrip.store} · {nextTrip.plannedDate.slice(0, 10)}
              </small>
            </span>
            <span className="home-trip-arrow" aria-hidden="true">
              ›
            </span>
          </Link>
        ) : (
          <div className="home-trip-empty">
            <Doodle kind="basket" />
            <span>No upcoming trip yet.</span>
            <Link to={`${base}/shopping`}>
              Plan shopping <span aria-hidden="true">›</span>
            </Link>
          </div>
        )}
      </section>

      <section className="home-activity" aria-labelledby="home-activity-title">
        <div className="home-section-heading">
          <h2 id="home-activity-title">Recent household activity</h2>
        </div>
        {activity.isPending ? (
          <p className="muted" role="status">
            Loading recent activity…
          </p>
        ) : activity.isError ? (
          <Notice kind="error">
            Recent activity could not be loaded: {activity.error.message}
          </Notice>
        ) : !activity.data.items.length ? (
          <p className="muted">No household activity yet.</p>
        ) : (
          <ol className="home-activity-list">
            {activity.data.items.slice(0, 5).map((event) => {
              const actor =
                event.actorId === null
                  ? 'Unknown member'
                  : event.actorId === currentUserId
                    ? 'You'
                    : 'Household member';
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
                    {new Date(event.occurredAt).toLocaleString()}
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
