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

import { tr } from '../../shared/i18n';
import {
  localizedError,
  localizedEnum,
  formatNumber,
  formatDateOnly,
} from '../../shared/i18n';
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
    ? tr('shopping:must')
    : priority === 'SHOULD_BUY'
      ? tr('shopping:should')
      : tr('common:optional');
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
        setError(tr('shopping:destinationNoLongerDraft'));
        await queryClient.invalidateQueries({
          queryKey: keys.trips(householdId),
        });
      } else {
        setError(
          cause instanceof OfflineBeforeSendError
            ? localizedError(cause)
            : isMutationOutcomeUnknown(cause)
              ? tr('shopping:tripChangeOutcomeUncertain')
              : cause instanceof Error
                ? localizedError(cause)
                : 'common:changeSaved',
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
          <span aria-hidden="true">ï¼‹</span> {tr('shopping:quickPurchase')}{' '}
          <small>{tr('shopping:saveUnplannedPurchase')}</small>
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
          {tr('shopping:draftTripsRefreshed')} {localizedError(trips.error)}
          {tr('shopping:moveUnavailableUntil')}
        </Notice>
      )}
      {items.isError && (
        <Notice kind="error">
          {tr('shopping:inventoryChoicesLoaded')} {localizedError(items.error)}
        </Notice>
      )}
      {intelligence.isError && !tripId && (
        <Notice kind="error">
          {tr('shopping:defaultShoppingDate')}{' '}
          {localizedError(intelligence.error)}
        </Notice>
      )}
      {tripId && tripQuery.isPending ? (
        <section className="card">
          <p className="muted">{tr('common:loadingTrip')}</p>
        </section>
      ) : tripId && tripQuery.isError ? (
        <Notice kind="error">{localizedError(tripQuery.error)}</Notice>
      ) : !trip ? (
        <div className="grid">
          <section className="card">
            <p className="eyebrow">{tr('common:shoppingTrips')}</p>
            <h2>{tr('common:plans')}</h2>
            {trips.isPending ? (
              <p className="muted">{tr('common:loadingTrips')}</p>
            ) : trips.isError ? (
              <Notice kind="error">{localizedError(trips.error)}</Notice>
            ) : trips.data.length === 0 ? (
              <p className="muted">{tr('common:tripsYetCreate')}</p>
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
                      {formatDateOnly(entry.plannedDate)} ·{' '}
                      {formatNumber(entry._count?.entries ?? 0)}{' '}
                      {tr('common:items')}
                    </small>
                  </span>
                  <span className="pill">{localizedEnum(entry.status)}</span>
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
            <p className="eyebrow">{tr('common:plan')}</p>
            <h2>{tr('common:createTrip')}</h2>
            {shoppingSettings.isPending && (
              <p className="muted" role="status">
                {tr('shopping:loadingHouseholdShopping')}
              </p>
            )}
            {shoppingSettings.isError && (
              <Notice kind="error">
                {tr('common:shoppingDefaultsLoaded')}{' '}
                {localizedError(shoppingSettings.error)}
                {tr('shopping:enterStoreDate')}{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => void shoppingSettings.refetch()}
                >
                  {tr('shopping:retryDefaults2')}
                </button>
                .
              </Notice>
            )}
            <label>
              {tr('common:primaryStore')}
              <input
                value={store}
                onChange={(event) => setStoreDraft(event.target.value)}
                placeholder={tr('shopping:storeExample')}
                required
              />
            </label>
            <label>
              {tr('common:plannedDate')}
              <input
                type="date"
                value={plannedDate}
                onChange={(event) => setPlannedDateDraft(event.target.value)}
                required
              />
            </label>
            {shoppingSettings.data && (
              <p className="muted">
                {tr('shopping:suggestedHouseholdS')}{' '}
                {`${formatNumber(shoppingSettings.data.defaultShoppingCycleDays)}-day`}{' '}
                {tr('shopping:cycleAsiaHo')}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {tr('common:createTrip2')}
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="trip-header">
            <button className="link" onClick={() => navigate(routeBase)}>
              {tr('common:allTrips')}
            </button>
            <div>
              <p className="eyebrow">
                {trip.status === 'DRAFT'
                  ? tr('common:plan')
                  : trip.status === 'SHOPPING'
                    ? tr('common:shoppingMode')
                    : tr('common:finished')}
              </p>
              <h1>{trip.store}</h1>
              <div className="trip-header-meta">
                <p>
                  {formatDateOnly(trip.plannedDate)} · {purchasedCount} /{' '}
                  {trip.entries.length} {tr('common:purchased2')}
                </p>
                <Link
                  className="secondary trip-quick-purchase"
                  to={`${routeBase}/quick-purchase`}
                >
                  {tr('shopping:quickPurchase')}
                </Link>
              </div>
            </div>
          </div>
          {trip.status === 'DRAFT' &&
            (suggestionsAlreadyImported ? (
              <p className="muted stock-check-imported-note" role="status">
                {tr('shopping:draftAlreadyHas')}
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
                        setNotice(tr('shopping:suggestionsImportedNotice'));
                      })
                    }
                  >
                    {busy
                      ? tr('shopping:importing')
                      : tr('shopping:importSuggestionsCurrent')}
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
              {tr('common:startShopping')}
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
                <p className="eyebrow">{tr('common:addExistingItem')}</p>
              </div>
              <select
                aria-label={tr('shopping:existingItem')}
                value={manualItemId}
                onChange={(event) => setManualItemId(event.target.value)}
                required
              >
                <option value="">{tr('common:chooseItem')}</option>
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ·{' '}
                    {item.trackingMode === 'QUANTITY'
                      ? item.primaryUnit
                      : tr('shopping:backupUnits')}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                disabled={busy || !validManualSelection}
              >
                {tr('common:add')}
              </button>
            </form>
          )}
          <div className="trip-checklist">
            {unsupportedSection ? (
              <Notice kind="error">
                {tr('shopping:apiReturnedUnsupported')}{' '}
                {unsupportedSection.item.name}
                {tr('shopping:reloadTripApi')}
              </Notice>
            ) : trip.entries.length === 0 ? (
              <section className="card">
                <p className="muted">{tr('common:checklistEmptyAdd')}</p>
              </section>
            ) : (
              shoppingSections.map(
                ({ code }: (typeof shoppingSections)[number]) => {
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
                        <h3 className="shopping-section-title">
                          {localizedEnum(code)}
                        </h3>
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
                                  {localizedEnum(entry.status)}
                                </span>
                              </div>
                              <p className="eyebrow">
                                {priorityLabel(entry.priority)}
                              </p>
                              {entry.status === 'MOVED' && (
                                <p className="move-saved" role="status">
                                  {tr('shopping:moveTripFinished')}
                                  {entry.moveToTrip?.store
                                    ? ` · ${entry.moveToTrip.store} (${formatDateOnly(entry.moveToTrip.plannedDate)})`
                                    : ` · ${tr('shopping:selectedDraftTripLabel')}`}
                                  .
                                </p>
                              )}
                              <p className="muted">
                                {entry.suggestedQuantity
                                  ? tr('shopping:suggested', {
                                      quantity: formatNumber(
                                        entry.suggestedQuantity,
                                      ),
                                      unit: entry.item.primaryUnit,
                                    })
                                  : mode === 'QUANTITY'
                                    ? `${tr('shopping:noSuggestedQuantity')} · ${entry.item.primaryUnit}`
                                    : mode
                                      ? tr('shopping:chooseHowMany')
                                      : tr('shopping:itemModeUnavailable')}
                              </p>
                              {trip.status === 'DRAFT' &&
                                entry.suggestedReason && (
                                  <p className="muted">
                                    {entry.suggestedReason}
                                  </p>
                                )}
                              {trip.status === 'SHOPPING' && !mode && (
                                <Notice kind="error">
                                  {tr('shopping:itemModeLoaded')}
                                </Notice>
                              )}
                              {trip.status === 'SHOPPING' &&
                                mode === 'QUANTITY' &&
                                !openingInfoAvailable && (
                                  <Notice kind="error">
                                    {tr('shopping:openingPolicyLoaded')}
                                  </Notice>
                                )}
                              {trip.status === 'SHOPPING' && mode ? (
                                <div className="purchase-controls">
                                  <label>
                                    {mode === 'QUANTITY'
                                      ? packageCount
                                        ? `Whole packages bought (${entry.item.primaryUnit})`
                                        : `Actual bought (${entry.item.primaryUnit})`
                                      : tr('shopping:backupUnitsBought')}
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
                                            ? tr(
                                                'shopping:enterWholePackageCount',
                                              )
                                            : tr(
                                                'shopping:enterActualQuantityPrompt',
                                              )
                                          : tr('shopping:enterWholeBackupUnits')
                                      }
                                    />
                                  </label>
                                  {mode === 'QUANTITY' && packageCount && (
                                    <p className="muted">
                                      {tr('shopping:itemTracksUnopened')}
                                    </p>
                                  )}
                                  {mode === 'QUANTITY' && (
                                    <label>
                                      {tr('common:expiry')}{' '}
                                      <em>{tr('common:optional2')}</em>
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
                                      {tr('shopping:locationPurchase')}
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
                                          {tr('shopping:chooseNeeded')}
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
                                              ? ` · ${tr('common:preferred')}`
                                              : ''}
                                          </option>
                                        ))}
                                      </select>
                                      {entry.item.preferredRestockLocation
                                        ?.name && (
                                        <small className="muted">
                                          {tr('shopping:preferredFutureStock')}{' '}
                                          {
                                            entry.item.preferredRestockLocation
                                              .name
                                          }
                                          {tr(
                                            'shopping:existingBatchesElsewhere',
                                          )}
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
                                      ? tr('common:savePurchase')
                                      : tr('common:markPurchased')}
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
                                      ? tr('common:leavePending')
                                      : tr('common:skip')}
                                  </button>
                                  {eligibleDraftTrips.length > 1 && (
                                    <label className="move-trip-choice">
                                      {tr('shopping:moveDraftTrip')}
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
                                          {tr('shopping:chooseDraftTrip')}
                                        </option>
                                        {eligibleDraftTrips.map((candidate) => (
                                          <option
                                            key={candidate.id}
                                            value={candidate.id}
                                          >
                                            {candidate.store} ·{' '}
                                            {formatDateOnly(
                                              candidate.plannedDate,
                                            )}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  )}
                                  {trips.isPending ? (
                                    <p className="muted">
                                      {tr('shopping:loadingDraftTrips')}
                                    </p>
                                  ) : trips.isError ? null : eligibleDraftTrips.length ===
                                    0 ? (
                                    <div className="move-no-drafts">
                                      <p className="muted">
                                        {tr('shopping:createDraftTrip2')}
                                      </p>
                                      <Link
                                        className="secondary"
                                        to={routeBase}
                                      >
                                        {tr('shopping:createDraftTrip')}
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
                                            tr('shopping:moveSavedNotice', {
                                              item: entry.item.name,
                                            }),
                                          );
                                        })
                                      }
                                    >
                                      {moveAlreadySaved
                                        ? tr('shopping:moveSaved')
                                        : entry.status === 'MOVED'
                                          ? tr('shopping:changeDestination')
                                          : eligibleDraftTrips.length === 1
                                            ? `Move to ${eligibleDraftTrips[0].store}`
                                            : tr('shopping:moveNextTrip')}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                trip.status === 'RESTOCKED' && (
                                  <p className="muted">
                                    {entry.status === 'PURCHASED'
                                      ? mode === 'QUANTITY'
                                        ? tr('shopping:bought', {
                                            quantity:
                                              entry.actualQuantity === null
                                                ? '\u2014'
                                                : formatNumber(
                                                    entry.actualQuantity,
                                                  ),
                                            unit: entry.item.primaryUnit,
                                            expiry: entry.expiryDate
                                              ? tr('common:expires2', {
                                                  date: formatDateOnly(
                                                    entry.expiryDate,
                                                  ),
                                                })
                                              : '',
                                          })
                                        : mode
                                          ? tr(
                                              entry.actualQuantity === '1'
                                                ? 'shopping:boughtBackupUnit'
                                                : 'shopping:boughtBackupUnits',
                                              {
                                                quantity:
                                                  entry.actualQuantity === null
                                                    ? '\u2014'
                                                    : formatNumber(
                                                        entry.actualQuantity,
                                                      ),
                                              },
                                            )
                                          : tr('shopping:purchaseRecordedItem')
                                      : entry.status === 'MOVED'
                                        ? tr('shopping:movedCarryoverAdded', {
                                            trip:
                                              entry.moveToTrip?.store ??
                                              tr('shopping:selectedDraftTrip'),
                                          })
                                        : tr('common:purchasedStockAdded')}
                                  </p>
                                )
                              )}
                              {trip.status !== 'RESTOCKED' && (
                                <details>
                                  <summary>
                                    {tr('shopping:removeEntry')}
                                  </summary>
                                  <p className="muted">
                                    {tr('shopping:removeOnly')}{' '}
                                    {entry.item.name}{' '}
                                    {tr('shopping:tripStockItem')}
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
                                          tr('shopping:itemRemovedNotice', {
                                            item: entry.item.name,
                                          }),
                                        );
                                      })
                                    }
                                  >
                                    {tr('shopping:confirmRemoval2')}{' '}
                                    {entry.item.name}
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
                <h2>{tr('common:finishShopping')}</h2>
                <p className="muted">
                  {tr('common:only')} {purchasedCount} {tr('common:purchased2')}{' '}
                  {purchasedCount === 1
                    ? tr('common:item')
                    : tr('common:items')}{' '}
                  {tr('shopping:savedActualAmounts')}
                  {movedCount > 0 &&
                    ` ${movedCount} ${tr(movedCount === 1 ? 'shopping:movedItemCarried' : 'shopping:movedItemsCarried')}`}
                  {unsavedPurchase && ` ${tr('shopping:saveEditedPurchases')}`}
                </p>
              </div>
              <button
                className="primary"
                disabled={busy || unsavedPurchase}
                onClick={() =>
                  void run(async () => {
                    await updateTrip(`${base}/${trip.id}/finish`, 'POST');
                    setNotice(tr('shopping:shoppingFinishedNotice'));
                    await queryClient.invalidateQueries({
                      queryKey: keys.household(householdId),
                      refetchType: 'all',
                    });
                  })
                }
              >
                {tr('common:finishShopping')}
              </button>
              {requiredLocationItemId && (
                <div className="location-retry-panel">
                  <Notice kind="error">
                    {tr('shopping:apiRequiresLocation')}{' '}
                    {requiredLocationItemId}
                    {tr('shopping:tripStockCommitted')}
                  </Notice>
                  {locations.isError && (
                    <Notice kind="error">
                      {tr('common:householdLocationsLoaded')}{' '}
                      {localizedError(locations.error)}
                    </Notice>
                  )}
                  <label>
                    {tr('shopping:locationItem')} {requiredLocationItemId}
                    <select
                      value={retryLocationId}
                      onChange={(event) =>
                        setRetryLocationId(event.target.value)
                      }
                      disabled={
                        busy || locations.isPending || locations.isError
                      }
                    >
                      <option value="">{tr('common:chooseLocation')}</option>
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
                          throw new Error(tr('shopping:tripItemUnavailable'));
                        if (
                          entry.status !== 'PURCHASED' ||
                          !entry.actualQuantity
                        ) {
                          throw new Error(
                            tr('shopping:purchaseDetailsChanged'),
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
                        setNotice(tr('shopping:shoppingFinishedNotice'));
                        await queryClient.invalidateQueries({
                          queryKey: keys.household(householdId),
                          refetchType: 'all',
                        });
                      })
                    }
                  >
                    {tr('common:confirmLocationRetry')}
                  </button>
                </div>
              )}
            </section>
          )}
          {trip.status === 'RESTOCKED' && (
            <div className="message success" role="status">
              {tr('shopping:finished2')}{' '}
              {purchasedQuantityCount > 0 &&
                `${tr('shopping:quantityPurchasesAdded')} `}
              {purchasedBackupCount > 0 &&
                `${tr('shopping:backupPurchasesIncreased')} `}
              {purchasedCount === 0 && `${tr('shopping:stockAdded')} `}
              {tr('shopping:skippedMovedItems')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
