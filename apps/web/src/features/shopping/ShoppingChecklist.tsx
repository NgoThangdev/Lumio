import type { Dispatch, SetStateAction } from 'react';
import type { CatalogOption, TrackingMode } from '@/shared/api/types';
import { localizedEnum, tr } from '@/shared/i18n';
import { shoppingSections } from '@/shared/shoppingSections';
import { Notice } from '@/shared/ui/primitives';
import { priorityOrder } from './shoppingPresentation';
import { ShoppingEntry } from './ShoppingEntry';
import type { Entry, PurchaseDraft, Trip, TripSummary } from './shoppingTypes';

export function ShoppingChecklist({
  trip,
  unsupportedSection,
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
  trip: Trip;
  unsupportedSection?: Entry;
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
  return (
    <div className="trip-checklist">
      {unsupportedSection ? (
        <Notice kind="error">
          {tr('shopping:apiReturnedUnsupported')} {unsupportedSection.item.name}
          {tr('shopping:reloadTripApi')}
        </Notice>
      ) : trip.entries.length === 0 ? (
        <section className="card">
          <p className="muted">{tr('common:checklistEmptyAdd')}</p>
        </section>
      ) : (
        shoppingSections.map(({ code }: (typeof shoppingSections)[number]) => {
          const entries = trip.entries
            .filter((entry) => entry.shoppingSection === code)
            .sort((left, right) => {
              const purchasedOrder =
                Number(left.status === 'PURCHASED') -
                Number(right.status === 'PURCHASED');
              return (
                purchasedOrder ||
                priorityOrder.indexOf(left.priority) -
                  priorityOrder.indexOf(right.priority)
              );
            });
          return (
            entries.length > 0 && (
              <section className="shopping-section" key={code}>
                <h3 className="shopping-section-title">
                  {localizedEnum(code)}
                </h3>
                {entries.map((entry) => (
                  <ShoppingEntry
                    key={entry.id}
                    entry={entry}
                    trip={trip}
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
                    entryMode={entryMode}
                    entryUsesPackages={entryUsesPackages}
                    entryOpeningInfoAvailable={entryOpeningInfoAvailable}
                    onPurchase={onPurchase}
                    onPending={onPending}
                    onSkip={onSkip}
                    onMove={onMove}
                    onRemove={onRemove}
                  />
                ))}
              </section>
            )
          );
        })
      )}
    </div>
  );
}
