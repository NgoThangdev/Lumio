import { tr } from '@/shared/i18n';
import type { Entry, PurchaseDraft, Trip, TripSummary } from './shoppingTypes';
import type { TrackingMode } from '@/shared/api/types';

export function createShoppingEntryActions({
  trip,
  base,
  drafts,
  run,
  updateTrip,
  setNotice,
}: {
  trip: Trip | null;
  base: string;
  drafts: Record<string, PurchaseDraft>;
  run: (work: () => Promise<void>) => Promise<void>;
  updateTrip: (path: string, method: string, body?: object) => Promise<void>;
  setNotice: (message: string) => void;
}) {
  function purchase(entry: Entry, mode: TrackingMode) {
    if (!trip) return;
    void run(() =>
      updateTrip(`${base}/${trip.id}/entries/${entry.id}`, 'PATCH', {
        status: 'PURCHASED',
        actualQuantity: drafts[entry.id]?.quantity,
        ...(mode === 'QUANTITY'
          ? {
              expiryDate: drafts[entry.id]?.expiryDate || null,
              locationId: drafts[entry.id]?.locationId || null,
            }
          : {}),
      }),
    );
  }

  function skip(entry: Entry) {
    if (!trip) return;
    void run(() =>
      updateTrip(`${base}/${trip.id}/entries/${entry.id}`, 'PATCH', {
        status: entry.status === 'SKIPPED' ? 'PENDING' : 'SKIPPED',
      }),
    );
  }

  function move(entry: Entry, destination?: TripSummary) {
    if (!trip) return;
    void run(async () => {
      if (!destination) return;
      await updateTrip(`${base}/${trip.id}/entries/${entry.id}`, 'PATCH', {
        status: 'MOVED',
        destinationTripId: destination.id,
      });
      setNotice(tr('shopping:moveSavedNotice', { item: entry.item.name }));
    });
  }

  function remove(entry: Entry) {
    if (!trip) return;
    void run(async () => {
      await updateTrip(`${base}/${trip.id}/entries/${entry.id}`, 'DELETE');
      setNotice(tr('shopping:itemRemovedNotice', { item: entry.item.name }));
    });
  }

  return { purchase, skip, move, remove };
}
