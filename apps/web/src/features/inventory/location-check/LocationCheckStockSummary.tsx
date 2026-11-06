import type { LocationCheckItem } from '@/shared/api/types';
import {
  formatDate,
  formatDateOnly,
  formatNumber,
  localizedEnum,
  tr,
} from '@/shared/i18n';
import { showLocationCheckReason } from './locationStockCheckPresentation';

export function LocationCheckStockSummary({
  item,
  initiallyCorrecting,
}: {
  item: LocationCheckItem;
  initiallyCorrecting: boolean;
}) {
  const checkedAt = item.checkedAt ? formatDate(item.checkedAt) : null;

  return (
    <>
      <div className="location-check-item-heading">
        <div>
          <p className="eyebrow">{localizedEnum(item.trackingMode)}</p>
          <h3>{item.name}</h3>
        </div>
        <span
          className={`location-check-status location-check-status-${item.status.toLowerCase()}`}
        >
          {localizedEnum(item.status)}
        </span>
      </div>
      <p className="location-check-reason">
        {showLocationCheckReason(item.reason)}
      </p>
      {initiallyCorrecting && (
        <p className="muted">{tr('location-check:correctObservedNow')}</p>
      )}
      {item.trackingMode === 'QUANTITY' ? (
        <div className="location-check-stock">
          <strong>{formatNumber(item.stock.quantity ?? '—')}</strong>{' '}
          <span>{tr('location-check:location2')}</span>
          {!!item.stock.batches?.length && (
            <div className="location-check-batches">
              {item.stock.batches.map((batch) => (
                <div className="location-check-batch" key={batch.id}>
                  <span>
                    {formatNumber(batch.quantity)} ·{' '}
                    {batch.openedAt
                      ? tr('location-check:opened5', {
                          date: formatDateOnly(batch.openedAt),
                        })
                      : tr('common:unopened')}
                  </span>
                  <small>
                    {batch.expiryDate
                      ? tr('common:expires2', {
                          date: formatDateOnly(batch.expiryDate),
                        })
                      : tr('common:expiry2')}
                    {batch.openedUseByDate
                      ? tr('common:use2', {
                          date: formatDateOnly(batch.openedUseByDate),
                        })
                      : ''}
                  </small>
                </div>
              ))}
            </div>
          )}
          {item.openedTrackingEnabled && (
            <p className="muted">{tr('location-check:openingTrackingApi')}</p>
          )}
        </div>
      ) : (
        <div className="location-check-stock state-check-stock">
          {Object.hasOwn(item.stock, 'currentLevel') && (
            <p>
              {tr('location-check:currentLevel2')}{' '}
              <strong>
                {(item.stock.currentLevel
                  ? localizedEnum(item.stock.currentLevel)
                  : undefined) ?? tr('location-check:recorded')}
              </strong>
            </p>
          )}
          {Object.hasOwn(item.stock, 'isPresent') && (
            <p>
              {tr('location-check:currentItem2')}{' '}
              <strong>
                {item.stock.isPresent === null
                  ? tr('location-check:recorded')
                  : item.stock.isPresent
                    ? tr('common:present')
                    : tr('common:absent')}
              </strong>
            </p>
          )}
          {Object.hasOwn(item.stock, 'backupCount') && (
            <p>
              {tr('location-check:backupsLocation2')}{' '}
              <strong>{formatNumber(item.stock.backupCount ?? '—')}</strong>
            </p>
          )}
          {!Object.keys(item.stock).length && (
            <p className="muted">{tr('location-check:currentBackupStock')}</p>
          )}
        </div>
      )}
      {checkedAt && (
        <p className="muted location-check-saved">
          {tr('location-check:lastChecked')} {checkedAt}
          {item.checkedByUserId
            ? ` · ${tr('location-check:savedByHouseholdMember')}`
            : ''}
        </p>
      )}
    </>
  );
}
