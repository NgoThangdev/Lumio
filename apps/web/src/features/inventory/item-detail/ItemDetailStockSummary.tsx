import { Link } from 'react-router';
import type { Assessment, Item } from '@/shared/api/types';
import { Card, Notice } from '@/shared/ui/primitives';
import { formatNumber, localizedEnum, tr } from '@/shared/i18n';

export type CorrectionChoice = {
  locationId: string;
  name: string;
  part: string;
  to: string;
};

export function ItemDetailStockSummary({
  item,
  assessment,
  correctionChoices,
  hasUnlocatedQuantity,
  hasMissingStateLocation,
}: {
  item: Item;
  assessment?: Assessment;
  correctionChoices: CorrectionChoice[];
  hasUnlocatedQuantity: boolean;
  hasMissingStateLocation: boolean;
}) {
  return (
    <>
      {item.archivedAt ? (
        <section className="stock-summary">
          <p className="eyebrow">{tr('item-detail:archivedStock')}</p>
          <p>{tr('item-detail:stockHistoryRetained')}</p>
        </section>
      ) : item.trackingMode === 'QUANTITY' ? (
        <section className="stock-summary">
          <p className="eyebrow">{tr('item-detail:readyUse')}</p>
          <strong>{formatNumber(assessment?.eligibleStock ?? '—')}</strong>{' '}
          <span>{item.primaryUnit}</span>
          <p>
            {tr('common:physical')}{' '}
            {formatNumber(assessment?.physicalStock ?? '—')} {item.primaryUnit}{' '}
            {tr('common:expired2')}{' '}
            {formatNumber(assessment?.expiredStock ?? '—')} {item.primaryUnit}
          </p>
          {item.openedTrackingEnabled && (
            <p>
              {tr('item-detail:opened4')}{' '}
              {formatNumber(item.openedQuantity ?? '—')} {item.primaryUnit}{' '}
              {tr('item-detail:unopened2')}{' '}
              {formatNumber(item.unopenedQuantity ?? '—')} {item.primaryUnit}
            </p>
          )}
          {item.openedTrackingEnabled && (
            <p className="muted">
              {tr('common:openingTracking')}
              {item.recommendedDaysAfterOpening
                ? ` · ${tr('item-detail:useWithinDaysAfterOpening', { days: item.recommendedDaysAfterOpening })}`
                : ` · ${tr('item-detail:noUseByInterval')}`}
              .
            </p>
          )}
        </section>
      ) : (
        <section className="stock-summary">
          <p className="eyebrow">
            {item.trackingMode === 'FIVE_LEVEL'
              ? tr('common:currentLevel')
              : tr('common:currentItem')}
          </p>
          <strong className="state-value">
            {item.trackingMode === 'FIVE_LEVEL'
              ? ((item.currentLevel
                  ? localizedEnum(item.currentLevel)
                  : undefined) ?? '—')
              : item.isPresent
                ? tr('common:present')
                : tr('common:absent')}
          </strong>
          <p>
            {formatNumber(item.backupCount)}{' '}
            {tr(item.backupCount === 1 ? 'common:backup' : 'common:backups2')}{' '}
            {tr('common:available')}
          </p>
          {item.currentLocation?.name && (
            <p>
              {tr('item-detail:currentLocation')} {item.currentLocation.name}
            </p>
          )}
          {item.backupLocation?.name && (
            <p>
              {tr('item-detail:backupLocation')} {item.backupLocation.name}
            </p>
          )}
        </section>
      )}
      {!item.archivedAt && (
        <Card className="stock-correction-entry">
          <h2>{tr('item-detail:correctStock')}</h2>
          <p className="muted">{tr('item-detail:correctObservedNow')}</p>
          {correctionChoices.length === 1 &&
          !hasUnlocatedQuantity &&
          !hasMissingStateLocation ? (
            <Link className="secondary" to={correctionChoices[0].to}>
              {tr('item-detail:correctStock')}
            </Link>
          ) : correctionChoices.length > 0 ? (
            <>
              <p>{tr('item-detail:chooseObservedLocation')}</p>
              <div className="stock-correction-choices">
                {correctionChoices.map((choice) => (
                  <Link
                    className="secondary"
                    key={choice.locationId}
                    to={choice.to}
                  >
                    {choice.part}: {choice.name}
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <Notice kind="error">
              {tr('item-detail:correctionLocationUnavailable')}
            </Notice>
          )}
          {hasUnlocatedQuantity && (
            <Notice kind="error">
              {tr('item-detail:unlocatedStockWarning')}
            </Notice>
          )}
          {hasMissingStateLocation && (
            <Notice kind="error">
              {tr('item-detail:missingStatePlacement')}
            </Notice>
          )}
        </Card>
      )}
    </>
  );
}
