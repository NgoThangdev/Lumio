import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, ApiError, isMutationOutcomeUnknown } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import { useHousehold } from '@/shared/household/HouseholdContext';
import {
  formatDate,
  formatDateOnly,
  formatNumber,
  localizedEnum,
  localizedError,
  tr,
} from '@/shared/i18n';
import { Button, ItemVisual, Notice } from '@/shared/ui/primitives';
import type { Trip, TripSummary } from './shoppingTypes';

export function ArchivedTripsPage() {
  const householdId = useHousehold().id;
  const routeBase = `/households/${householdId}/shopping`;
  const apiBase = `/households/${householdId}/trips`;
  const queryClient = useQueryClient();
  const [busyTripId, setBusyTripId] = useState('');
  const [success, setSuccess] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const archivedTrips = useQuery({
    queryKey: keys.archivedTrips(householdId),
    queryFn: () => api<TripSummary[]>(`${apiBase}/archived`),
  });

  async function refreshTripData(tripId?: string) {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: keys.trips(householdId) }),
      queryClient.invalidateQueries({
        queryKey: keys.archivedTrips(householdId),
      }),
      queryClient.invalidateQueries({
        queryKey: tripId
          ? keys.trip(householdId, tripId)
          : keys.tripDetailsPrefix(householdId),
      }),
      queryClient.invalidateQueries({
        queryKey: keys.intelligencePrefix(householdId),
      }),
    ]);
  }

  async function restoreTrip(trip: TripSummary) {
    setBusyTripId(trip.id);
    setSuccess('');
    setRowErrors((current) => ({ ...current, [trip.id]: '' }));
    try {
      const restored = await api<Trip>(`${apiBase}/${trip.id}/restore`, 'POST');
      queryClient.setQueryData(keys.trip(householdId, trip.id), restored);
      await refreshTripData(trip.id);
      setSuccess(tr('shopping:tripRestored'));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setRowErrors((current) => ({
          ...current,
          [trip.id]: tr('shopping:tripNoLongerAvailable'),
        }));
        await refreshTripData(trip.id);
      } else if (
        cause instanceof ApiError &&
        (cause.code === 'TRIP_ARCHIVED' ||
          cause.code === 'DESTINATION_TRIP_ARCHIVED')
      ) {
        setRowErrors((current) => ({
          ...current,
          [trip.id]: localizedError(cause),
        }));
        await refreshTripData(trip.id);
      } else if (isMutationOutcomeUnknown(cause)) {
        await refreshTripData(trip.id);
        try {
          const latest = await api<Trip>(`${apiBase}/${trip.id}`);
          queryClient.setQueryData(keys.trip(householdId, trip.id), latest);
          if (!latest.archivedAt) return;
        } catch {
          // Keep the uncertain result visible; do not resend Restore.
        }
        setRowErrors((current) => ({
          ...current,
          [trip.id]: tr('shopping:restoreOutcomeUncertain'),
        }));
      } else {
        setRowErrors((current) => ({
          ...current,
          [trip.id]: localizedError(cause),
        }));
        await refreshTripData(trip.id);
      }
    } finally {
      setBusyTripId('');
    }
  }

  return (
    <div className="grid archived-trips-page">
      <section className="card">
        <Link className="link" to={routeBase}>
          {tr('shopping:backToTrips')}
        </Link>
        <h1>{tr('shopping:archivedTrips')}</h1>
        {success && <Notice kind="success">{success}</Notice>}
        {archivedTrips.isPending ? (
          <p className="muted" role="status">
            {tr('shopping:loadingArchivedTrips')}
          </p>
        ) : archivedTrips.isError ? (
          <Notice kind="error">{localizedError(archivedTrips.error)}</Notice>
        ) : archivedTrips.data.length === 0 ? (
          <p className="muted">{tr('shopping:noArchivedTrips')}</p>
        ) : (
          <div className="archived-trip-list">
            {archivedTrips.data.map((trip) => (
              <article className="row archived-trip-row" key={trip.id}>
                <Link
                  className="archived-trip-detail-link"
                  to={`${routeBase}/${trip.id}`}
                >
                  <ItemVisual name={trip.store} illustrationKey="basket" />
                  <span className="item-identity">
                    <strong>{trip.store}</strong>
                    <small>
                      {formatDateOnly(trip.plannedDate)} ·{' '}
                      {formatNumber(trip._count?.entries ?? 0)}{' '}
                      {tr('common:items')}
                    </small>
                    <small>
                      {tr('shopping:archivedAt')}{' '}
                      {trip.archivedAt ? formatDate(trip.archivedAt) : '—'}
                    </small>
                  </span>
                  <span className="pill">{localizedEnum(trip.status)}</span>
                </Link>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={busyTripId !== ''}
                  onClick={() => void restoreTrip(trip)}
                >
                  {busyTripId === trip.id
                    ? tr('shopping:restoringTrip')
                    : tr('shopping:restoreTrip')}
                </Button>
                {rowErrors[trip.id] && (
                  <Notice kind="error">{rowErrors[trip.id]}</Notice>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
