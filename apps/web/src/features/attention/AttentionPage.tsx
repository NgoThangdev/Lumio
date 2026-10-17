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
    <main className="attention-page narrow">
      <header className="attention-heading">
        <p className="eyebrow">Across your households</p>
        <h1>Current attention</h1>
        <p className="muted">
          A live view of items the server has marked for review.
        </p>
      </header>

      {attention.isPending && (
        <p className="muted" role="status">
          Loading current attention…
        </p>
      )}
      {attention.isError && (
        <Card>
          <Notice kind="error">
            Current attention could not be loaded: {attention.error.message}
          </Notice>
          <Button variant="secondary" onClick={() => void attention.refetch()}>
            Retry
          </Button>
        </Card>
      )}
      {attention.data && attention.data.households.length === 0 && (
        <Card className="attention-empty">
          <Doodle kind="inventory" />
          <h2>Nothing needs attention right now</h2>
          <p className="muted">
            When the server finds an item to review in one of your households,
            it will appear here.
          </p>
        </Card>
      )}
      {attention.data && attention.data.households.length > 0 && (
        <div className="attention-groups">
          {attention.data.households.map((household) => (
            <Card className="attention-household" key={household.householdId}>
              <h2>{household.name}</h2>
              <ul className="attention-items">
                {household.items.map((item) => (
                  <li key={item.itemId}>
                    <Link
                      className="attention-item"
                      to={`/households/${household.householdId}/inventory/${item.itemId}`}
                    >
                      <span className="attention-item-doodle">
                        <Doodle itemName={item.name} />
                      </span>
                      <span className="attention-item-content">
                        <strong>{item.name}</strong>
                        <small>{trackingModeLabels[item.trackingMode]}</small>
                        <span className="attention-signals">
                          {item.signals.map((signal) => (
                            <span
                              className={`attention-signal attention-signal-${signal.toLowerCase()}`}
                              key={signal}
                            >
                              {signalLabels[signal] ?? signal}
                            </span>
                          ))}
                        </span>
                        <small>Stock assessment: {item.lowStockRisk}</small>
                        <small>Expiry assessment: {item.expiryRisk}</small>
                      </span>
                      <span className="attention-arrow" aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
