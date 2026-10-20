import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  CurrentAttention,
  CurrentAttentionSignal,
  User,
} from '../../shared/api/types';
import { Doodle } from '../../shared/ui/Doodle';
import { Button, Card, Notice } from '../../shared/ui/primitives';
import { localizedEnum } from '../../shared/i18n';

import { tr } from '../../shared/i18n';
import { localizedError } from '../../shared/i18n';
const signalLabels: Record<CurrentAttentionSignal, string> = {
  LOW_STOCK: 'Low stock',
  USE_SOON: 'Use soon',
};

const trackingModeLabels = {
  QUANTITY: 'Quantity',
  FIVE_LEVEL: 'Five-level',
  PRESENCE_BACKUP: 'Presence and backup',
} as const;

export function AttentionPage({ user }: { user: User }) {
  const attention = useQuery({
    queryKey: keys.attention(user.id),
    queryFn: () => api<CurrentAttention>('/me/attention'),
  });

  return (
    <section className="attention-page narrow">
      <header className="attention-heading">
        <p className="eyebrow">{tr('attention:acrossHouseholds')}</p>
        <h1>{tr('attention:currentAttention')}</h1>
        <p className="muted">{tr('attention:liveViewItems')}</p>
      </header>

      {attention.isPending && (
        <p className="muted" role="status">
          {tr('attention:loadingCurrentAttention')}
        </p>
      )}
      {attention.isError && (
        <Card>
          <Notice kind="error">
            {tr('attention:currentAttentionLoaded')}{' '}
            {localizedError(attention.error)}
          </Notice>
          <Button variant="secondary" onClick={() => void attention.refetch()}>
            {tr('common:retry')}
          </Button>
        </Card>
      )}
      {attention.data && attention.data.households.length === 0 && (
        <Card className="attention-empty">
          <Doodle kind="inventory" />
          <h2>{tr('attention:nothingNeedsAttention')}</h2>
          <p className="muted">{tr('attention:serverFindsItem')}</p>
        </Card>
      )}
      {attention.data && attention.data.households.length > 0 && (
        <div className="attention-groups">
          {attention.data.households.map((household) => (
            <Card className="attention-household" key={household.householdId}>
              <h2>{household.name}</h2>
              <ul className="attention-items">
                {household.items.map((item) => (
                  <li className="attention-list-item" key={item.itemId}>
                    <Link
                      className="attention-item"
                      to={`/households/${household.householdId}/inventory/${item.itemId}`}
                    >
                      <span className="attention-item-doodle">
                        <Doodle itemName={item.name} />
                      </span>
                      <span className="attention-item-content">
                        <strong>{item.name}</strong>
                        <small>
                          {tr(
                            trackingModeLabels[item.trackingMode] as Parameters<
                              typeof tr
                            >[0],
                          )}
                        </small>
                        <span className="attention-signals">
                          {item.signals.map((signal) => (
                            <span
                              className={`attention-signal attention-signal-${signal.toLowerCase()}`}
                              key={signal}
                            >
                              {tr(
                                (signalLabels[signal] ?? signal) as Parameters<
                                  typeof tr
                                >[0],
                              )}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="attention-arrow" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                    <details className="attention-assessment">
                      <summary>{tr('attention:assessmentDetails')}</summary>
                      <div>
                        <small>
                          {tr('attention:stockAssessment', {
                            value: localizedEnum(item.lowStockRisk),
                          })}
                        </small>
                        <small>
                          {tr('attention:expiryAssessment', {
                            value: localizedEnum(item.expiryRisk),
                          })}
                        </small>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
