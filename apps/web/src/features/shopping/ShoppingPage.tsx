import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useHousehold } from '../../app/useHousehold';
import {
  ApiError,
  api,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  CatalogOption,
  HouseholdShoppingSettings,
  Intelligence,
  Item,
  TrackingMode,
} from '../../shared/api/types';
import { ItemVisual, Notice } from '../../shared/ui/primitives';
import {
  shoppingSections,
  type ShoppingSection,
} from '../../shared/shoppingSections';
import { StockCheckPanel } from './StockCheckPanel';

type TripSummary = {
  id: string;
  store: string;
  plannedDate: string;
  status: 'DRAFT' | 'SHOPPING' | 'RESTOCKED';
  _count?: { entries: number };
};
type Entry = {
  id: string;
  status: 'PENDING' | 'PURCHASED' | 'SKIPPED' | 'MOVED';
  source: 'SUGGESTED' | 'MANUAL';
  priority: 'MUST_BUY' | 'SHOULD_BUY' | 'OPTIONAL';
  shoppingSection: ShoppingSection;
  suggestedQuantity: string | null;
  suggestedReason: string | null;
  actualQuantity: string | null;
  expiryDate: string | null;
  locationId?: string | null;
  location?: { id: string; name: string } | null;
  moveToTripId?: string | null;
  moveToTrip?: {
    id: string;
    store: string;
    plannedDate: string;
    status: 'DRAFT' | 'SHOPPING' | 'RESTOCKED';
  } | null;
  item: {
    id: string;
    name: string;
    primaryUnit: string;
    trackingMode?: TrackingMode;
    openedTrackingEnabled?: boolean;
    preferredRestockLocationId?: string | null;
    preferredRestockLocation?: { id: string; name: string } | null;
  };
};
type Trip = TripSummary & {
  completedAt: string | null;
  suggestionsImportedAt?: string | null;
  entries: Entry[];
};
type PurchaseDraft = {
  quantity: string;
  expiryDate: string;
  locationId: string;
};

const priorityOrder = ['MUST_BUY', 'SHOULD_BUY', 'OPTIONAL'] as const;

function priorityLabel(priority: Entry['priority']) {
  return priority === 'MUST_BUY'
    ? 'Must buy'
    : priority === 'SHOULD_BUY'
      ? 'Should buy'
      : 'Manual / optional';
}

