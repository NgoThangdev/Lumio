import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  tr,
  formatDateOnly,
  formatNumber,
  localizedError,
} from '../../shared/i18n';
import { Doodle } from '../../shared/ui/Doodle';
import { Notice } from '../../shared/ui/primitives';

export type TripSummary = {
  id: string;
  store: string;
  plannedDate: string;
  status: 'DRAFT' | 'SHOPPING' | 'RESTOCKED';
  _count?: { entries: number };
};

export function HomeTripSection({
  base,
  trips,
  nextTrip,
}: {
  base: string;
  trips: UseQueryResult<TripSummary[]>;
  nextTrip?: TripSummary;
}) {
  return (
    <section className="home-trip" aria-labelledby="home-trip-title">
      <div className="home-section-heading">
        <h2 id="home-trip-title">{tr('home:nextShoppingTrip')}</h2>
        <Link to={`${base}/shopping`}>
          {tr('home:seeList')} <span aria-hidden="true">›</span>
        </Link>
      </div>
      {trips.isPending ? (
        <p className="muted" role="status">
          {tr('home:loadingShoppingTrips')}
        </p>
      ) : trips.isError ? (
        <Notice kind="error">{localizedError(trips.error)}</Notice>
      ) : nextTrip ? (
        <Link className="home-trip-link" to={`${base}/shopping/${nextTrip.id}`}>
          <span className="home-trip-visual">
            <Doodle kind="basket" />
          </span>
          <span className="home-trip-copy">
            <strong>
              {formatNumber(nextTrip._count?.entries ?? 0)} {tr('common:items')}
            </strong>
            <small>
              {nextTrip.store} · {formatDateOnly(nextTrip.plannedDate)}
            </small>
          </span>
          <span className="home-trip-arrow" aria-hidden="true">
            ›
          </span>
        </Link>
      ) : (
        <div className="home-trip-empty">
          <Doodle kind="basket" />
          <span>{tr('home:upcomingTripYet')}</span>
          <Link to={`${base}/shopping`}>
            {tr('home:planShopping')} <span aria-hidden="true">›</span>
          </Link>
        </div>
      )}
    </section>
  );
}
