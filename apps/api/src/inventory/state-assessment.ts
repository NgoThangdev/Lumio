import type { StockLevel, TrackingMode } from '../generated/prisma/client.js';
import { LEVELS } from './inventory-state.service.js';
import type { AssessmentExplanation } from './assessment-explanation.js';

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
  const state: { reason: string; explanation: AssessmentExplanation } =
    fiveLevel
      ? {
          reason: `Current container is ${item.currentLevel}; ${item.backupCount} refill(s) remain.`,
          explanation: {
            code: 'FIVE_LEVEL_CURRENT_AND_BACKUPS',
            params: { level: item.currentLevel, backupCount: item.backupCount },
          } satisfies AssessmentExplanation,
        }
      : {
          reason: `Current item is ${item.isPresent ? 'present' : 'absent'}; ${item.backupCount} backup(s) remain.`,
          explanation: {
            code: 'PRESENCE_CURRENT_AND_BACKUPS',
            params: { present: item.isPresent, backupCount: item.backupCount },
          } satisfies AssessmentExplanation,
        };
  const reason: { reason: string; explanation: AssessmentExplanation } =
    recommendedAction === 'OPEN_REFILL'
      ? {
          reason: 'Open one available backup before buying.',
          explanation: { code: 'STATE_OPEN_BACKUP_BEFORE_BUY' },
        }
      : recommendedAction === 'BUY_BACKUP'
        ? {
            reason: `No backup remains${item.neverRunOut ? ' for this never-run-out item' : ''}; buy a refill.`,
            explanation: {
              code: 'STATE_BUY_REFILL_NO_BACKUP',
              params: { neverRunOut: item.neverRunOut },
            },
          }
        : fiveLevel && !hasBackup && lowStockRisk === 'LOW'
          ? {
              reason: `Current level reached the low threshold (${item.lowAtLevel}).`,
              explanation: {
                code: 'FIVE_LEVEL_AT_LOW_THRESHOLD',
                params: { lowAtLevel: item.lowAtLevel },
              },
            }
          : {
              reason: 'Current stock and backups do not require a purchase.',
              explanation: { code: 'STATE_NO_PURCHASE_NEEDED' },
            };
  return {
    itemId: item.id,
    neverRunOut: item.neverRunOut,
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
    useTodayQuantity: null,
    expiryRisk: 'NONE' as const,
    expiryReason: null,
    expiryExplanation: null,
    lowStockRisk,
    recommendedAction,
    purchasePriority:
      recommendedAction === 'BUY_BACKUP'
        ? item.neverRunOut || empty
          ? 'MUST_BUY'
          : 'SHOULD_BUY'
        : null,
    reasons: [state.reason, reason.reason],
    reasonExplanations: [state.explanation, reason.explanation],
    prediction: {
      enabled: false,
      basis: 'NOT_APPLICABLE',
      reason:
        'Quantity-based USE prediction does not apply to this tracking mode.',
      explanation: { code: 'PREDICTION_NOT_APPLICABLE' },
      usedIn14Days: null,
      dailyRate: null,
      projectedNeed: null,
      shoppingDays: null,
    },
    suggestion: null,
  };
}
