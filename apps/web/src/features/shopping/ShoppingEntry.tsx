import type { Dispatch, SetStateAction } from 'react';
import type { CatalogOption, TrackingMode } from '@/shared/api/types';
import { formatDateOnly, formatNumber, localizedEnum, tr } from '@/shared/i18n';
import { ItemVisual, Notice } from '@/shared/ui/primitives';
import { priorityLabel } from './shoppingPresentation';
import { ShoppingEntryActions } from './ShoppingEntryActions';
import type { Entry, PurchaseDraft, Trip, TripSummary } from './shoppingTypes';

export function ShoppingEntry({
  entry,
  trip,
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
  entryMode,
  entryUsesPackages,
  entryOpeningInfoAvailable,
  onPurchase,
  onSkip,
  onMove,
  onRemove,
}: {
  entry: Entry;
  trip: Trip;
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
  entryMode: (entry: Entry) => TrackingMode | undefined;
  entryUsesPackages: (entry: Entry) => boolean;
  entryOpeningInfoAvailable: (entry: Entry) => boolean;
  onPurchase: (entry: Entry, mode: TrackingMode) => void;
  onSkip: (entry: Entry) => void;
  onMove: (entry: Entry, destination?: TripSummary) => void;
  onRemove: (entry: Entry) => void;
}) {
  const mode = entryMode(entry);
  const packageCount = entryUsesPackages(entry);
  const openingInfoAvailable = entryOpeningInfoAvailable(entry);
  return (
    <div className="checklist-entry">
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
      <p className="eyebrow">{priorityLabel(entry.priority)}</p>
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
              quantity: formatNumber(entry.suggestedQuantity),
              unit: entry.item.primaryUnit,
            })
          : mode === 'QUANTITY'
            ? `${tr('shopping:noSuggestedQuantity')} · ${entry.item.primaryUnit}`
            : mode
              ? tr('shopping:chooseHowMany')
              : tr('shopping:itemModeUnavailable')}
      </p>
      {trip.status === 'DRAFT' && entry.suggestedReason && (
        <p className="muted">{entry.suggestedReason}</p>
      )}
      {trip.status === 'SHOPPING' && !mode && (
        <Notice kind="error">{tr('shopping:itemModeLoaded')}</Notice>
      )}
      {trip.status === 'SHOPPING' &&
        mode === 'QUANTITY' &&
        !openingInfoAvailable && (
          <Notice kind="error">{tr('shopping:openingPolicyLoaded')}</Notice>
        )}
      {trip.status === 'SHOPPING' && mode ? (
        <ShoppingEntryActions
          entry={entry}
          mode={mode}
          packageCount={packageCount}
          openingInfoAvailable={openingInfoAvailable}
          eligibleDraftTrips={eligibleDraftTrips}
          drafts={drafts}
          setDrafts={setDrafts}
          moveDestinationByEntry={moveDestinationByEntry}
          setMoveDestinationByEntry={setMoveDestinationByEntry}
          busy={busy}
          routeBase={routeBase}
          tripsPending={tripsPending}
          tripsError={tripsError}
          locationsPending={locationsPending}
          locationsError={locationsError}
          locationOptions={locationOptions}
          onPurchase={onPurchase}
          onSkip={onSkip}
          onMove={onMove}
        />
      ) : (
        trip.status === 'RESTOCKED' && (
          <p className="muted">
            {entry.status === 'PURCHASED'
              ? mode === 'QUANTITY'
                ? tr('shopping:bought', {
                    quantity:
                      entry.actualQuantity === null
                        ? '\u2014'
                        : formatNumber(entry.actualQuantity),
                    unit: entry.item.primaryUnit,
                    expiry: entry.expiryDate
                      ? tr('common:expires2', {
                          date: formatDateOnly(entry.expiryDate),
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
                            : formatNumber(entry.actualQuantity),
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
          <summary>{tr('shopping:removeEntry')}</summary>
          <p className="muted">
            {tr('shopping:removeOnly')} {entry.item.name}{' '}
            {tr('shopping:tripStockItem')}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onRemove(entry)}
          >
            {tr('shopping:confirmRemoval2')} {entry.item.name}
          </button>
        </details>
      )}
    </div>
  );
}
