export const HOUSEHOLD_DELETION_COUNT_FIELDS = [
  'members',
  'invitations',
  'categories',
  'locations',
  'tags',
  'activeItems',
  'archivedItems',
  'stockBatches',
  'inventoryActions',
  'stateActions',
  'undos',
  'itemChanges',
  'shoppingTrips',
  'shoppingEntries',
  'tripStockChecks',
  'locationStockChecks',
  'notificationIntents',
  'notificationDeliveries',
] as const;

export type HouseholdDeletionCounts = Record<
  (typeof HOUSEHOLD_DELETION_COUNT_FIELDS)[number],
  number
>;

export type HouseholdDeletionImpact = {
  household: { id: string; name: string };
  counts: HouseholdDeletionCounts;
};

export type HouseholdDeletionSchedule = {
  requestId: string;
  requestedAt: string;
  dueAt: string;
  impact: HouseholdDeletionImpact;
};

export type PendingHouseholdDeletion = {
  id: string;
  name: string;
  requestId: string;
  requestedAt: string;
  dueAt: string;
};

export function isHouseholdDeletionImpact(
  value: unknown,
): value is HouseholdDeletionImpact {
  if (!value || typeof value !== 'object') return false;
  const impact = value as Record<string, unknown>;
  if (!impact.household || typeof impact.household !== 'object') return false;
  const household = impact.household as Record<string, unknown>;
  if (typeof household.id !== 'string' || typeof household.name !== 'string')
    return false;
  if (!impact.counts || typeof impact.counts !== 'object') return false;
  const counts = impact.counts as Record<string, unknown>;
  return HOUSEHOLD_DELETION_COUNT_FIELDS.every(
    (field) =>
      Number.isSafeInteger(counts[field]) && (counts[field] as number) >= 0,
  );
}

export const HOUSEHOLD_DELETION_COUNT_GROUPS = [
  {
    title: 'settings:deletionAccessCounts',
    fields: ['members', 'invitations', 'categories', 'locations', 'tags'],
  },
  {
    title: 'settings:deletionInventoryCounts',
    fields: ['activeItems', 'archivedItems', 'stockBatches'],
  },
  {
    title: 'settings:deletionHistoryCounts',
    fields: ['inventoryActions', 'stateActions', 'undos', 'itemChanges'],
  },
  {
    title: 'settings:deletionShoppingCounts',
    fields: [
      'shoppingTrips',
      'shoppingEntries',
      'tripStockChecks',
      'locationStockChecks',
    ],
  },
  {
    title: 'settings:deletionNotificationCounts',
    fields: ['notificationIntents', 'notificationDeliveries'],
  },
] as const satisfies readonly {
  title: TranslationKey;
  fields: readonly (keyof HouseholdDeletionCounts)[];
}[];

export const HOUSEHOLD_DELETION_COUNT_LABELS = {
  members: 'settings:deletionMembers',
  invitations: 'settings:deletionInvitations',
  categories: 'settings:deletionCategories',
  locations: 'settings:deletionLocations',
  tags: 'settings:deletionTags',
  activeItems: 'settings:deletionActiveItems',
  archivedItems: 'settings:deletionArchivedItems',
  stockBatches: 'settings:deletionStockBatches',
  inventoryActions: 'settings:deletionInventoryActions',
  stateActions: 'settings:deletionStateActions',
  undos: 'settings:deletionUndos',
  itemChanges: 'settings:deletionItemChanges',
  shoppingTrips: 'settings:deletionShoppingTrips',
  shoppingEntries: 'settings:deletionShoppingEntries',
  tripStockChecks: 'settings:deletionTripStockChecks',
  locationStockChecks: 'settings:deletionLocationStockChecks',
  notificationIntents: 'settings:deletionNotificationIntents',
  notificationDeliveries: 'settings:deletionNotificationDeliveries',
} as const satisfies Record<keyof HouseholdDeletionCounts, TranslationKey>;
import type { TranslationKey } from '@/shared/i18n';
