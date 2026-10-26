import { ApiError } from '@/shared/api/client';
import type { LocationCheckItem } from '@/shared/api/types';
import { localizedError, tr, type TranslationKey } from '@/shared/i18n';

export function showLocationCheckReason(reason: LocationCheckItem['reason']) {
  const labels: Record<LocationCheckItem['reason'], string> = {
    STOCK_CHANGED: tr('location-check:stockChangedSinceCheck'),
    MISSING_STATE: tr('location-check:missingCurrentState'),
    NO_STOCK_RECORD: tr('location-check:noLocationStockRecord'),
    STALE_RECORD: tr('location-check:stockRecordOld'),
    RECENT_RECORD: tr('location-check:recentStockRecord'),
  };
  return labels[reason];
}

const correctionErrors: Record<string, TranslationKey> = {
  INVALID_EXPECTED_REVISION: 'location-check:invalidRevision',
  INVALID_CHECK_DECISION: 'location-check:invalidDecision',
  INVALID_QUANTITY: 'location-check:invalidQuantity',
  INVALID_BATCH_COUNTS: 'location-check:invalidBatchCounts',
  INVALID_BATCH_COUNT: 'location-check:invalidBatchCount',
  BATCH_TOTAL_MISMATCH: 'location-check:batchTotalMismatch',
  INVALID_EXTRA_QUANTITY: 'location-check:invalidExtraQuantity',
  INVALID_EXPIRY_DATE: 'location-check:invalidExtraExpiry',
  INVALID_PACKAGE_COUNT: 'location-check:invalidPackageCount',
  INVALID_LEVEL: 'location-check:invalidLevel',
  INVALID_PRESENCE: 'location-check:invalidPresence',
  INVALID_BACKUP_COUNT: 'location-check:invalidBackupCount',
  FIELD_NOT_AT_LOCATION: 'location-check:fieldNotAtLocation',
  OBSERVATION_REQUIRED: 'location-check:invalidObservation',
  CHECK_ITEM_NOT_FOUND: 'location-check:itemNotAtLocation',
  ITEM_ARCHIVED: 'location-check:itemArchived',
};

export function localizedLocationCheckError(cause: unknown) {
  const code = cause instanceof ApiError ? cause.code : null;
  return code && correctionErrors[code]
    ? tr(correctionErrors[code])
    : localizedError(cause);
}
