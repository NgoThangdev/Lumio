import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { RecentActivityEvent } from '../../shared/api/types';
import { tr, formatDate, localizedError } from '../../shared/i18n';
import { Notice } from '../../shared/ui/primitives';
import { activityDetail, activityTypeLabel } from './homePresentation';

export function HomeActivitySection({
  base,
  activity,
  currentUserId,
}: {
  base: string;
  activity: UseQueryResult<{ items: RecentActivityEvent[] }>;
  currentUserId?: string;
}) {
  return (
    <section className="home-activity" aria-labelledby="home-activity-title">
      <div className="home-section-heading">
        <h2 id="home-activity-title">{tr('home:recentHouseholdActivity')}</h2>
      </div>
      {activity.isPending ? (
        <p className="muted" role="status">
          {tr('home:loadingRecentActivity')}
        </p>
      ) : activity.isError ? (
        <Notice kind="error">
          {tr('home:recentActivityLoaded')} {localizedError(activity.error)}
        </Notice>
      ) : !activity.data.items.length ? (
        <p className="muted">{tr('home:householdActivityYet')}</p>
      ) : (
        <ol className="home-activity-list">
          {activity.data.items.slice(0, 5).map((event) => {
            const actor =
              event.actorId === null
                ? tr('home:unknownMember')
                : event.actorId === currentUserId
                  ? tr('common:you')
                  : tr('home:householdMember');
            const content = (
              <>
                <span className="home-activity-copy">
                  <strong>{activityTypeLabel(event)}</strong>
                  <small>
                    {[event.item?.name, activityDetail(event), actor]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <time dateTime={event.occurredAt}>
                  {formatDate(event.occurredAt)}
                </time>
              </>
            );
            const itemPath = event.item?.id
              ? `${base}/inventory/${event.item.id}`
              : null;
            const tripPath = event.trip?.id
              ? `${base}/shopping/${event.trip.id}`
              : null;
            return (
              <li className="home-activity-row" key={event.id}>
                {itemPath ? (
                  <Link to={itemPath}>{content}</Link>
                ) : tripPath ? (
                  <Link to={tripPath}>{content}</Link>
                ) : (
                  <div>{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
