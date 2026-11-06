import type { TrackingMode } from '@/shared/api/types';
import type { ShoppingSection } from '@/shared/shoppingSections';

export type TripSummary = {
  id: string;
  store: string;
  plannedDate: string;
  status: 'DRAFT' | 'SHOPPING' | 'RESTOCKED';
  archivedAt?: string | null;
  archivedByUserId?: string | null;
  _count?: { entries: number };
};

export type Entry = {
  id: string;
  status: 'PENDING' | 'PURCHASED' | 'SKIPPED' | 'MOVED';
  source: 'SUGGESTED' | 'MANUAL';
  priority: 'MUST_BUY' | 'SHOULD_BUY' | 'OPTIONAL';
  shoppingSection: ShoppingSection;
  suggestedQuantity: string | null;
  suggestedReason: string | null;
  actualQuantity: string | null;
  expiryDate: string | null;
  purchaseDate?: string | null;
  freezeDate?: string | null;
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

export type Trip = TripSummary & {
  completedAt: string | null;
  suggestionsImportedAt?: string | null;
  entries: Entry[];
};

export type PurchaseDraft = {
  quantity: string;
  expiryDate: string;
  purchaseDate: string;
  freezeDate: string;
  locationId: string;
};
