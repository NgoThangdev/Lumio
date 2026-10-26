import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { InventoryRead } from '../../shared/api/types';
import { tr, formatNumber, localizedError } from '../../shared/i18n';
import { Notice } from '../../shared/ui/primitives';

export function HomeSnapshotSection({
  base,
  snapshot,
}: {
  base: string;
  snapshot: UseQueryResult<InventoryRead>;
}) {
  const locationGroups =
    snapshot.data?.groups?.filter(
      (group): group is typeof group & { id: string } => group.id !== null,
    ) ?? [];

  return (
    <section className="home-snapshot" aria-labelledby="home-snapshot-title">
      <div className="home-section-heading">
        <h2 id="home-snapshot-title">{tr('home:inventoryLocation')}</h2>
        <Link to={`${base}/inventory`}>{tr('home:seeAll')}</Link>
      </div>
      {snapshot.isPending ? (
        <p className="muted" role="status">
          {tr('common:loadingLocations2')}
        </p>
      ) : snapshot.isError ? (
        <Notice kind="error">
          {tr('common:locationsLoaded')} {localizedError(snapshot.error)}
        </Notice>
      ) : locationGroups.length ? (
        <div className="home-snapshot-list">
          {locationGroups.slice(0, 3).map((group) => (
            <Link
              className="home-snapshot-row"
              key={group.id}
              to={`${base}/inventory?locationId=${encodeURIComponent(group.id)}`}
            >
              <strong>{group.name}</strong>
              <span>
                {formatNumber(group.entries.length)}{' '}
                {tr(
                  group.entries.length === 1 ? 'common:item' : 'common:items',
                )}
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">{tr('home:itemsNamedLocations')}</p>
      )}
    </section>
  );
}
