import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useHousehold } from '@/shared/household/HouseholdContext';
import { api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import { Notice } from '../../shared/ui/primitives';
import {
  ShoppingDraftTools,
  ShoppingManualAdd,
  ShoppingTripHeader,
} from './ShoppingTripSetup';
import { ShoppingPlans } from './ShoppingPlans';
import { ShoppingChecklist } from './ShoppingChecklist';
import { ShoppingFinishPanel } from './ShoppingFinishPanel';
import { localizedError, tr } from '../../shared/i18n';
import { plannedDateFromCycle } from './shoppingPresentation';
import { createPurchaseDrafts } from './shoppingDrafts';
import { selectShoppingPageData } from './shoppingSelectors';
import { useShoppingQueries } from './useShoppingQueries';
import { useShoppingActionFeedback } from './useShoppingActionFeedback';
import { useShoppingTripMutations } from './useShoppingTripMutations';
import { createShoppingEntryActions } from './shoppingEntryActionHandlers';
import { useShoppingFinishActions } from './useShoppingFinishActions';
import type { PurchaseDraft, Trip } from './shoppingTypes';

export function ShoppingPage() {
  const householdId = useHousehold().id;
  const { tripId } = useParams();
  const navigate = useNavigate();
  const base = `/households/${householdId}/trips`;
  const routeBase = `/households/${householdId}/shopping`;
  const {
    trips,
    trip: tripQuery,
    items,
    intelligence,
    shoppingSettings,
    locations,
  } = useShoppingQueries(householdId, tripId);
  const queryClient = useQueryClient();
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
  const [moveDestinationByEntry, setMoveDestinationByEntry] = useState<
    Record<string, string>
  >({});
  const [locallyImportedTripIds, setLocallyImportedTripIds] = useState<
    Set<string>
  >(() => new Set());
  const trip = tripQuery.data ?? null;
  const {
    busy,
    error,
    notice,
    setNotice,
    requiredLocationItemId,
    setRequiredLocationItemId,
    retryLocationId,
    setRetryLocationId,
    run,
  } = useShoppingActionFeedback(householdId);

  useEffect(() => {
    if (trip) setDrafts(createPurchaseDrafts(trip));
  }, [trip?.id]);

  function showTrip(next: Trip) {
    queryClient.setQueryData(keys.trip(householdId, next.id), next);
    setDrafts(createPurchaseDrafts(next));
    void navigate(`${routeBase}/${next.id}`);
  }

  const { createTrip, updateTrip } = useShoppingTripMutations({
    householdId,
    base,
    onTripUpdated: showTrip,
  });

  const viewModel = selectShoppingPageData({
    items: items.data ?? [],
    trips: trips.data ?? [],
    trip,
    manualItemId,
    drafts,
    locallyImportedTripIds,
  });
  const {
    unsupportedSection,
    entryMode,
    entryOpeningInfoAvailable,
    entryUsesPackages,
    available,
    eligibleDraftTrips,
    validManualSelection,
    suggestionsAlreadyImported,
    purchasedCount,
    movedCount,
    purchasedQuantityCount,
    purchasedBackupCount,
    unsavedPurchase,
  } = viewModel;
  const entryActions = createShoppingEntryActions({
    trip,
    base,
    drafts,
    run,
    updateTrip,
    setNotice,
  });
  const finishActions = useShoppingFinishActions({
    householdId,
    base,
    trip,
    requiredLocationItemId,
    retryLocationId,
    setRequiredLocationItemId,
    setRetryLocationId,
    run,
    updateTrip,
    setNotice,
  });

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
        <ShoppingPlans
          trips={trips}
          shoppingSettings={shoppingSettings}
          store={store}
          plannedDate={plannedDate}
          busy={busy}
          onOpen={(entry) =>
            void run(async () =>
              showTrip(await api<Trip>(`${base}/${entry.id}`)),
            )
          }
          onCreate={() =>
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
            })
          }
          onStoreChange={setStoreDraft}
          onPlannedDateChange={setPlannedDateDraft}
        />
      ) : (
        <>
          <ShoppingTripHeader
            trip={trip}
            routeBase={routeBase}
            purchasedCount={purchasedCount}
            onAllTrips={() => navigate(routeBase)}
          />
          <ShoppingDraftTools
            householdId={householdId}
            trip={trip}
            suggestionsAlreadyImported={suggestionsAlreadyImported}
            busy={busy}
            onImport={() =>
              void run(async () => {
                await updateTrip(`${base}/${trip.id}/suggestions`, 'POST');
                setLocallyImportedTripIds((current) =>
                  new Set(current).add(trip.id),
                );
                setNotice(tr('shopping:suggestionsImportedNotice'));
              })
            }
            onStart={() =>
              void run(async () =>
                updateTrip(`${base}/${trip.id}/start`, 'POST'),
              )
            }
          />
          <ShoppingManualAdd
            trip={trip}
            available={available}
            manualItemId={manualItemId}
            validManualSelection={validManualSelection}
            busy={busy}
            onManualItemChange={setManualItemId}
            onAddManual={() =>
              void run(async () => {
                await updateTrip(`${base}/${trip.id}/entries`, 'POST', {
                  itemId: manualItemId,
                });
                setManualItemId('');
              })
            }
          />
          <ShoppingChecklist
            trip={trip}
            unsupportedSection={unsupportedSection}
            eligibleDraftTrips={eligibleDraftTrips}
            drafts={drafts}
            setDrafts={setDrafts}
            moveDestinationByEntry={moveDestinationByEntry}
            setMoveDestinationByEntry={setMoveDestinationByEntry}
            busy={busy}
            routeBase={routeBase}
            tripsPending={trips.isPending}
            tripsError={trips.isError}
            locationsPending={locations.isPending}
            locationsError={locations.isError}
            locationOptions={locations.data}
            entryMode={entryMode}
            entryUsesPackages={entryUsesPackages}
            entryOpeningInfoAvailable={entryOpeningInfoAvailable}
            onPurchase={entryActions.purchase}
            onSkip={entryActions.skip}
            onMove={entryActions.move}
            onRemove={entryActions.remove}
          />
          <ShoppingFinishPanel
            trip={trip}
            purchasedCount={purchasedCount}
            movedCount={movedCount}
            unsavedPurchase={unsavedPurchase}
            busy={busy}
            requiredLocationItemId={requiredLocationItemId}
            retryLocationId={retryLocationId}
            onRetryLocationChange={setRetryLocationId}
            locationsError={locations.isError}
            locationsErrorValue={locations.error}
            locationsPending={locations.isPending}
            locationOptions={locations.data}
            purchasedQuantityCount={purchasedQuantityCount}
            purchasedBackupCount={purchasedBackupCount}
            onFinish={finishActions.finish}
            onConfirmLocation={finishActions.confirmLocation}
          />
        </>
      )}
    </div>
  );
}
