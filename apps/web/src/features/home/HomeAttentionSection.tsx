import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { InventoryRead, NeedsAttention } from '../../shared/api/types';
import { tr, formatNumber, localizedError } from '../../shared/i18n';
import { Doodle } from '../../shared/ui/Doodle';
import { Notice } from '../../shared/ui/primitives';
import { alertLabel, alertTone } from './homePresentation';

export function HomeAttentionSection({
  base,
  attention,
  stock,
}: {
  base: string;
  attention: UseQueryResult<NeedsAttention>;
  stock: UseQueryResult<InventoryRead>;
}) {
  if (
    !attention.isPending &&
    !attention.isError &&
    !attention.data?.items.length
  )
    return null;

  return (
    <section className="home-attention" aria-labelledby="home-attention-title">
      <div className="home-section-heading">
        <h2 id="home-attention-title">{tr('home:needsAttention')}</h2>
        <Link to={`${base}/inventory`}>
          {tr('home:seeAll')} <span aria-hidden="true">›</span>
        </Link>
      </div>
      {attention.isPending ? (
        <p className="muted" role="status">
          {tr('home:loadingNeedsAttention')}
        </p>
      ) : attention.isError ? (
        <Notice kind="error">{localizedError(attention.error)}</Notice>
      ) : (
        <div className="home-attention-grid">
          {attention.data.items.slice(0, 2).map((entry) => {
            const match = stock.data?.items.find(
              ({ item }) => item.id === entry.itemId,
            );
            const amount = match
              ? match.item.trackingMode === 'QUANTITY'
                ? match.assessment.eligibleStock === null
                  ? tr('home:stockUnavailable')
                  : `${formatNumber(match.assessment.eligibleStock)} ${match.item.primaryUnit} ${tr('common:available')}`
                : `${formatNumber(match.item.backupCount)} ${tr(match.item.backupCount === 1 ? 'common:backup' : 'common:backups2')}`
              : stock.isPending
                ? tr('common:loadingStock')
                : tr('home:stockUnavailable');
            return (
              <Link
                className="home-attention-card"
                key={entry.itemId}
                to={`${base}/inventory/${entry.itemId}`}
              >
                <span className={`home-attention-pill ${alertTone(entry)}`}>
                  {tr(alertLabel(entry))}
                </span>
                <span className="home-attention-body">
                  <span className="home-attention-visual">
                    <Doodle itemName={entry.name} />
                  </span>
                  <strong className="home-attention-name">{entry.name}</strong>
                </span>
                <span className="home-attention-stock">{amount}</span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
