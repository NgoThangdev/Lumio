import type { Dispatch, SetStateAction } from 'react';
import { Link } from 'react-router';
import type { CatalogOption, TrackingMode } from '@/shared/api/types';
import { formatDateOnly, tr } from '@/shared/i18n';
import { validPurchaseAmount } from './shoppingPresentation';
import type { Entry, PurchaseDraft, TripSummary } from './shoppingTypes';

export function ShoppingEntryActions({
  entry,
  mode,
  packageCount,
  openingInfoAvailable,
  eligibleDraftTrips,
  drafts,
  setDrafts,
  moveDestinationByEntry,
  setMoveDestinationByEntry,
  busy,
  routeBase,
  tripsPending,
  tripsError,
  locationsPending,
  locationsError,
  locationOptions,
  onPurchase,
  onSkip,
  onMove,
}: {
  entry: Entry;
  mode: TrackingMode;
  packageCount: boolean;
  openingInfoAvailable: boolean;
  eligibleDraftTrips: TripSummary[];
  drafts: Record<string, PurchaseDraft>;
  setDrafts: Dispatch<SetStateAction<Record<string, PurchaseDraft>>>;
  moveDestinationByEntry: Record<string, string>;
  setMoveDestinationByEntry: Dispatch<SetStateAction<Record<string, string>>>;
  busy: boolean;
  routeBase: string;
  tripsPending: boolean;
  tripsError: boolean;
  locationsPending: boolean;
  locationsError: boolean;
  locationOptions?: CatalogOption[];
  onPurchase: (entry: Entry, mode: TrackingMode) => void;
  onSkip: (entry: Entry) => void;
  onMove: (entry: Entry, destination?: TripSummary) => void;
}) {
  const savedDestinationIsDraft = eligibleDraftTrips.some(
    (candidate) => candidate.id === entry.moveToTripId,
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
    entry.status === 'MOVED' && selectedMoveId === entry.moveToTripId;
  return (
    <div className="purchase-controls">
      <label>
        {mode === 'QUANTITY'
          ? packageCount
            ? `Whole packages bought (${entry.item.primaryUnit})`
            : `Actual bought (${entry.item.primaryUnit})`
          : tr('shopping:backupUnitsBought')}
        <input
          type="number"
          disabled={mode === 'QUANTITY' && !openingInfoAvailable}
          min={mode === 'QUANTITY' && !packageCount ? '0.000001' : '1'}
          max={mode === 'QUANTITY' ? undefined : '2147483647'}
          step={mode === 'QUANTITY' && !packageCount ? '0.000001' : '1'}
          inputMode={
            mode === 'QUANTITY' && !packageCount ? 'decimal' : 'numeric'
          }
          value={drafts[entry.id]?.quantity ?? ''}
          onChange={(event) =>
            setDrafts((current) => ({
              ...current,
              [entry.id]: {
                quantity: event.target.value,
                expiryDate: current[entry.id]?.expiryDate ?? '',
                locationId:
                  current[entry.id]?.locationId ??
                  entry.locationId ??
                  entry.item.preferredRestockLocationId ??
                  '',
              },
            }))
          }
          placeholder={
            mode === 'QUANTITY'
              ? packageCount
                ? tr('shopping:enterWholePackageCount')
                : tr('shopping:enterActualQuantityPrompt')
              : tr('shopping:enterWholeBackupUnits')
          }
        />
      </label>
      {mode === 'QUANTITY' && packageCount && (
        <p className="muted">{tr('shopping:itemTracksUnopened')}</p>
      )}
      {mode === 'QUANTITY' && (
        <label>
          {tr('common:expiry')} <em>{tr('common:optional2')}</em>
          <input
            type="date"
            value={drafts[entry.id]?.expiryDate ?? ''}
            onChange={(event) =>
              setDrafts((current) => ({
                ...current,
                [entry.id]: {
                  quantity: current[entry.id]?.quantity ?? '',
                  expiryDate: event.target.value,
                  locationId:
                    current[entry.id]?.locationId ??
                    entry.locationId ??
                    entry.item.preferredRestockLocationId ??
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
            value={drafts[entry.id]?.locationId ?? ''}
            disabled={locationsPending || locationsError || busy}
            onChange={(event) =>
              setDrafts((current) => ({
                ...current,
                [entry.id]: {
                  quantity: current[entry.id]?.quantity ?? '',
                  expiryDate: current[entry.id]?.expiryDate ?? '',
                  locationId: event.target.value,
                },
              }))
            }
          >
            <option value="">{tr('shopping:chooseNeeded')}</option>
            {locationOptions?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.id === entry.item.preferredRestockLocation?.id
                  ? ` · ${tr('common:preferred')}`
                  : ''}
              </option>
            ))}
          </select>
          {entry.item.preferredRestockLocation?.name && (
            <small className="muted">
              {tr('shopping:preferredFutureStock')}{' '}
              {entry.item.preferredRestockLocation.name}
              {tr('shopping:existingBatchesElsewhere')}
            </small>
          )}
        </label>
      )}
      <button
        className="primary"
        disabled={
          busy ||
          (mode === 'QUANTITY' && !openingInfoAvailable) ||
          !validPurchaseAmount(
            drafts[entry.id]?.quantity ?? '',
            mode,
            packageCount,
          )
        }
        onClick={() => onPurchase(entry, mode)}
      >
        {entry.status === 'PURCHASED'
          ? tr('common:savePurchase')
          : tr('common:markPurchased')}
      </button>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => onSkip(entry)}
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
              setMoveDestinationByEntry((current) => ({
                ...current,
                [entry.id]: event.target.value,
              }))
            }
          >
            <option value="">{tr('shopping:chooseDraftTrip')}</option>
            {eligibleDraftTrips.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.store} · {formatDateOnly(candidate.plannedDate)}
              </option>
            ))}
          </select>
        </label>
      )}
      {tripsPending ? (
        <p className="muted">{tr('shopping:loadingDraftTrips')}</p>
      ) : tripsError ? null : eligibleDraftTrips.length === 0 ? (
        <div className="move-no-drafts">
          <p className="muted">{tr('shopping:createDraftTrip2')}</p>
          <Link className="secondary" to={routeBase}>
            {tr('shopping:createDraftTrip')}
          </Link>
        </div>
      ) : (
        <button
          className="secondary"
          disabled={busy || !selectedMoveTrip || moveAlreadySaved}
          onClick={() => onMove(entry, selectedMoveTrip)}
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
  );
}
