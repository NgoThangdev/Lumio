import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ApiError, api, isMutationOutcomeUnknown } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import { localizedError, tr } from '@/shared/i18n';
import { Button, Notice } from '@/shared/ui/primitives';
import { SwipeReveal } from '@/shared/ui/SwipeReveal';
import type { Trip, TripSummary } from './shoppingTypes';

export function TripArchiveControl({
  householdId,
  routeBase,
  trip,
  children,
}: {
  householdId: string;
  routeBase: string;
  trip: TripSummary;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blockingTripIds, setBlockingTripIds] = useState<string[]>([]);
  const tripSummaries =
    queryClient.getQueryData<TripSummary[]>(keys.trips(householdId)) ?? [];
  const base = `/households/${householdId}/trips`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);

  async function refreshTripData() {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: keys.trips(householdId) }),
      queryClient.invalidateQueries({
        queryKey: keys.archivedTrips(householdId),
      }),
      queryClient.invalidateQueries({
        queryKey: keys.tripDetailsPrefix(householdId),
      }),
      queryClient.invalidateQueries({
        queryKey: keys.intelligencePrefix(householdId),
      }),
    ]);
  }

  async function archiveTrip() {
    setBusy(true);
    setError('');
    setBlockingTripIds([]);
    try {
      const archived = await api<Trip>(`${base}/${trip.id}`, 'DELETE');
      queryClient.setQueryData(keys.trip(householdId, trip.id), archived);
      await refreshTripData();
      setOpen(false);
      void navigate(routeBase);
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.code === 'TRIP_MOVE_DESTINATION_IN_USE'
      ) {
        setBlockingTripIds(cause.tripIds);
        setError(tr('shopping:tripMoveDestinationInUse'));
      } else if (cause instanceof ApiError && cause.code === 'TRIP_ARCHIVED') {
        setError(tr('shopping:tripAlreadyArchived'));
        await refreshTripData();
      } else if (cause instanceof ApiError && cause.status === 404) {
        setError(tr('shopping:tripNoLongerAvailable'));
        await refreshTripData();
      } else if (isMutationOutcomeUnknown(cause)) {
        await refreshTripData();
        try {
          const latest = await api<Trip>(`${base}/${trip.id}`);
          queryClient.setQueryData(keys.trip(householdId, trip.id), latest);
          if (latest.archivedAt) {
            setOpen(false);
            void navigate(routeBase);
            return;
          }
        } catch {
          // Keep the uncertain result visible; never resend the archive request.
        }
        setError(tr('shopping:archiveOutcomeUncertain'));
      } else {
        setError(localizedError(cause));
        await refreshTripData();
      }
    } finally {
      setBusy(false);
    }
  }

  function openArchiveDialog() {
    setError('');
    setBlockingTripIds([]);
    setOpen(true);
  }

  return (
    <>
      <SwipeReveal
        className="shopping-trip-swipe"
        action="archive"
        actionLabel={tr('shopping:archiveTrip')}
        itemName={trip.store}
        showActionsLabel={tr('shopping:showTripActions', { name: trip.store })}
        hideActionsLabel={tr('shopping:hideTripActions', { name: trip.store })}
        targetSelector=".shopping-plan-row"
        onAction={openArchiveDialog}
      >
        {children}
      </SwipeReveal>
      <dialog
        ref={dialogRef}
        className="inventory-lifecycle-dialog"
        aria-labelledby={`archive-trip-title-${trip.id}`}
        onClose={() => setOpen(false)}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setOpen(false);
        }}
      >
        <div className="field-stack">
          <h2 id={`archive-trip-title-${trip.id}`}>
            {tr('shopping:archiveTripTitle', { store: trip.store })}
          </h2>
          <p>
            {trip.status === 'RESTOCKED'
              ? tr('shopping:archiveFinishedTripBody')
              : tr('shopping:archiveTripBody')}
          </p>
          {error && <Notice kind="error">{error}</Notice>}
          {blockingTripIds.length > 0 && (
            <ul className="trip-archive-blocking-list">
              {blockingTripIds.map((tripIdValue) => (
                <li key={tripIdValue}>
                  <Link to={`${routeBase}/${tripIdValue}`}>
                    {tr('shopping:openBlockingMoveTrip')}{' '}
                    {tripSummaries.find(
                      (candidate) => candidate.id === tripIdValue,
                    )?.store ?? tripIdValue}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="inventory-dialog-actions">
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {tr('shopping:cancelArchiveTrip')}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void archiveTrip()}
            >
              {busy ? tr('shopping:archivingTrip') : tr('shopping:archiveTrip')}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
