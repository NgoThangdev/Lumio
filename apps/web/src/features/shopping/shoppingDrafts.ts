import type { PurchaseDraft, Trip } from './shoppingTypes';
import { plannedDateFromCycle } from './shoppingPresentation';

export function createPurchaseDrafts(
  trip: Trip,
): Record<string, PurchaseDraft> {
  return Object.fromEntries(
    trip.entries.map((entry) => [
      entry.id,
      {
        quantity: entry.actualQuantity ?? '',
        expiryDate: entry.expiryDate?.slice(0, 10) ?? '',
        purchaseDate:
          entry.purchaseDate?.slice(0, 10) ?? plannedDateFromCycle(0),
        freezeDate: entry.freezeDate?.slice(0, 10) ?? '',
        locationId:
          entry.locationId ?? entry.item.preferredRestockLocationId ?? '',
      },
    ]),
  );
}
