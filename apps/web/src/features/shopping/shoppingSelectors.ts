import type { Item, TrackingMode } from '@/shared/api/types';
import { shoppingSections } from '@/shared/shoppingSections';
import type { Entry, PurchaseDraft, Trip, TripSummary } from './shoppingTypes';

export function selectShoppingPageData({
  items,
  trips,
  trip,
  manualItemId,
  drafts,
  locallyImportedTripIds,
}: {
  items: Item[];
  trips: TripSummary[];
  trip: Trip | null;
  manualItemId: string;
  drafts: Record<string, PurchaseDraft>;
  locallyImportedTripIds: Set<string>;
}) {
  const unsupportedSection = trip?.entries.find(
    (entry) =>
      !shoppingSections.some(
        (section) => section.code === entry.shoppingSection,
      ),
  );
  const entryInventoryItem = (entry: Entry) =>
    items.find((item) => item.id === entry.item.id);
  const entryMode = (entry: Entry): TrackingMode | undefined =>
    entry.item.trackingMode ?? entryInventoryItem(entry)?.trackingMode;
  const entryOpeningInfoAvailable = (entry: Entry) =>
    typeof entry.item.openedTrackingEnabled === 'boolean' ||
    typeof entryInventoryItem(entry)?.openedTrackingEnabled === 'boolean';
  const entryUsesPackages = (entry: Entry) =>
    entry.item.openedTrackingEnabled ??
    entryInventoryItem(entry)?.openedTrackingEnabled ??
    false;
  const available = items.filter(
    (item) => !trip?.entries.some((entry) => entry.item.id === item.id),
  );
  const eligibleDraftTrips = trips.filter(
    (candidate) => candidate.status === 'DRAFT' && candidate.id !== trip?.id,
  );
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

  return {
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
  };
}
