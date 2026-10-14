import type { StockLevel, TrackingMode } from '../generated/prisma/client.js';
import { LEVELS } from './inventory-state.service.js';

export interface StateAssessmentItem {
  id: string;
  name: string;
  primaryUnit: string;
  trackingMode: TrackingMode;
  currentLevel: StockLevel | null;
  isPresent: boolean | null;
  backupCount: number;
  lowAtLevel: StockLevel;
  buyAtLevel: StockLevel;
  neverRunOut: boolean;
}

export function assessStateItem(item: StateAssessmentItem) {
  const fiveLevel = item.trackingMode === 'FIVE_LEVEL';
  const empty = fiveLevel
    ? item.currentLevel === 'EMPTY'
    : item.isPresent === false;
  const hasBackup = item.backupCount > 0;
  const levelIndex = LEVELS.indexOf(item.currentLevel ?? 'EMPTY');
  let lowStockRisk: 'OK' | 'LOW' | 'BUY' | 'OUT';
  let recommendedAction: 'NONE' | 'OPEN_REFILL' | 'BUY_BACKUP';
  if (empty && !hasBackup) {
    lowStockRisk = 'OUT';
    recommendedAction = 'BUY_BACKUP';
  } else if (empty) {
    lowStockRisk = 'LOW';
    recommendedAction = 'OPEN_REFILL';
  } else if (hasBackup) {
    lowStockRisk = 'OK';
    recommendedAction = 'NONE';
  } else if (fiveLevel && levelIndex <= LEVELS.indexOf(item.buyAtLevel)) {
    lowStockRisk = 'BUY';
    recommendedAction = 'BUY_BACKUP';
  } else if (!fiveLevel && item.neverRunOut) {
    lowStockRisk = 'BUY';
    recommendedAction = 'BUY_BACKUP';
  } else if (fiveLevel && levelIndex <= LEVELS.indexOf(item.lowAtLevel)) {
    lowStockRisk = 'LOW';
    recommendedAction = 'NONE';
  } else if (!fiveLevel) {
    lowStockRisk = 'LOW';
    recommendedAction = 'NONE';
  } else {
    lowStockRisk = 'OK';
    recommendedAction = 'NONE';
  }
  const state = fiveLevel
    ? `Current container is ${item.currentLevel}; ${item.backupCount} refill(s) remain.`
    : `Current item is ${item.isPresent ? 'present' : 'absent'}; ${item.backupCount} backup(s) remain.`;
  const reason =
    recommendedAction === 'OPEN_REFILL'
      ? 'Open one available backup before buying.'
      : recommendedAction === 'BUY_BACKUP'
        ? `No backup remains${item.neverRunOut ? ' for this never-run-out item' : ''}; buy a refill.`
        : fiveLevel && !hasBackup && lowStockRisk === 'LOW'
          ? `Current level reached the low threshold (${item.lowAtLevel}).`
          : 'Current stock and backups do not require a purchase.';
  return {
    itemId: item.id,
    name: item.name,
    primaryUnit: item.primaryUnit,
    trackingMode: item.trackingMode,
    currentLevel: item.currentLevel,
    isPresent: item.isPresent,
    backupCount: item.backupCount,
    physicalStock: null,
    eligibleStock: null,
    expiredStock: null,
    useSoonQuantity: null,
    expiryRisk: 'NONE' as const,
    expiryReason: null,
    lowStockRisk,
    recommendedAction,
    purchasePriority:
      recommendedAction === 'BUY_BACKUP'
        ? item.neverRunOut || empty
          ? 'MUST_BUY'
          : 'SHOULD_BUY'
        : null,
    reasons: [state, reason],
    prediction: {
      enabled: false,
      basis: 'NOT_APPLICABLE',
      reason:
        'Quantity-based USE prediction does not apply to this tracking mode.',
      usedIn14Days: null,
      dailyRate: null,
      projectedNeed: null,
      shoppingDays: null,
    },
    suggestion: null,
  };
}
