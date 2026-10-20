import type { Explanation } from '../api/types';
import {
  formatDateOnly,
  formatNumber,
  localizedEnum,
  tr,
  type TranslationKey,
} from '../i18n';

const explanationKeys = {
  QUANTITY_NO_ELIGIBLE_STOCK: 'inventory:explanation.quantityNoEligibleStock',
  QUANTITY_AT_OR_BELOW_MINIMUM:
    'inventory:explanation.quantityAtOrBelowMinimum',
  QUANTITY_AT_OR_BELOW_BUY_THRESHOLD:
    'inventory:explanation.quantityAtOrBelowBuyThreshold',
  QUANTITY_PROJECTED_NEED: 'inventory:explanation.quantityProjectedNeed',
  QUANTITY_AT_OR_BELOW_LOW_THRESHOLD:
    'inventory:explanation.quantityAtOrBelowLowThreshold',
  QUANTITY_ABOVE_RISK_LEVELS: 'inventory:explanation.quantityAboveRiskLevels',
  QUANTITY_TARGET_REQUIRED: 'inventory:explanation.quantityTargetRequired',
  QUANTITY_USE_SOON: 'inventory:explanation.quantityUseSoon',
  PREDICTION_DISABLED: 'inventory:explanation.predictionDisabled',
  PREDICTION_USE_14_DAY: 'inventory:explanation.predictionUse14Day',
  PREDICTION_INSUFFICIENT_HISTORY:
    'inventory:explanation.predictionInsufficientHistory',
  QUANTITY_BUY_TO_TARGET: 'inventory:explanation.quantityBuyToTarget',
  QUANTITY_BUY_TO_MEET_OR_EXCEED_TARGET:
    'inventory:explanation.quantityBuyToMeetOrExceedTarget',
  FIVE_LEVEL_CURRENT_AND_BACKUPS:
    'inventory:explanation.fiveLevelCurrentAndBackups',
  PRESENCE_CURRENT_AND_BACKUPS:
    'inventory:explanation.presenceCurrentAndBackups',
  STATE_OPEN_BACKUP_BEFORE_BUY:
    'inventory:explanation.stateOpenBackupBeforeBuy',
  STATE_BUY_REFILL_NO_BACKUP: 'inventory:explanation.stateBuyRefillNoBackup',
  FIVE_LEVEL_AT_LOW_THRESHOLD: 'inventory:explanation.fiveLevelAtLowThreshold',
  STATE_NO_PURCHASE_NEEDED: 'inventory:explanation.stateNoPurchaseNeeded',
  PREDICTION_NOT_APPLICABLE: 'inventory:explanation.predictionNotApplicable',
} satisfies Record<string, TranslationKey>;

export function hasExplanationTranslation(
  explanation: Explanation | null | undefined,
) {
  return Boolean(
    explanation &&
    explanationKeys[explanation.code as keyof typeof explanationKeys],
  );
}

const numericParams = new Set([
  'minimumStock',
  'buyThreshold',
  'projectedNeed',
  'bufferPercent',
  'lowStockThreshold',
  'quantity',
  'windowDays',
  'minimumDistinctDays',
  'requiredSpanDays',
  'targetStock',
  'backupCount',
]);

function localizeParams(explanation: Explanation) {
  return Object.fromEntries(
    Object.entries(explanation.params ?? {}).map(([name, value]) => {
      if (value === null) return [name, tr('inventory:unknownState')];
      if (name === 'present' && typeof value === 'boolean')
        return [name, tr(value ? 'common:present' : 'common:absent')];
      if (name === 'neverRunOut' && typeof value === 'boolean')
        return [name, tr(value ? 'inventory:yes' : 'inventory:no')];
      if (
        (name === 'level' || name === 'lowAtLevel') &&
        typeof value === 'string'
      )
        return [name, localizedEnum(value)];
      if (
        (name === 'shoppingDate' || name === 'throughDate') &&
        typeof value === 'string'
      )
        return [name, formatDateOnly(value)];
      if (
        numericParams.has(name) &&
        (typeof value === 'number' || typeof value === 'string')
      )
        return [name, formatNumber(value)];
      return [name, String(value)];
    }),
  );
}

type ExplanationTextProps = {
  explanation: Explanation | null | undefined;
  fallback?: string | null;
  className?: string;
  as?: 'p' | 'span';
};

export function ExplanationText({
  explanation,
  fallback,
  className = 'muted',
  as = 'p',
}: ExplanationTextProps) {
  const key = explanation
    ? explanationKeys[explanation.code as keyof typeof explanationKeys]
    : undefined;
  const text =
    key && explanation
      ? tr(key, localizeParams(explanation))
      : fallback?.trim();

  if (!text) return null;
  return as === 'span' ? (
    <span className={className}>{text}</span>
  ) : (
    <p className={className}>{text}</p>
  );
}
