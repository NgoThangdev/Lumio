export const keys = {
  session: ['session'] as const,
  notificationPreferences: (userId: string) =>
    ['user', userId, 'notification-preferences'] as const,
  attention: (userId: string) => ['user', userId, 'attention'] as const,
  households: ['households'] as const,
  household: (householdId: string) => ['household', householdId] as const,
  shoppingSettings: (householdId: string) =>
    ['household', householdId, 'shopping-settings'] as const,
  members: (householdId: string) =>
    ['household', householdId, 'members'] as const,
  invitations: (householdId: string) =>
    ['household', householdId, 'invitations'] as const,
  catalog: (householdId: string, kind: 'categories' | 'locations' | 'tags') =>
    ['household', householdId, 'catalog', kind] as const,
  items: (householdId: string) => ['household', householdId, 'items'] as const,
  inventoryRead: (householdId: string, query: string) =>
    [...keys.items(householdId), 'read', query] as const,
  needsAttention: (householdId: string) =>
    ['household', householdId, 'needs-attention'] as const,
  recentActivity: (householdId: string) =>
    ['household', householdId, 'recent-activity'] as const,
  item: (householdId: string, itemId: string) =>
    ['household', householdId, 'item', itemId] as const,
  intelligencePrefix: (householdId: string) =>
    ['household', householdId, 'intelligence'] as const,
  intelligence: (householdId: string, date: string) =>
    ['household', householdId, 'intelligence', date] as const,
  archivedItems: (householdId: string) =>
    ['household', householdId, 'archived-items'] as const,
  tripDetailsPrefix: (householdId: string) =>
    ['household', householdId, 'trip'] as const,
  locationStockCheckPrefix: (householdId: string) =>
    ['household', householdId, 'location-stock-check'] as const,
  locationStockCheck: (householdId: string, locationId: string) =>
    ['household', householdId, 'location-stock-check', locationId] as const,
  trips: (householdId: string) => ['household', householdId, 'trips'] as const,
  trip: (householdId: string, tripId: string) =>
    ['household', householdId, 'trip', tripId] as const,
};
