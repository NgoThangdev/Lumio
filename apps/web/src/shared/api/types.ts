export type User = { id: string; email: string };
export type NotificationPreferences = {
  expiryAlertsEnabled: boolean;
  lowStockAlertsEnabled: boolean;
  shoppingRemindersEnabled: boolean;
  dailyDigestEnabled: boolean;
  digestTime: string;
  householdEventsEnabled: boolean;
  quietHours: { start: string; end: string } | null;
  timezone: string;
};
export type Household = { id: string; name: string; role: 'ADMIN' | 'MEMBER' };
export type HouseholdShoppingSettings = {
  defaultShoppingCycleDays: number;
  defaultStore: string | null;
};
export type HouseholdMember = {
  id: string;
  email: string;
  role: Household['role'];
};
export type InvitationStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'USED';
export type HouseholdInvitation = {
  id: string;
  createdAt: string;
  expiresAt: string;
  status: InvitationStatus;
};
export type InvitationPreview = {
  household: { id: string; name: string };
  status: InvitationStatus;
  expiresAt: string;
};
export type CatalogOption = { id: string; name: string };
export type CategoryOption = CatalogOption & {
  defaultTrackingMode: TrackingMode | null;
  defaultPrimaryUnit: string | null;
};
export type LocationCheckReason =
  | 'STOCK_CHANGED'
  | 'MISSING_STATE'
  | 'NO_STOCK_RECORD'
  | 'STALE_RECORD'
  | 'RECENT_RECORD';
export type LocationCheckStatus = 'PENDING' | 'CONFIRM' | 'CORRECT' | 'STALE';
export type LocationCheckItem = {
  itemId: string;
  name: string;
  trackingMode: TrackingMode;
  openedTrackingEnabled: boolean;
  stockRevision: number;
  stock: {
    quantity?: string;
    batches?: {
      id: string;
      quantity: string;
      expiryDate: string | null;
      openedAt: string | null;
      openedUseByDate: string | null;
    }[];
    currentLevel?: StockLevel | null;
    isPresent?: boolean | null;
    backupCount?: number;
  };
  status: LocationCheckStatus;
  reason: LocationCheckReason;
  checkedAt: string | null;
  checkedByUserId: string | null;
};
export type LocationStockCheck = {
  location: CatalogOption;
  items: LocationCheckItem[];
};
export type TrackingMode = 'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP';
export type StockLevel =
  'FULL' | 'THREE_QUARTERS' | 'HALF' | 'QUARTER' | 'EMPTY';
export type Batch = {
  id: string;
  quantity: string;
  expiryDate: string | null;
  openedAt?: string | null;
  openedUseByDate?: string | null;
  effectiveExpiryDate?: string | null;
  locationId?: string | null;
  location?: { name: string } | null;
};
export type Action = {
  id: string;
  type: 'RESTOCK' | 'USE' | 'INITIAL_STOCK' | 'OPEN' | 'FINISH_OPENED';
  quantity: string;
  createdAt: string;
  allocations: { batchId: string; quantity: string }[];
  openTransfer?: {
    sourceBatchId: string;
    openedBatchId: string;
    quantity: string;
  } | null;
  undo?: UndoRecord | null;
};
export type UndoRecord = {
  id: string;
  createdAt: string;
  postStockRevision: number;
  inventoryActionId: string | null;
  stateActionId: string | null;
};
export type UndoEligibility =
  | { eligible: true; expiresAt: string }
  | { eligible: false; expiresAt: null; reason: string };
