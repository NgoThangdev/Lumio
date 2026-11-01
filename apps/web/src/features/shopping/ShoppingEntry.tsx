import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { CatalogOption, TrackingMode } from '@/shared/api/types';
import { formatDateOnly, formatNumber, localizedEnum, tr } from '@/shared/i18n';
import { Button, ItemVisual, Notice } from '@/shared/ui/primitives';
import { SwipeReveal } from '@/shared/ui/SwipeReveal';
import { priorityLabel, validPurchaseAmount } from './shoppingPresentation';
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
  onPending,
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
  onPending: (entry: Entry) => void;
  onSkip: (entry: Entry) => void;
  onMove: (entry: Entry, destination?: TripSummary) => void;
  onRemove: (entry: Entry) => void;
}) {
  const mode = entryMode(entry);
  const packageCount = entryUsesPackages(entry);
  const openingInfoAvailable = entryOpeningInfoAvailable(entry);
  const [expanded, setExpanded] = useState(false);
  const [removeConfirmationOpen, setRemoveConfirmationOpen] = useState(false);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const focusAmountOnOpen = useRef(false);
  const purchased = entry.status === 'PURCHASED';
  const archived = Boolean(trip.archivedAt);
  const shopping = trip.status === 'SHOPPING' && !archived;
  const detailsId = `shopping-entry-${entry.id}-details`;

  useEffect(() => {
    if (expanded && focusAmountOnOpen.current) {
      focusAmountOnOpen.current = false;
      amountInputRef.current?.focus();
    }
  }, [expanded]);

  useEffect(() => {
    const dialog = removeDialogRef.current;
    if (removeConfirmationOpen && dialog && !dialog.open) dialog.showModal();
    else if (!removeConfirmationOpen && dialog?.open) dialog.close();
  }, [removeConfirmationOpen]);

  function togglePurchased() {
    setExpanded(true);
    if (purchased) {
      onPending(entry);
      return;
    }
    if (!mode || (mode === 'QUANTITY' && !openingInfoAvailable)) return;
    if (
      !validPurchaseAmount(drafts[entry.id]?.quantity ?? '', mode, packageCount)
    ) {
      if (expanded) amountInputRef.current?.focus();
      else focusAmountOnOpen.current = true;
      return;
    }
    onPurchase(entry, mode);
  }

  const card = (
    <article
      className={`card checklist-entry${purchased ? ' checklist-entry-purchased' : ''}`}
      aria-labelledby={`shopping-entry-${entry.id}-name`}
    >
      <div className="entry-title">
        <h4 id={`shopping-entry-${entry.id}-name`}>
          <button
            type="button"
            className="entry-toggle"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((current) => !current)}
          >
            <ItemVisual name={entry.item.name} />
            <span className="entry-toggle-copy">
              <strong>{entry.item.name}</strong>
              <small>
                {expanded
                  ? tr('shopping:hideEntryDetails')
                  : tr('shopping:showEntryDetails')}
              </small>
            </span>
          </button>
        </h4>
        <div className="entry-head-actions">
          <label className="entry-purchased-toggle">
            <input
              type="checkbox"
              checked={purchased}
              disabled={!shopping || busy}
              aria-label={tr('shopping:purchasedItem', {
                name: entry.item.name,
              })}
              onChange={togglePurchased}
            />
            <span>{localizedEnum('PURCHASED')}</span>
          </label>
          {shopping && (
            <button
              type="button"
              className="secondary entry-skip-button"
              disabled={busy}
              onClick={() => {
                setExpanded(true);
                onSkip(entry);
              }}
            >
              {entry.status === 'SKIPPED'
                ? tr('common:leavePending')
                : tr('common:skip')}
            </button>
          )}
        </div>
      </div>
      <div className="entry-summary-meta">
        <span className="eyebrow">{priorityLabel(entry.priority)}</span>
        {(entry.status === 'SKIPPED' || entry.status === 'MOVED') && (
          <span className="entry-decision-status">
            {localizedEnum(entry.status)}
          </span>
        )}
      </div>
      <div id={detailsId} className="entry-details" hidden={!expanded}>
        {entry.status === 'MOVED' &&
          trip.status !== 'RESTOCKED' &&
          !archived && (
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
        {shopping && mode ? (
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
            amountInputRef={amountInputRef}
            onPurchase={(chosenEntry, chosenMode) => {
              setExpanded(true);
              onPurchase(chosenEntry, chosenMode);
            }}
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
      </div>
    </article>
  );

  return (
    <>
      {trip.status === 'RESTOCKED' || archived ? (
        card
      ) : (
        <SwipeReveal
          className="shopping-entry-swipe"
          action="delete"
          actionLabel={tr('common:remove')}
          itemName={entry.item.name}
          showActionsLabel={tr('shopping:showEntryActions', {
            name: entry.item.name,
          })}
          hideActionsLabel={tr('shopping:hideEntryActions', {
            name: entry.item.name,
          })}
          targetSelector=".entry-title"
          onAction={() => setRemoveConfirmationOpen(true)}
        >
          {card}
        </SwipeReveal>
      )}
      {!archived && trip.status !== 'RESTOCKED' && (
        <dialog
          ref={removeDialogRef}
          className="inventory-lifecycle-dialog shopping-entry-remove-dialog"
          aria-labelledby={`shopping-entry-${entry.id}-remove-title`}
          onClose={() => setRemoveConfirmationOpen(false)}
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setRemoveConfirmationOpen(false);
          }}
        >
          <div className="field-stack">
            <h2 id={`shopping-entry-${entry.id}-remove-title`}>
              {tr('shopping:removeEntry')}
            </h2>
            <p>
              {tr('shopping:removeOnly')} {entry.item.name}{' '}
              {tr('shopping:tripStockItem')}
            </p>
            <div className="inventory-dialog-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setRemoveConfirmationOpen(false)}
              >
                {tr('shopping:cancelRemoveEntry')}
              </Button>
              <Button
                className="inventory-permanent-delete"
                type="button"
                disabled={busy}
                onClick={() => {
                  setRemoveConfirmationOpen(false);
                  onRemove(entry);
                }}
              >
                {tr('shopping:confirmRemoval2')}
              </Button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