function validPurchaseAmount(
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

function plannedDateFromCycle(days: number) {
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

export function ShoppingPage() {
  const householdId = useHousehold().id;
  const { tripId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = `/households/${householdId}/trips`;
  const routeBase = `/households/${householdId}/shopping`;
  const trips = useQuery({
    queryKey: keys.trips(householdId),
    queryFn: () => api<TripSummary[]>(base),
  });
  const tripQuery = useQuery({
    queryKey: keys.trip(householdId, tripId ?? ''),
    queryFn: () => api<Trip>(`${base}/${tripId}`),
    enabled: Boolean(tripId),
  });
  const items = useQuery({
    queryKey: keys.items(householdId),
    queryFn: () => api<Item[]>(`/households/${householdId}/items`),
  });
  const intelligence = useQuery({
    queryKey: keys.intelligence(householdId, ''),
    queryFn: () =>
      api<Intelligence>(`/households/${householdId}/stock-intelligence`),
  });
  const shoppingSettings = useQuery({
    queryKey: keys.shoppingSettings(householdId),
    queryFn: () =>
      api<HouseholdShoppingSettings>(
        `/households/${householdId}/shopping-settings`,
      ),
    enabled: !tripId,
  });
  const locations = useQuery({
    queryKey: keys.catalog(householdId, 'locations'),
    queryFn: () => api<CatalogOption[]>(`/households/${householdId}/locations`),
  });
  const [storeDraft, setStoreDraft] = useState<string | null>(null);
  const [plannedDateDraft, setPlannedDateDraft] = useState<string | null>(null);
  const store = storeDraft ?? shoppingSettings.data?.defaultStore ?? '';
  const plannedDate =
    plannedDateDraft ??
    (shoppingSettings.data
      ? plannedDateFromCycle(shoppingSettings.data.defaultShoppingCycleDays)
      : '');
  const [manualItemId, setManualItemId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, PurchaseDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requiredLocationItemId, setRequiredLocationItemId] = useState('');
  const [retryLocationId, setRetryLocationId] = useState('');
  const [moveDestinationByEntry, setMoveDestinationByEntry] = useState<
    Record<string, string>
  >({});
  const [locallyImportedTripIds, setLocallyImportedTripIds] = useState<
    Set<string>
  >(() => new Set());
  const trip = tripQuery.data ?? null;
  const unsupportedSection = trip?.entries.find(
    (entry) =>
      !shoppingSections.some(
        (section) => section.code === entry.shoppingSection,
      ),
  );
  const createTrip = useMutation({
    mutationFn: (input: { store: string; plannedDate: string }) =>
      api<TripSummary>(base, 'POST', input),
  });
  const changeTrip = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body?: object;
    }) => api<Trip>(path, method, body),
    onSuccess: async (next) => {
      queryClient.setQueryData(keys.trip(householdId, next.id), next);
      await queryClient.invalidateQueries({
        queryKey: keys.trips(householdId),
      });
    },
  });

  useEffect(() => {
    if (trip) {
      setDrafts(
        Object.fromEntries(
          trip.entries.map((entry) => [
            entry.id,
            {
              quantity: entry.actualQuantity ?? '',
              expiryDate: entry.expiryDate?.slice(0, 10) ?? '',
              locationId:
                entry.locationId ?? entry.item.preferredRestockLocationId ?? '',
            },
          ]),
        ),
      );
    }
  }, [trip?.id]);

  function showTrip(next: Trip) {
    queryClient.setQueryData(keys.trip(householdId, next.id), next);
    setDrafts(
      Object.fromEntries(
        next.entries.map((entry) => [
          entry.id,
          {
            quantity: entry.actualQuantity ?? '',
            expiryDate: entry.expiryDate?.slice(0, 10) ?? '',
            locationId:
              entry.locationId ?? entry.item.preferredRestockLocationId ?? '',
          },
        ]),
      ),
    );
    void navigate(`${routeBase}/${next.id}`);
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'DESTINATION_NOT_DRAFT') {
        setError(
          'That destination is no longer a draft. Draft trips were refreshed; choose another destination and select Move again.',
        );
        await queryClient.invalidateQueries({
          queryKey: keys.trips(householdId),
        });
      } else {
        setError(
          cause instanceof OfflineBeforeSendError
            ? cause.message
            : isMutationOutcomeUnknown(cause)
              ? "We couldn't confirm the result. Check this trip and Inventory before choosing to retry."
              : cause instanceof Error
                ? cause.message
                : 'The change was not saved.',
        );
      }
      if (
        cause instanceof ApiError &&
        cause.code === 'LOCATION_REQUIRED' &&
        cause.itemId
      ) {
        setRequiredLocationItemId(cause.itemId);
        setRetryLocationId('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateTrip(path: string, method: string, body?: object) {
    showTrip(await changeTrip.mutateAsync({ path, method, body }));
  }

  const entryMode = (entry: Entry) =>
    entry.item.trackingMode ??
    items.data?.find((item) => item.id === entry.item.id)?.trackingMode;
  const entryInventoryItem = (entry: Entry) =>
    items.data?.find((item) => item.id === entry.item.id);
  const entryOpeningInfoAvailable = (entry: Entry) =>
    typeof entry.item.openedTrackingEnabled === 'boolean' ||
    typeof entryInventoryItem(entry)?.openedTrackingEnabled === 'boolean';
  const entryUsesPackages = (entry: Entry) =>
    entry.item.openedTrackingEnabled ??
    entryInventoryItem(entry)?.openedTrackingEnabled ??
    false;
  const available = (items.data ?? []).filter(
    (item) => !trip?.entries.some((entry) => entry.item.id === item.id),
  );
  const eligibleDraftTrips =
    trips.data?.filter(
      (candidate) => candidate.status === 'DRAFT' && candidate.id !== trip?.id,
    ) ?? [];
  const validManualSelection = available.some(
    (item) => item.id === manualItemId,
  );
  const suggestionsAlreadyImported =
    Boolean(trip?.suggestionsImportedAt) ||
    Boolean(trip?.entries.some((entry) => entry.source === 'SUGGESTED')) ||
    Boolean(trip && locallyImportedTripIds.has(trip.id));
  const purchasedCount =
    trip?.entries.filter((entry) => entry.status === 'PURCHASED').length ?? 0;
  const movedCount =
    trip?.entries.filter((entry) => entry.status === 'MOVED').length ?? 0;
  const purchasedQuantityCount =
    trip?.entries.filter(
      (entry) =>
        entry.status === 'PURCHASED' && entryMode(entry) === 'QUANTITY',
    ).length ?? 0;
  const purchasedBackupCount =
    trip?.entries.filter(
      (entry) =>
        entry.status === 'PURCHASED' &&
        entryMode(entry) &&
        entryMode(entry) !== 'QUANTITY',
    ).length ?? 0;
  const unsavedPurchase =
    trip?.entries.some(
      (entry) =>
        entry.status === 'PURCHASED' &&
        (drafts[entry.id]?.quantity !== entry.actualQuantity ||
          (entryMode(entry) === 'QUANTITY' &&
            drafts[entry.id]?.expiryDate !==
              (entry.expiryDate?.slice(0, 10) ?? '')) ||
          drafts[entry.id]?.locationId !==
            (entry.locationId ?? entry.item.preferredRestockLocationId ?? '')),
    ) ?? false;

  return (
    <div className="shopping-layout">
      {!tripId && (
        <Link
          className="primary quick-purchase-entry"
          to={`${routeBase}/quick-purchase`}
        >
          <span aria-hidden="true">＋</span> Quick Purchase{' '}
          <small>Save an unplanned purchase straight to inventory</small>
        </Link>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="message success" role="status">
          {notice}
        </div>
      )}
      {tripId && trips.isError && (
        <Notice kind="error">
          Draft trips could not be refreshed: {trips.error.message}. Move is
          unavailable until the list loads.
        </Notice>
      )}
      {items.isError && (
        <Notice kind="error">
          Inventory choices could not be loaded: {items.error.message}
        </Notice>
      )}
      {intelligence.isError && !tripId && (
        <Notice kind="error">
          The default shopping date could not be loaded:{' '}
          {intelligence.error.message}
        </Notice>
      )}
      {tripId && tripQuery.isPending ? (
        <section className="card">
          <p className="muted">Loading trip…</p>
        </section>
      ) : tripId && tripQuery.isError ? (
        <Notice kind="error">{tripQuery.error.message}</Notice>
      ) : !trip ? (
        <div className="grid">
          <section className="card">
            <p className="eyebrow">Shopping trips</p>
            <h2>Your plans</h2>
            {trips.isPending ? (
              <p className="muted">Loading trips…</p>
            ) : trips.isError ? (
              <Notice kind="error">{trips.error.message}</Notice>
            ) : trips.data.length === 0 ? (
              <p className="muted">
                No trips yet. Create one for your next shop.
              </p>
            ) : (
              trips.data.map((entry) => (
                <button
                  className="row"
                  key={entry.id}
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      showTrip(await api<Trip>(`${base}/${entry.id}`)),
                    )
                  }
                >
                  <ItemVisual name={entry.store} illustrationKey="basket" />
                  <span className="item-identity">
                    <strong>{entry.store}</strong>
                    <small>
                      {entry.plannedDate.slice(0, 10)} ·{' '}
                      {entry._count?.entries ?? 0} items
                    </small>
                  </span>
                  <span className="pill">{entry.status.toLowerCase()}</span>
                </button>
              ))
            )}
          </section>
          <form
            className="card"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const created = await createTrip.mutateAsync({
                  store,
                  plannedDate,
                });
                void navigate(`${routeBase}/${created.id}`);
                await queryClient.invalidateQueries({
                  queryKey: keys.trips(householdId),
                });
                setNotice('Trip created.');
              });
            }}
          >
            <p className="eyebrow">Plan</p>
            <h2>Create a trip</h2>
            {shoppingSettings.isPending && (
              <p className="muted" role="status">
                Loading household shopping defaults…
              </p>
            )}
            {shoppingSettings.isError && (
              <Notice kind="error">
                Shopping defaults could not be loaded:{' '}
                {shoppingSettings.error.message}. Enter the store and date
                yourself, or{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => void shoppingSettings.refetch()}
                >
                  retry defaults
                </button>
                .
              </Notice>
            )}
            <label>
              Primary store
              <input
                value={store}
                onChange={(event) => setStoreDraft(event.target.value)}
                placeholder="e.g. Winmart"
                required
              />
            </label>
            <label>
              Planned date
              <input
                type="date"
                value={plannedDate}
                onChange={(event) => setPlannedDateDraft(event.target.value)}
                required
              />
            </label>
            {shoppingSettings.data && (
              <p className="muted">
                Suggested from this household's{' '}
                {`${shoppingSettings.data.defaultShoppingCycleDays}-day`} cycle
                in Asia/Ho_Chi_Minh. You can change both fields.
              </p>
            )}
            <button className="primary" disabled={busy}>
              Create trip
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="trip-header">
            <button className="link" onClick={() => navigate(routeBase)}>
              ← All trips
            </button>
            <div>
              <p className="eyebrow">
                {trip.status === 'DRAFT'
                  ? 'Plan'
                  : trip.status === 'SHOPPING'
                    ? 'Shopping mode'
                    : 'Finished'}
              </p>
              <h1>{trip.store}</h1>
              <div className="trip-header-meta">
                <p>
                  {trip.plannedDate.slice(0, 10)} · {purchasedCount} /{' '}
                  {trip.entries.length} purchased
                </p>
                <Link
                  className="secondary trip-quick-purchase"
                  to={`${routeBase}/quick-purchase`}
                >
                  Quick Purchase
                </Link>
              </div>
            </div>
          </div>
          {trip.status === 'DRAFT' &&
            (suggestionsAlreadyImported ? (
              <p className="muted stock-check-imported-note" role="status">
                This draft already has its first suggestions snapshot. A stock
                check cannot refresh that snapshot, so no recheck or re-import
                action is offered here.
              </p>
            ) : (
              <>
                <StockCheckPanel householdId={householdId} tripId={trip.id} />
                <div className="trip-tools">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await updateTrip(
                          `${base}/${trip.id}/suggestions`,
                          'POST',
                        );
                        setLocallyImportedTripIds((current) =>
                          new Set(current).add(trip.id),
                        );
                        setNotice(
                          'Suggestions imported from the current backend assessment.',
                        );
                      })
                    }
                  >
                    {busy
                      ? 'Importing…'
                      : 'Import suggestions from current stock'}
                  </button>
                </div>
              </>
            ))}
          {trip.status === 'DRAFT' && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  updateTrip(`${base}/${trip.id}/start`, 'POST'),
                )
              }
            >
              Start shopping
            </button>
          )}
          {trip.status !== 'RESTOCKED' && available.length > 0 && (
            <form
              className="card manual-add"
              onSubmit={(event) => {
                event.preventDefault();
                if (!validManualSelection) return;
                void run(async () => {
                  await updateTrip(`${base}/${trip.id}/entries`, 'POST', {
                    itemId: manualItemId,
                  });
                  setManualItemId('');
                });
              }}
            >
              <div>
                <p className="eyebrow">Add an existing item</p>
              </div>
              <select
                aria-label="Existing item"
                value={manualItemId}
                onChange={(event) => setManualItemId(event.target.value)}
                required
              >
                <option value="">Choose item</option>
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ·{' '}
                    {item.trackingMode === 'QUANTITY'
                      ? item.primaryUnit
                      : 'backup units'}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                disabled={busy || !validManualSelection}
              >
                Add
              </button>
            </form>
          )}
          <div className="trip-checklist">
            {unsupportedSection ? (
              <Notice kind="error">
                The API returned an unsupported shopping section for{' '}
                {unsupportedSection.item.name}. Reload this trip after the API
                is updated.
              </Notice>
            ) : trip.entries.length === 0 ? (
              <section className="card">
                <p className="muted">
                  The checklist is empty. Add suggestions or an existing item.
                </p>
              </section>
            ) : (
              shoppingSections.map(
                ({ code, label }: (typeof shoppingSections)[number]) => {
                  const entries = trip.entries
                    .filter((entry) => entry.shoppingSection === code)
                    .sort(
                      (left, right) =>
                        priorityOrder.indexOf(left.priority) -
                        priorityOrder.indexOf(right.priority),
                    );
                  return (
                    entries.length > 0 && (
                      <section className="card" key={code}>
                        <h3 className="shopping-section-title">{label}</h3>
                        {entries.map((entry) => {
                          const mode = entryMode(entry);
                          const packageCount = entryUsesPackages(entry);
                          const openingInfoAvailable =
                            entryOpeningInfoAvailable(entry);
                          const savedDestinationIsDraft =
                            eligibleDraftTrips.some(
                              (candidate) =>
                                candidate.id === entry.moveToTripId,
                            );
                          const selectedMoveId =
                            moveDestinationByEntry[entry.id] ??
                            (savedDestinationIsDraft
                              ? entry.moveToTripId!
                              : eligibleDraftTrips.length === 1
                                ? eligibleDraftTrips[0].id
                                : '');
                          const selectedMoveTrip = eligibleDraftTrips.find(
                            (candidate) => candidate.id === selectedMoveId,
                          );
                          const moveAlreadySaved =
                            entry.status === 'MOVED' &&
                            selectedMoveId === entry.moveToTripId;
                          return (
                            <div className="checklist-entry" key={entry.id}>
                              <div className="entry-title">
                                <span className="shopping-item-heading">
                                  <ItemVisual name={entry.item.name} />
                                  <strong>{entry.item.name}</strong>
                                </span>
                                <span
                                  className={`health ${entry.status === 'PURCHASED' ? 'health-ok' : 'health-unknown'}`}
                                >
                                  {entry.status.toLowerCase()}
                                </span>
                              </div>
                              <p className="eyebrow">
                                {priorityLabel(entry.priority)}
                              </p>
                              {entry.status === 'MOVED' && (
                                <p className="move-saved" role="status">
                                  Will move when this trip is finished
                                  {entry.moveToTrip?.store
                                    ? ` · ${entry.moveToTrip.store} (${entry.moveToTrip.plannedDate.slice(0, 10)})`
                                    : ' · selected draft trip'}
                                  .
                                </p>
                              )}
                              <p className="muted">
                                {entry.suggestedQuantity
                                  ? `Suggested ${entry.suggestedQuantity} ${entry.item.primaryUnit}`
                                  : mode === 'QUANTITY'
                                    ? `No suggested quantity · ${entry.item.primaryUnit}`
                                    : mode
                                      ? 'Choose how many backup units to buy'
                                      : 'Item mode unavailable'}
                              </p>
                              {trip.status === 'DRAFT' &&
                                entry.suggestedReason && (
                                  <p className="muted">
                                    {entry.suggestedReason}
                                  </p>
                                )}
                              {trip.status === 'SHOPPING' && !mode && (
                                <Notice kind="error">
                                  Item mode could not be loaded. Retry Inventory
                                  before recording this purchase.
                                </Notice>
                              )}
                              {trip.status === 'SHOPPING' &&
                                mode === 'QUANTITY' &&
                                !openingInfoAvailable && (
                                  <Notice kind="error">
                                    Opening policy could not be loaded. Retry
                                    Inventory before recording this quantity
                                    purchase.
                                  </Notice>
                                )}
                              {trip.status === 'SHOPPING' && mode ? (
                                <div className="purchase-controls">
                                  <label>
                                    {mode === 'QUANTITY'
                                      ? packageCount
                                        ? `Whole packages bought (${entry.item.primaryUnit})`
                                        : `Actual bought (${entry.item.primaryUnit})`
                                      : 'Backup units bought'}
                                    <input
                                      type="number"
                                      disabled={
                                        mode === 'QUANTITY' &&
                                        !openingInfoAvailable
                                      }
                                      min={
                                        mode === 'QUANTITY' && !packageCount
                                          ? '0.000001'
                                          : '1'
                                      }
                                      max={
                                        mode === 'QUANTITY'
                                          ? undefined
                                          : '2147483647'
                                      }
                                      step={
                                        mode === 'QUANTITY' && !packageCount
                                          ? '0.000001'
                                          : '1'
                                      }
                                      inputMode={
                                        mode === 'QUANTITY' && !packageCount
                                          ? 'decimal'
                                          : 'numeric'
                                      }
                                      value={drafts[entry.id]?.quantity ?? ''}
                                      onChange={(event) =>
                                        setDrafts((current) => ({
                                          ...current,
                                          [entry.id]: {
                                            quantity: event.target.value,
                                            expiryDate:
                                              current[entry.id]?.expiryDate ??
                                              '',
                                            locationId:
                                              current[entry.id]?.locationId ??
                                              entry.locationId ??
                                              entry.item
                                                .preferredRestockLocationId ??
                                              '',
                                          },
                                        }))
                                      }
                                      placeholder={
                                        mode === 'QUANTITY'
                                          ? packageCount
                                            ? 'Enter whole package count'
                                            : 'Enter actual quantity'
                                          : 'Enter whole backup units'
                                      }
                                    />
                                  </label>
                                  {mode === 'QUANTITY' && packageCount && (
                                    <p className="muted">
                                      This item tracks unopened stock by whole
                                      package count.
                                    </p>
                                  )}
                                  {mode === 'QUANTITY' && (
                                    <label>
                                      Expiry <em>optional</em>
                                      <input
                                        type="date"
                                        value={
                                          drafts[entry.id]?.expiryDate ?? ''
                                        }
                                        onChange={(event) =>
                                          setDrafts((current) => ({
                                            ...current,
                                            [entry.id]: {
                                              quantity:
                                                current[entry.id]?.quantity ??
                                                '',
                                              expiryDate: event.target.value,
                                              locationId:
                                                current[entry.id]?.locationId ??
                                                entry.locationId ??
                                                entry.item
                                                  .preferredRestockLocationId ??
                                                '',
                                            },
                                          }))
                                        }
                                      />
                                    </label>
                                  )}
                                  {mode === 'QUANTITY' && (
                                    <label>
                                      Location for this purchase
                                      <select
                                        value={
                                          drafts[entry.id]?.locationId ?? ''
                                        }
                                        disabled={
                                          locations.isPending ||
                                          locations.isError ||
                                          busy
                                        }
                                        onChange={(event) =>
                                          setDrafts((current) => ({
                                            ...current,
                                            [entry.id]: {
                                              quantity:
                                                current[entry.id]?.quantity ??
                                                '',
                                              expiryDate:
                                                current[entry.id]?.expiryDate ??
                                                '',
                                              locationId: event.target.value,
                                            },
                                          }))
                                        }
                                      >
                                        <option value="">
                                          Choose when needed
                                        </option>
                                        {locations.data?.map((option) => (
                                          <option
                                            key={option.id}
                                            value={option.id}
                                          >
                                            {option.name}
                                            {option.id ===
                                            entry.item.preferredRestockLocation
                                              ?.id
                                              ? ' · preferred'
                                              : ''}
                                          </option>
                                        ))}
                                      </select>
                                      {entry.item.preferredRestockLocation
                                        ?.name && (
                                        <small className="muted">
                                          Preferred for future stock writes:{' '}
                                          {
                                            entry.item.preferredRestockLocation
                                              .name
                                          }
                                          ; existing batches may be elsewhere.
                                        </small>
                                      )}
                                    </label>
                                  )}
                                  <button
                                    className="primary"
                                    disabled={
                                      busy ||
                                      (mode === 'QUANTITY' &&
                                        !openingInfoAvailable) ||
                                      !validPurchaseAmount(
                                        drafts[entry.id]?.quantity ?? '',
                                        mode,
                                        packageCount,
                                      )
                                    }
                                    onClick={() =>
                                      void run(async () =>
                                        updateTrip(
                                          `${base}/${trip.id}/entries/${entry.id}`,
                                          'PATCH',
                                          {
                                            status: 'PURCHASED',
                                            actualQuantity:
                                              drafts[entry.id]?.quantity,
                                            ...(mode === 'QUANTITY'
                                              ? {
                                                  expiryDate:
                                                    drafts[entry.id]
                                                      ?.expiryDate || null,
                                                  locationId:
                                                    drafts[entry.id]
                                                      ?.locationId || null,
                                                }
                                              : {}),
                                          },
                                        ),
                                      )
                                    }
                                  >
                                    {entry.status === 'PURCHASED'
                                      ? 'Save purchase'
                                      : 'Mark purchased'}
                                  </button>
                                  <button
                                    className="secondary"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(async () =>
                                        updateTrip(
                                          `${base}/${trip.id}/entries/${entry.id}`,
                                          'PATCH',
                                          {
                                            status:
                                              entry.status === 'SKIPPED'
                                                ? 'PENDING'
                                                : 'SKIPPED',
                                          },
                                        ),
                                      )
                                    }
                                  >
                                    {entry.status === 'SKIPPED'
                                      ? 'Leave pending'
                                      : 'Skip'}
                                  </button>
                                  {eligibleDraftTrips.length > 1 && (
                                    <label className="move-trip-choice">
                                      Move to draft trip
                                      <select
                                        aria-label={`Destination trip for ${entry.item.name}`}
                                        value={selectedMoveId}
                                        disabled={busy}
                                        onChange={(event) =>
                                          setMoveDestinationByEntry(
                                            (current) => ({
                                              ...current,
                                              [entry.id]: event.target.value,
                                            }),
                                          )
                                        }
                                      >
                                        <option value="">
                                          Choose a draft trip
                                        </option>
                                        {eligibleDraftTrips.map((candidate) => (
                                          <option
                                            key={candidate.id}
                                            value={candidate.id}
                                          >
                                            {candidate.store} ·{' '}
                                            {candidate.plannedDate.slice(0, 10)}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  )}
                                  {trips.isPending ? (
                                    <p className="muted">
                                      Loading draft trips…
                                    </p>
                                  ) : trips.isError ? null : eligibleDraftTrips.length ===
                                    0 ? (
                                    <div className="move-no-drafts">
                                      <p className="muted">
                                        Create a draft trip before moving this
                                        item.
                                      </p>
                                      <Link
                                        className="secondary"
                                        to={routeBase}
                                      >
                                        Create a draft trip
                                      </Link>
                                    </div>
                                  ) : (
                                    <button
                                      className="secondary"
                                      disabled={
                                        busy ||
                                        !selectedMoveTrip ||
                                        moveAlreadySaved
                                      }
                                      onClick={() =>
                                        void run(async () => {
                                          if (!selectedMoveTrip) return;
                                          await updateTrip(
                                            `${base}/${trip.id}/entries/${entry.id}`,
                                            'PATCH',
                                            {
                                              status: 'MOVED',
                                              destinationTripId:
                                                selectedMoveTrip.id,
                                            },
                                          );
                                          setNotice(
                                            `Move saved for ${entry.item.name}. It will move when this trip is finished.`,
                                          );
                                        })
                                      }
                                    >
                                      {moveAlreadySaved
                                        ? 'Move saved'
                                        : entry.status === 'MOVED'
                                          ? 'Change destination'
                                          : eligibleDraftTrips.length === 1
                                            ? `Move to ${eligibleDraftTrips[0].store}`
                                            : 'Move to next trip'}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                trip.status === 'RESTOCKED' && (
                                  <p className="muted">
                                    {entry.status === 'PURCHASED'
                                      ? mode === 'QUANTITY'
                                        ? `Bought ${entry.actualQuantity} ${entry.item.primaryUnit}${entry.expiryDate ? ` · expires ${entry.expiryDate.slice(0, 10)}` : ''}`
                                        : mode
                                          ? `Bought ${entry.actualQuantity} backup ${entry.actualQuantity === '1' ? 'unit' : 'units'} · current item unchanged`
                                          : 'Purchase recorded; item mode unavailable.'
                                      : entry.status === 'MOVED'
                                        ? `Moved to ${entry.moveToTrip?.store ?? 'the selected draft trip'}; carryover added no stock.`
                                        : 'Not purchased; no stock added.'}
                                  </p>
                                )
                              )}
                              {trip.status !== 'RESTOCKED' && (
                                <details>
                                  <summary>Remove entry</summary>
                                  <p className="muted">
                                    Remove only {entry.item.name} from this
                                    trip. Stock and the item remain unchanged.
                                  </p>
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(async () => {
                                        await updateTrip(
                                          `${base}/${trip.id}/entries/${entry.id}`,
                                          'DELETE',
                                        );
                                        setNotice(
                                          `${entry.item.name} removed from this trip.`,
                                        );
                                      })
                                    }
                                  >
                                    Confirm removal of {entry.item.name}
                                  </button>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </section>
                    )
                  );
                },
              )
            )}
          </div>
          {trip.status === 'SHOPPING' && (
            <section className="card finish-panel">
              <div>
                <h2>Finish shopping</h2>
                <p className="muted">
                  Only the {purchasedCount} purchased{' '}
                  {purchasedCount === 1 ? 'item' : 'items'} with saved actual
                  amounts will be added to inventory. Backup purchases increase
                  backup count without opening a refill. Pending entries become
                  skipped.
                  {movedCount > 0 &&
                    ` ${movedCount} moved ${movedCount === 1 ? 'item is' : 'items are'} carried into selected drafts without adding stock.`}
                  {unsavedPurchase && ' Save edited purchases first.'}
                </p>
              </div>
              <button
                className="primary"
                disabled={busy || unsavedPurchase}
                onClick={() =>
                  void run(async () => {
                    await updateTrip(`${base}/${trip.id}/finish`, 'POST');
                    setNotice(
                      'Shopping finished. Purchased items were recorded.',
                    );
                    await queryClient.invalidateQueries({
                      queryKey: keys.household(householdId),
                      refetchType: 'all',
                    });
                  })
                }
              >
                Finish shopping
              </button>
              {requiredLocationItemId && (
                <div className="location-retry-panel">
                  <Notice kind="error">
                    The API requires a location for item{' '}
                    {requiredLocationItemId}. No trip stock was committed.
                    Choose a household location, save that entry location, then
                    explicitly retry Finish.
                  </Notice>
                  {locations.isError && (
                    <Notice kind="error">
                      Household locations could not be loaded:{' '}
                      {locations.error.message}
                    </Notice>
                  )}
                  <label>
                    Location for item {requiredLocationItemId}
                    <select
                      value={retryLocationId}
                      onChange={(event) =>
                        setRetryLocationId(event.target.value)
                      }
                      disabled={
                        busy || locations.isPending || locations.isError
                      }
                    >
                      <option value="">Choose a location</option>
                      {locations.data?.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary"
                    disabled={busy || !retryLocationId || locations.isError}
                    onClick={() =>
                      void run(async () => {
                        const entry = trip.entries.find(
                          (candidate) =>
                            candidate.item.id === requiredLocationItemId,
                        );
                        if (!entry)
                          throw new Error(
                            'The affected trip item is no longer available. Reload the trip before retrying.',
                          );
                        if (
                          entry.status !== 'PURCHASED' ||
                          !entry.actualQuantity
                        ) {
                          throw new Error(
                            'The purchase details changed. Reload the trip before retrying.',
                          );
                        }
                        await updateTrip(
                          `${base}/${trip.id}/entries/${entry.id}`,
                          'PATCH',
                          {
                            status: 'PURCHASED',
                            actualQuantity: entry.actualQuantity,
                            expiryDate: entry.expiryDate?.slice(0, 10) ?? null,
                            locationId: retryLocationId,
                          },
                        );
                        await updateTrip(`${base}/${trip.id}/finish`, 'POST');
                        setRequiredLocationItemId('');
                        setRetryLocationId('');
                        setNotice(
                          'Shopping finished. Purchased items were recorded.',
                        );
                        await queryClient.invalidateQueries({
                          queryKey: keys.household(householdId),
                          refetchType: 'all',
                        });
                      })
                    }
                  >
                    Confirm location and retry Finish
                  </button>
                </div>
              )}
            </section>
          )}
          {trip.status === 'RESTOCKED' && (
            <div className="message success" role="status">
              Finished.{' '}
              {purchasedQuantityCount > 0 && 'Quantity purchases added stock. '}
              {purchasedBackupCount > 0 &&
                'Backup purchases increased backup count without changing the current level or presence. '}
              {purchasedCount === 0 && 'No stock was added. '}
              Skipped and moved items did not add stock.
            </div>
          )}
        </>
      )}
    </div>
  );
}
