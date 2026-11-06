import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHousehold } from '@/shared/household/HouseholdContext';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { LocationStockCheck } from '@/shared/api/types';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import { formatNumber, localizedError, tr } from '@/shared/i18n';
import { LocationCheckCard } from './LocationCheckCard';

export function LocationStockCheckPage() {
  const household = useHousehold();
  const { locationId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const targetItemId =
    searchParams.get('correct') === '1' ? searchParams.get('itemId') : null;
  const focusedItem = useRef<string | null>(null);
  const [autoOpenItem, setAutoOpenItem] = useState(targetItemId);
  const [conflictItemId, setConflictItemId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<{
    itemId: string;
    revision: number;
    text: string;
  } | null>(null);
  const [refreshWarningItemId, setRefreshWarningItemId] = useState<
    string | null
  >(null);
  const queryClient = useQueryClient();
  const queryKey = keys.locationStockCheck(household.id, locationId);
  const check = useQuery({
    queryKey,
    queryFn: () =>
      api<LocationStockCheck>(
        `/households/${household.id}/locations/${locationId}/stock-check`,
      ),
    enabled: Boolean(locationId),
  });

  useEffect(() => {
    if (!check.data || !targetItemId || focusedItem.current === targetItemId)
      return;
    const target = document.getElementById(
      `location-correction-${targetItemId}`,
    );
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    target.focus({ preventScroll: true });
    focusedItem.current = targetItemId;
  }, [check.data, targetItemId]);

  if (check.isPending)
    return (
      <Card>
        <p className="muted" role="status">
          {tr('location-check:loadingLocationChecklist')}
        </p>
      </Card>
    );
  if (check.isError)
    return (
      <>
        <Notice kind="error">
          {tr('location-check:locationChecklistLoaded')}{' '}
          {localizedError(check.error)}
        </Notice>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void check.refetch()}
        >
          {tr('location-check:retryChecklist')}
        </Button>
      </>
    );
  if (!check.data)
    return (
      <Notice kind="error">
        {tr('location-check:locationChecklistUnavailable')}
      </Notice>
    );

  const visibleItems = targetItemId
    ? check.data.items.filter((item) => item.itemId === targetItemId)
    : check.data.items;

  return (
    <section className="location-stock-check-page">
      <div className="location-check-heading">
        <div>
          <h1>{check.data.location.name}</h1>
          {!targetItemId && (
            <p className="location-check-progress" role="status">
              {
                check.data.items.filter(
                  (item) =>
                    item.status === 'CONFIRM' || item.status === 'CORRECT',
                ).length
              }{' '}
              {tr('common:of')} {formatNumber(check.data.items.length)}{' '}
              {tr('location-check:checked')}
            </p>
          )}
        </div>
        <Link
          className="secondary"
          to={`/households/${household.id}/inventory`}
        >
          {tr('location-check:inventory2')}
        </Link>
        {targetItemId && (
          <Link
            className="secondary"
            to={`/households/${household.id}/inventory/${targetItemId}`}
          >
            {tr('location-check:backToItem')}
          </Link>
        )}
      </div>
      {!targetItemId && check.data.items.length === 0 ? (
        <Card className="empty">
          <h3>{tr('location-check:itemsAssignedLocation')}</h3>
          <p className="muted">
            {tr('location-check:itemsAppearHere')} {check.data.location.name}.
          </p>
        </Card>
      ) : (
        <div className="location-check-list">
          {targetItemId && visibleItems.length === 0 && (
            <Notice kind="error">
              {tr('location-check:itemNotAtLocation')}
            </Notice>
          )}
          {visibleItems.map((item) => (
            <div key={item.itemId}>
              {conflictItemId === item.itemId && (
                <Notice kind="error">
                  {tr('location-check:stockChangedReviewAgain')}
                </Notice>
              )}
              {savedNotice?.itemId === item.itemId &&
                savedNotice.revision === item.stockRevision &&
                item.status !== 'STALE' && (
                  <Notice kind="success">{savedNotice.text}</Notice>
                )}
              {refreshWarningItemId === item.itemId && (
                <Notice kind="error">
                  {tr('location-check:savedRefreshFailed')}
                </Notice>
              )}
              <LocationCheckCard
                key={`${item.stockRevision}-${item.status}`}
                item={item}
                householdId={household.id}
                locationId={locationId}
                initiallyCorrecting={autoOpenItem === item.itemId}
                onDecisionStart={() => {
                  setSavedNotice(null);
                  setRefreshWarningItemId(null);
                }}
                onSaved={(text, revision) => {
                  setAutoOpenItem(null);
                  setConflictItemId(null);
                  setSavedNotice({ itemId: item.itemId, revision, text });
                }}
                onConflict={() => setConflictItemId(item.itemId)}
                onRefreshWarning={() => setRefreshWarningItemId(item.itemId)}
                refresh={async (savedItem) => {
                  queryClient.setQueryData<LocationStockCheck>(
                    queryKey,
                    (current) =>
                      current && {
                        ...current,
                        items: current.items.map((entry) =>
                          entry.itemId === savedItem.itemId ? savedItem : entry,
                        ),
                      },
                  );
                  await queryClient.invalidateQueries(
                    {
                      queryKey: keys.household(household.id),
                      refetchType: 'all',
                    },
                    { throwOnError: true },
                  );
                }}
                refetch={check.refetch}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
