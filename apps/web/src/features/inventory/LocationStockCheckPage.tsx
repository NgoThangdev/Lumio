import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useHousehold } from '../../app/useHousehold';
import { ApiError, api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  LocationCheckItem,
  LocationStockCheck,
  StockLevel,
} from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';

import { tr } from '../../shared/i18n';
import {
  formatDate,
  formatDateOnly,
  formatNumber,
  localizedError,
  localizedEnum,
} from '../../shared/i18n';
const levels: StockLevel[] = [
  'FULL',
  'THREE_QUARTERS',
  'HALF',
  'QUARTER',
  'EMPTY',
];

function showReason(reason: LocationCheckItem['reason']) {
  const labels: Record<LocationCheckItem['reason'], string> = {
    STOCK_CHANGED: tr('location-check:stockChangedSinceCheck'),
    MISSING_STATE: tr('location-check:missingCurrentState'),
    NO_STOCK_RECORD: tr('location-check:noLocationStockRecord'),
    STALE_RECORD: tr('location-check:stockRecordOld'),
    RECENT_RECORD: tr('location-check:recentStockRecord'),
  };
  return labels[reason];
}

export function LocationStockCheckPage() {
  const household = useHousehold();
  const { locationId = '' } = useParams();
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

  return (
    <section className="location-stock-check-page">
      <div className="location-check-heading">
        <div>
          <h1>{check.data.location.name}</h1>
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
        </div>
        <Link
          className="secondary"
          to={`/households/${household.id}/inventory`}
        >
          {tr('location-check:inventory2')}
        </Link>
      </div>
      {check.data.items.length === 0 ? (
        <Card className="empty">
          <h3>{tr('location-check:itemsAssignedLocation')}</h3>
          <p className="muted">
            {tr('location-check:itemsAppearHere')} {check.data.location.name}.
          </p>
        </Card>
      ) : (
        <div className="location-check-list">
          {check.data.items.map((item) => (
            <LocationCheckCard
              key={`${item.itemId}-${item.stockRevision}`}
              item={item}
              householdId={household.id}
              locationId={locationId}
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
                await queryClient.invalidateQueries({
                  queryKey: keys.household(household.id),
                  refetchType: 'all',
                });
              }}
              refetch={check.refetch}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LocationCheckCard({
  item,
  householdId,
  locationId,
  refresh,
  refetch,
}: {
  item: LocationCheckItem;
  householdId: string;
  locationId: string;
  refresh: (item: LocationCheckItem) => Promise<void>;
  refetch: () => Promise<{ data: LocationStockCheck | undefined }>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [batchEditing, setBatchEditing] = useState(false);
  const [quantity, setQuantity] = useState(item.stock.quantity ?? '');
  const [batchCounts, setBatchCounts] = useState<Record<string, string>>({});
  const [extraQuantity, setExtraQuantity] = useState('0');
  const [extraExpiry, setExtraExpiry] = useState('');
  const [level, setLevel] = useState<StockLevel | ''>(
    item.stock.currentLevel ?? '',
  );
  const [presence, setPresence] = useState(
    item.stock.isPresent === true
      ? 'true'
      : item.stock.isPresent === false
        ? 'false'
        : '',
  );
  const [backups, setBackups] = useState(String(item.stock.backupCount ?? 0));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [freshDecisionRequired, setFreshDecisionRequired] = useState(false);
  const [batchDataUnavailable, setBatchDataUnavailable] = useState(false);
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ item: LocationCheckItem; changed: boolean }>(
        `/households/${householdId}/locations/${locationId}/stock-check/${item.itemId}`,
        'PUT',
        body,
      ),
  });

  const run = async (body: Record<string, unknown>, successText: string) => {
    setError('');
    setMessage('');
    setFreshDecisionRequired(false);
    setBatchDataUnavailable(false);
    try {
      const result = await mutation.mutateAsync({
        expectedRevision: item.stockRevision,
        ...body,
      });
      await refresh(result.item);
      setCorrecting(false);
      setBatchEditing(false);
      setMessage(successText);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : null;
      if (code === 'BATCH_DETAIL_REQUIRED') {
        const reloaded = await refetch();
        const observedItem = reloaded.data?.items.find(
          (entry) => entry.itemId === item.itemId,
        );
        const observedBatches = observedItem?.stock.batches ?? [];
        const positive = observedBatches.filter(
          (batch) => Number(batch.quantity) > 0,
        );
        if (positive.length) {
          setBatchCounts(
            Object.fromEntries(
              positive.map((batch) => [batch.id, batch.quantity]),
            ),
          );
          setBatchEditing(true);
          setCorrecting(true);
        } else {
          setBatchDataUnavailable(true);
        }
        setError(tr('location-check:batchCountsRequired'));
      } else if (code === 'STOCK_CHANGED') {
        setFreshDecisionRequired(true);
        setError(tr('location-check:stockChangedReviewAgain'));
        await refetch();
      } else {
        setError(
          cause instanceof Error
            ? localizedError(cause)
            : tr('location-check:locationCheckSaveFailed'),
        );
      }
    }
  };

  const checkedAt = item.checkedAt ? formatDate(item.checkedAt) : null;
  const orderedPositiveBatches = (item.stock.batches ?? []).filter(
    (batch) => Number(batch.quantity) > 0,
  );

  return (
    <Card className={`location-check-item status-${item.status.toLowerCase()}`}>
      <div className="location-check-item-heading">
        <div>
          <p className="eyebrow">{localizedEnum(item.trackingMode)}</p>
          <h3>{item.name}</h3>
        </div>
        <span
          className={`location-check-status location-check-status-${item.status.toLowerCase()}`}
        >
          {localizedEnum(item.status)}
        </span>
      </div>
      <p className="location-check-reason">{showReason(item.reason)}</p>
      {item.trackingMode === 'QUANTITY' ? (
        <div className="location-check-stock">
          <strong>{formatNumber(item.stock.quantity ?? '—')}</strong>{' '}
          <span>{tr('location-check:location2')}</span>
          {!!item.stock.batches?.length && (
            <div className="location-check-batches">
              {item.stock.batches.map((batch) => (
                <div className="location-check-batch" key={batch.id}>
                  <span>
                    {formatNumber(batch.quantity)} ·{' '}
                    {batch.openedAt
                      ? tr('location-check:opened5', {
                          date: formatDateOnly(batch.openedAt),
                        })
                      : 'unopened'}
                  </span>
                  <small>
                    {batch.expiryDate
                      ? tr('common:expires2', {
                          date: formatDateOnly(batch.expiryDate),
                        })
                      : tr('common:expiry2')}
                    {batch.openedUseByDate
                      ? tr('common:use2', {
                          date: formatDateOnly(batch.openedUseByDate),
                        })
                      : ''}
                  </small>
                </div>
              ))}
            </div>
          )}
          {item.openedTrackingEnabled && (
            <p className="muted">{tr('location-check:openingTrackingApi')}</p>
          )}
        </div>
      ) : (
        <div className="location-check-stock state-check-stock">
          {Object.hasOwn(item.stock, 'currentLevel') && (
            <p>
              {tr('location-check:currentLevel2')}{' '}
              <strong>
                {(item.stock.currentLevel
                  ? localizedEnum(item.stock.currentLevel)
                  : undefined) ?? tr('location-check:recorded')}
              </strong>
            </p>
          )}
          {Object.hasOwn(item.stock, 'isPresent') && (
            <p>
              {tr('location-check:currentItem2')}{' '}
              <strong>
                {item.stock.isPresent === null
                  ? tr('location-check:recorded')
                  : item.stock.isPresent
                    ? tr('common:present')
                    : tr('common:absent')}
              </strong>
            </p>
          )}
          {Object.hasOwn(item.stock, 'backupCount') && (
            <p>
              {tr('location-check:backupsLocation2')}{' '}
              <strong>{formatNumber(item.stock.backupCount ?? '—')}</strong>
            </p>
          )}
          {!Object.keys(item.stock).length && (
            <p className="muted">{tr('location-check:currentBackupStock')}</p>
          )}
        </div>
      )}
      {checkedAt && (
        <p className="muted location-check-saved">
          {tr('location-check:lastChecked')} {checkedAt}
          {item.checkedByUserId
            ? ` · ${tr('location-check:savedByHouseholdMember')}`
            : ''}
        </p>
      )}
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {(freshDecisionRequired || item.status === 'STALE') && (
        <p className="muted" role="status">
          {tr('common:reviewLatestStock')}
        </p>
      )}
      {batchDataUnavailable && (
        <p className="muted">{tr('location-check:checklistReturnCurrent')}</p>
      )}
      <div className="location-check-actions">
        <Button
          type="button"
          disabled={mutation.isPending}
          onClick={() =>
            void run(
              { decision: 'CONFIRM' },
              tr('location-check:locationStockConfirmed'),
            )
          }
        >
          {mutation.isPending
            ? tr('common:saving')
            : tr('location-check:confirmStockHere')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            setError('');
            setMessage('');
            setBatchEditing(false);
            setCorrecting((current) => !current);
          }}
        >
          {correcting
            ? tr('common:closeCorrection')
            : tr('location-check:correctStock')}
        </Button>
      </div>
      {correcting && (
        <form
          className="location-check-correction"
          onSubmit={(event) => {
            event.preventDefault();
            if (item.trackingMode === 'QUANTITY') {
              if (batchEditing) {
                void run(
                  {
                    decision: 'CORRECT',
                    quantity,
                    batches: orderedPositiveBatches.map((batch) => ({
                      batchId: batch.id,
                      quantity: batchCounts[batch.id] ?? batch.quantity,
                    })),
                    extraUnopenedQuantity: extraQuantity || '0',
                    ...(Number(extraQuantity) > 0 && extraExpiry
                      ? { extraExpiryDate: extraExpiry }
                      : {}),
                  },
                  tr('location-check:locationStockCorrectionSaved'),
                );
              } else {
                void run(
                  { decision: 'CORRECT', quantity },
                  tr('location-check:locationStockCorrectionSaved'),
                );
              }
            } else {
              const observation: Record<string, unknown> = {
                decision: 'CORRECT',
              };
              if (Object.hasOwn(item.stock, 'currentLevel') && level)
                observation.currentLevel = level;
              if (Object.hasOwn(item.stock, 'isPresent') && presence !== '')
                observation.isPresent = presence === 'true';
              if (Object.hasOwn(item.stock, 'backupCount'))
                observation.backupCount = Number(backups);
              void run(
                observation,
                tr('location-check:locationStateCorrectionSaved'),
              );
            }
          }}
        >
          {item.trackingMode === 'QUANTITY' ? (
            <>
              <label>
                {tr('location-check:totalQuantity')}{' '}
                {tr('location-check:thisLocation')}
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  required
                />
              </label>
              {!batchEditing ? (
                <p className="muted">{tr('location-check:changesOnlyStock')}</p>
              ) : (
                <>
                  {orderedPositiveBatches.map((batch) => (
                    <label className="batch-observation" key={batch.id}>
                      {tr('common:batch')} {batch.id.slice(0, 8)} ·{' '}
                      {batch.openedAt
                        ? tr('common:opened')
                        : tr('common:unopened')}{' '}
                      ·{' '}
                      {batch.expiryDate
                        ? `expires ${batch.expiryDate}`
                        : tr('common:expiry2')}
                      <input
                        type="number"
                        min="0"
                        step={
                          item.openedTrackingEnabled && !batch.openedAt
                            ? '1'
                            : '0.000001'
                        }
                        inputMode="decimal"
                        value={batchCounts[batch.id] ?? batch.quantity}
                        onChange={(event) =>
                          setBatchCounts((current) => ({
                            ...current,
                            [batch.id]: event.target.value,
                          }))
                        }
                        required
                      />
                    </label>
                  ))}
                  <label>
                    {tr('location-check:additionalUnopenedQuantity')}
                    <input
                      type="number"
                      min="0"
                      step={item.openedTrackingEnabled ? '1' : '0.000001'}
                      inputMode={
                        item.openedTrackingEnabled ? 'numeric' : 'decimal'
                      }
                      value={extraQuantity}
                      onChange={(event) => setExtraQuantity(event.target.value)}
                    />
                  </label>
                  {Number(extraQuantity) > 0 && (
                    <label>
                      {tr('location-check:expiryAdditionalQuantity')}{' '}
                      <em>{tr('common:optional2')}</em>
                      <input
                        type="date"
                        value={extraExpiry}
                        onChange={(event) => setExtraExpiry(event.target.value)}
                      />
                    </label>
                  )}
                  <p className="muted">{tr('location-check:batchIdsExpiry')}</p>
                </>
              )}
            </>
          ) : (
            <>
              {Object.hasOwn(item.stock, 'currentLevel') && (
                <label>
                  {tr('common:currentLevel')}
                  <select
                    value={level}
                    onChange={(event) =>
                      setLevel(event.target.value as StockLevel | '')
                    }
                    required
                  >
                    <option value="">
                      {tr('location-check:chooseObservedLevel')}
                    </option>
                    {levels.map((entry) => (
                      <option key={entry} value={entry}>
                        {localizedEnum(entry)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {Object.hasOwn(item.stock, 'isPresent') && (
                <label>
                  {tr('common:currentItem')}
                  <select
                    value={presence}
                    onChange={(event) => setPresence(event.target.value)}
                    required
                  >
                    <option value="">
                      {tr('location-check:chooseObservedState')}
                    </option>
                    <option value="true">{tr('common:present')}</option>
                    <option value="false">{tr('common:absent')}</option>
                  </select>
                </label>
              )}
              {Object.hasOwn(item.stock, 'backupCount') && (
                <label>
                  {tr('location-check:backupsLocation')}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={backups}
                    onChange={(event) => setBackups(event.target.value)}
                    required
                  />
                </label>
              )}
            </>
          )}
          <Button
            type="submit"
            variant="secondary"
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? tr('common:saving')
              : batchEditing
                ? tr('location-check:saveBatchObservations')
                : tr('common:saveCorrection')}
          </Button>
        </form>
      )}
    </Card>
  );
}