export type UndoCandidate = {
  actionId: string;
  actionKind: 'INVENTORY' | 'STATE';
};
export type UndoResult = {
  undoId: string;
  originalActionId: string;
  actionKind: 'INVENTORY' | 'STATE';
  undoneAt: string;
  stockRevision: number;
  alreadyUndone: boolean;
};
export type StockCheckEvent = {
  decision: 'CONFIRM' | 'CORRECT';
  userId: string;
  checkedAt: string;
};
export type ItemStockCheck = {
  id: string;
  decision: 'PENDING' | 'CONFIRM' | 'CORRECT';
  revision: number;
  userId: string | null;
  checkedAt: string | null;
  history: StockCheckEvent[];
};
export type Item = {
  id: string;
  name: string;
  archivedAt?: string | null;
  categoryId?: string | null;
  category?: CatalogOption | null;
  tagLinks?: { tagId: string; tag: CatalogOption }[];
  changes?: {
    id: string;
    actorId: string;
    kind: 'EDIT' | 'ARCHIVE' | 'RESTORE';
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    createdAt: string;
  }[];
  primaryUnit: string;
  trackingMode: TrackingMode;
  preferredRestockLocationId?: string | null;
  preferredRestockLocation?: { id: string; name: string } | null;
  currentLocation?: { name: string } | null;
  backupLocation?: { name: string } | null;
  currentLevel: StockLevel | null;
  isPresent: boolean | null;
  backupCount: number;
  openedTrackingEnabled?: boolean;
  recommendedDaysAfterOpening?: number | null;
  openedQuantity?: string;
  unopenedQuantity?: string;
  batches: Batch[];
  actions?: Action[];
  stockChecks?: ItemStockCheck[];
  stateActions?: {
    id: string;
    type:
      | 'UPDATE_LEVEL'
      | 'ADD_BACKUP'
      | 'OPEN_REFILL'
      | 'SET_PRESENCE'
      | 'INITIALIZE';
    createdAt: string;
    afterBackupCount: number;
    undo?: UndoRecord | null;
  }[];
  undos?: UndoRecord[];
  minimumStock: string | null;
  lowStockThreshold: string | null;
  buyThreshold: string | null;
  targetStock: string | null;
  neverRunOut: boolean;
  predictionEnabled: boolean;
};
export type Assessment = {
  itemId: string;
  name: string;
  primaryUnit: string;
  trackingMode: TrackingMode;
  physicalStock: string | null;
  eligibleStock: string | null;
  expiredStock: string | null;
  expiryRisk: 'USE_SOON' | 'NONE';
  expiryReason: string | null;
  reasonExplanations?: Explanation[];
  expiryExplanation?: Explanation | null;
  lowStockRisk: 'OUT' | 'BUY' | 'LOW' | 'OK';
  reasons: string[];
  recommendedAction?: 'NONE' | 'OPEN_REFILL' | 'BUY_BACKUP';
  prediction: {
    basis: 'USE_14_DAY' | 'THRESHOLD_FALLBACK' | 'NOT_APPLICABLE';
    reason: string;
    explanation?: Explanation;
    dailyRate: string | null;
    projectedNeed: string | null;
  };
  suggestion: {
    quantity: string;
    priority: 'MUST_BUY' | 'SHOULD_BUY';
    reason: string;
    explanation?: Explanation;
  } | null;
};
export type Explanation = {
  code: string;
  params?: Record<string, string | number | boolean | null>;
};
export type Intelligence = {
  shoppingDate: string;
  assessments: Assessment[];
  useSoon: Assessment[];
  suggestions: Assessment[];
};
export type InventoryGroupEntry = {
  itemId: string;
  name: string;
  primaryUnit: string;
  trackingMode: TrackingMode;
  lowStockRisk: Assessment['lowStockRisk'];
  expiryRisk: Assessment['expiryRisk'];
  quantity: string | null;
  currentLevel?: StockLevel | null;
  isPresent?: boolean | null;
  backupCount?: number;
};
export type InventoryRead = {
  items: { item: Item; assessment: Assessment }[];
  groups?: {
    id: string | null;
    name: string;
    entries: InventoryGroupEntry[];
  }[];
};
export type NeedsAttention = {
  items: {
    itemId: string;
    name: string;
    trackingMode: TrackingMode;
    lowStockRisk: Assessment['lowStockRisk'];
    expiryRisk: Assessment['expiryRisk'];
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    action: 'BUY' | 'USE_SOON' | 'OPEN_REFILL' | 'VIEW_ITEM';
    reason: string;
    reasons: string[];
    primaryExplanation?: Explanation;
    supportingExplanations?: Explanation[];
  }[];
};
export type CurrentAttentionSignal = 'LOW_STOCK' | 'USE_SOON';
export type CurrentAttentionItem = {
  itemId: string;
  name: string;
  trackingMode: TrackingMode;
  signals: CurrentAttentionSignal[];
  lowStockRisk: Assessment['lowStockRisk'];
  expiryRisk: Assessment['expiryRisk'];
};
export type CurrentAttention = {
  asOf: string;
  households: {
    householdId: string;
    name: string;
    items: CurrentAttentionItem[];
  }[];
};
export type RecentActivityChange = {
  before: {
    quantity?: string;
    currentLevel?: StockLevel | null;
    isPresent?: boolean | null;
    backupCount?: number | null;
  };
  after: {
    quantity?: string;
    currentLevel?: StockLevel | null;
    isPresent?: boolean | null;
    backupCount?: number | null;
  };
};
export type RecentActivityEvent = {
  id: string;
  type:
    | 'USE'
    | 'RESTOCK'
    | 'INITIAL_STOCK'
    | 'OPEN'
    | 'FINISH_OPENED'
    | 'INITIALIZE'
    | 'UPDATE_LEVEL'
    | 'ADD_BACKUP'
    | 'OPEN_REFILL'
    | 'SET_PRESENCE'
    | 'UNDO'
    | 'SHOPPING_TRIP_COMPLETED'
    | 'TRIP_STOCK_CORRECTED'
    | 'LOCATION_STOCK_CORRECTED';
  occurredAt: string;
  actorId: string | null;
  item: { id: string; name: string; primaryUnit: string } | null;
  trip: { id: string; store: string | null } | null;
  location: { id: string; name: string } | null;
  quantity: string | null;
  change: RecentActivityChange | null;
  isUndone: boolean;
  undoneAt: string | null;
  reversesEventId: string | null;
  reversesType: RecentActivityEvent['type'] | null;
};
export type RecentActivity = { items: RecentActivityEvent[] };
export type Config = Pick<
  Item,
  | 'minimumStock'
  | 'lowStockThreshold'
  | 'buyThreshold'
  | 'targetStock'
  | 'neverRunOut'
  | 'predictionEnabled'
>;
