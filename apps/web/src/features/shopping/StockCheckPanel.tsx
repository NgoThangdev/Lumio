import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { StockLevel } from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';

import { tr } from '../../shared/i18n';
import {
  formatDate,
  formatDateOnly,
  localizedEnum,
  localizedError,
  formatNumber,
} from '../../shared/i18n';
type CheckStatus = 'PENDING' | 'CONFIRM' | 'CORRECT' | 'STALE';
type CheckReason =
  'MISSING_STATE' | 'NO_STOCK_RECORD' | 'STALE_RECORD' | 'STOCK_CHANGED';
type CheckBatch = {
  id: string;
  quantity: string;
  expiryDate: string | null;
  openedAt: string | null;
  openedUseByDate: string | null;
};
type CheckBase = {
  itemId: string;
  name: string;
  openedTrackingEnabled: boolean;
  reason: CheckReason;
  status: CheckStatus;
  stockRevision: number;
  checkedAt: string | null;
  checkedByUserId: string | null;
};
type CheckItem = CheckBase &
  (
    | {
        trackingMode: 'QUANTITY';
        stock: { quantity: string; batches: CheckBatch[] };
      }
    | {
        trackingMode: 'FIVE_LEVEL' | 'PRESENCE_BACKUP';
        stock: {
          currentLevel: StockLevel | null;
          isPresent: boolean | null;
          backupCount: number;
        };
      }
  );
type CheckList = { tripId: string; items: CheckItem[]; changed?: boolean };
type CheckBody = {
  decision?: 'CONFIRM' | 'CORRECT';
  expectedRevision?: number;
  quantity?: string;
  batches?: { batchId: string; quantity: string }[];
  extraUnopenedQuantity?: string;
  currentLevel?: string;
  backupCount?: number;
  isPresent?: boolean;
};

const levels: { value: StockLevel; label: string }[] = [
  { value: 'FULL', label: 'Full' },
  { value: 'THREE_QUARTERS', label: '¾' },
  { value: 'HALF', label: '½' },
  { value: 'QUARTER', label: '¼' },
  { value: 'EMPTY', label: 'Empty' },
];

function StockCheckEntry({
  entry,
  onSave,
}: {
  entry: CheckItem;
  onSave: (
    item: CheckItem,
    body: CheckBody,
  ) => Promise<{ conflict: boolean; refreshFailed: boolean }>;
}) {
  const quantityStock = entry.trackingMode === 'QUANTITY';
  const stateStock = entry.trackingMode !== 'QUANTITY' ? entry.stock : null;
  const [quantity, setQuantity] = useState(
    entry.trackingMode === 'QUANTITY' ? entry.stock.quantity : '',
  );
  const [currentLevel, setCurrentLevel] = useState<StockLevel | ''>(
    entry.trackingMode !== 'QUANTITY' ? (entry.stock.currentLevel ?? '') : '',
  );
  const [isPresent, setIsPresent] = useState(
    entry.trackingMode !== 'QUANTITY' && entry.stock.isPresent !== null
      ? String(entry.stock.isPresent)
      : '',
  );
  const [backupCount, setBackupCount] = useState(
    entry.trackingMode !== 'QUANTITY' ? String(entry.stock.backupCount) : '',
  );
  const [batchQuantities, setBatchQuantities] = useState<
    Record<string, string>
  >({});
  const [extraUnopenedQuantity, setExtraUnopenedQuantity] = useState('0');
  const [showCorrection, setShowCorrection] = useState(false);
  const [batchDetailRequired, setBatchDetailRequired] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stockConflict, setStockConflict] = useState(false);

  useEffect(() => {
    setQuantity(entry.trackingMode === 'QUANTITY' ? entry.stock.quantity : '');
    setCurrentLevel(
      entry.trackingMode !== 'QUANTITY' ? (entry.stock.currentLevel ?? '') : '',
    );
    setIsPresent(
      entry.trackingMode !== 'QUANTITY' && entry.stock.isPresent !== null
        ? String(entry.stock.isPresent)
        : '',
    );
    setBackupCount(
      entry.trackingMode !== 'QUANTITY' ? String(entry.stock.backupCount) : '',
    );
    setBatchQuantities({});
    setExtraUnopenedQuantity('0');
    setBatchDetailRequired(false);
    setStockConflict(entry.status === 'STALE');
    if (entry.status === 'STALE') setNotice('');
  }, [entry.stockRevision, entry.status]);

  async function save(
    decision: 'CONFIRM' | 'CORRECT',
    values?: Omit<CheckBody, 'decision' | 'expectedRevision'>,
  ) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await onSave(entry, {
        decision,
        expectedRevision: entry.stockRevision,
        ...values,
      });
      if (result.conflict) {
        setStockConflict(true);
        setError(tr('shopping:stockChangedReviewAgain'));
      } else {
        setStockConflict(false);
        setNotice(
          decision === 'CONFIRM' ? 'Stock confirmed.' : 'Correction saved.',
        );
        if (result.refreshFailed)
          setError(tr('shopping:stockCheckSavedRefreshWarning'));
      }
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.message.includes('BATCH_DETAIL_REQUIRED')
      ) {
        setBatchDetailRequired(true);
        setShowCorrection(true);
        setBatchQuantities(
          Object.fromEntries(
            (entry.trackingMode === 'QUANTITY'
              ? entry.stock.batches.filter(
                  (batch) => Number(batch.quantity) > 0,
                )
              : []
            ).map((batch) => [batch.id, batch.quantity]),
          ),
        );
        setError(tr('shopping:batchDetailCorrectionGuidance'));
      } else {
        setError(
          cause instanceof Error
            ? localizedError(cause)
            : tr('shopping:stockCheckSaveFailed'),
        );
      }
    } finally {
      setPending(false);
    }
  }

  function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (entry.trackingMode === 'QUANTITY') {
      const batchPayload =
        batchDetailRequired && entry.trackingMode === 'QUANTITY'
          ? {
              batches: entry.stock.batches
                .filter((batch) => Number(batch.quantity) > 0)
                .map((batch) => ({
                  batchId: batch.id,
                  quantity: batchQuantities[batch.id] ?? batch.quantity,
                })),
              extraUnopenedQuantity,
            }
          : {};
      void save('CORRECT', { quantity, ...batchPayload });
    } else if (entry.trackingMode === 'FIVE_LEVEL') {
      void save('CORRECT', {
        currentLevel: currentLevel as string,
        backupCount: Number(backupCount),
      });
    } else {
      void save('CORRECT', {
        isPresent: isPresent === 'true',
        backupCount: Number(backupCount),
      });
    }
  }

  return (
    <article className="stock-check-entry">
      <div className="stock-check-title">
        <div>
          <strong>{entry.name}</strong>
          <small>
            {localizedEnum(entry.trackingMode)} · {localizedEnum(entry.reason)}
          </small>
        </div>
        <span
          className={`pill ${entry.status === 'STALE' ? 'stock-check-stale' : ''}`}
        >
          {localizedEnum(entry.status)}
        </span>
      </div>
      {quantityStock ? (
        <>
          <p className="muted">
            {tr('shopping:currentTotal')}{' '}
            <strong>{formatNumber(entry.stock.quantity)}</strong>
          </p>
          {entry.openedTrackingEnabled && (
            <p className="muted">{tr('shopping:openingTrackingEnabled')}</p>
          )}
        </>
      ) : (
        <p className="muted">
          {tr('shopping:currentState')}{' '}
          <strong>
            {entry.trackingMode === 'FIVE_LEVEL'
              ? localizedEnum(entry.stock.currentLevel ?? 'Not set')
              : entry.stock.isPresent === null
                ? tr('common:set')
                : tr(
                    entry.stock.isPresent ? 'common:present' : 'common:absent',
                  )}
          </strong>{' '}
          {tr('shopping:backups3')}{' '}
          <strong>{formatNumber(stateStock?.backupCount ?? 0)}</strong>
        </p>
      )}
      {entry.checkedAt && (
        <small className="muted">
          {tr('shopping:lastSaved', { date: formatDate(entry.checkedAt) })}
        </small>
      )}
      {entry.status === 'STALE' && (
        <Notice kind="error">{tr('shopping:inventoryChangedSaved')}</Notice>
      )}
      {stockConflict && entry.status !== 'STALE' && (
        <Notice kind="error">{tr('shopping:reviewLatestStock2')}</Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      <div className="stock-check-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => void save('CONFIRM')}
        >
          {pending ? tr('common:saving') : tr('common:confirm')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setShowCorrection((current) => !current)}
        >
          {showCorrection ? tr('common:closeCorrection') : tr('common:correct')}
        </Button>
      </div>
      {showCorrection && (
        <form className="stock-check-correction" onSubmit={correct}>
          {entry.trackingMode === 'QUANTITY' ? (
            <>
              <label>
                {tr('shopping:observedTotalQuantity')}
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  required
                />
              </label>
              {batchDetailRequired && quantityStock && (
                <>
                  <p className="muted">{tr('shopping:enterObservedCount')}</p>
                  {entry.trackingMode === 'QUANTITY' &&
                    entry.stock.batches
                      .filter((batch) => Number(batch.quantity) > 0)
                      .map((batch) => (
                        <label className="stock-check-batch" key={batch.id}>
                          <span>
                            {tr('shopping:batch2')}{' '}
                            {batch.expiryDate
                              ? tr('shopping:expires3', {
                                  date: formatDateOnly(batch.expiryDate),
                                })
                              : tr('common:expiry2')}
                            {batch.openedAt
                              ? tr('shopping:opened2', {
                                  date: formatDateOnly(batch.openedAt),
                                })
                              : ` · ${tr('common:unopened')}`}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            value={batchQuantities[batch.id] ?? batch.quantity}
                            onChange={(event) =>
                              setBatchQuantities((current) => ({
                                ...current,
                                [batch.id]: event.target.value,
                              }))
                            }
                            required
                          />
                        </label>
                      ))}
                  <label>
                    {tr('shopping:extraUnopenedQuantity')}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={extraUnopenedQuantity}
                      onChange={(event) =>
                        setExtraUnopenedQuantity(event.target.value)
                      }
                      required
                    />
                  </label>
                  <p className="muted">{tr('shopping:batchCountsPlus')}</p>
                </>
              )}
            </>
          ) : entry.trackingMode === 'FIVE_LEVEL' ? (
            <>
              <label>
                {tr('common:currentLevel')}
                <select
                  value={currentLevel}
                  onChange={(event) =>
                    setCurrentLevel(event.target.value as StockLevel)
                  }
                  required
                >
                  <option value="">{tr('shopping:chooseLevel2')}</option>
                  {levels.map((level) => (
                    <option value={level.value} key={level.value}>
                      {localizedEnum(level.value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr('common:backupCount')}
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={backupCount}
                  onChange={(event) => setBackupCount(event.target.value)}
                  required
                />
              </label>
            </>
          ) : (
            <>
              <label>
                {tr('common:currentItem')}
                <select
                  value={isPresent}
                  onChange={(event) => setIsPresent(event.target.value)}
                  required
                >
                  <option value="">{tr('shopping:chooseState2')}</option>
                  <option value="true">{tr('common:present')}</option>
                  <option value="false">{tr('common:absent')}</option>
                </select>
              </label>
              <label>
                {tr('common:backupCount')}
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={backupCount}
                  onChange={(event) => setBackupCount(event.target.value)}
                  required
                />
              </label>
            </>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? tr('common:saving') : tr('common:saveCorrection')}
          </Button>
        </form>
      )}
    </article>
  );
}

export function StockCheckPanel({
  householdId,
  tripId,
}: {
  householdId: string;
  tripId: string;
}) {
  const queryClient = useQueryClient();
  const checkQuery = useQuery({
    queryKey: [...keys.trip(householdId, tripId), 'stock-check'],
    queryFn: () =>
      api<CheckList>(`/households/${householdId}/trips/${tripId}/stock-check`),
  });
  const saveCheck = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: CheckBody }) =>
      api<CheckList>(
        `/households/${householdId}/trips/${tripId}/stock-check/${itemId}`,
        'PUT',
        body,
      ),
    retry: false,
  });

  async function save(item: CheckItem, body: CheckBody) {
    try {
      const response = await saveCheck.mutateAsync({
        itemId: item.itemId,
        body,
      });
      queryClient.setQueryData(
        [...keys.trip(householdId, tripId), 'stock-check'],
        response,
      );
      if (body.decision === 'CORRECT' && response.changed) {
        const refreshes = await Promise.allSettled([
          queryClient.invalidateQueries(
            { queryKey: keys.items(householdId), refetchType: 'all' },
            { throwOnError: true },
          ),
          queryClient.invalidateQueries(
            {
              queryKey: keys.item(householdId, item.itemId),
              refetchType: 'all',
            },
            { throwOnError: true },
          ),
          queryClient.invalidateQueries(
            { queryKey: keys.needsAttention(householdId), refetchType: 'all' },
            { throwOnError: true },
          ),
          queryClient.invalidateQueries(
            { queryKey: keys.recentActivity(householdId), refetchType: 'all' },
            { throwOnError: true },
          ),
          queryClient.invalidateQueries(
            {
              queryKey: [...keys.household(householdId), 'intelligence'],
              refetchType: 'all',
            },
            { throwOnError: true },
          ),
        ]);
        return {
          conflict: false,
          refreshFailed: refreshes.some(
            (result) => result.status === 'rejected',
          ),
        };
      }
      return { conflict: false, refreshFailed: false };
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.message.includes('STOCK_CHANGED')
      ) {
        await checkQuery.refetch();
        return { conflict: true, refreshFailed: false };
      }
      throw cause;
    }
  }

  if (checkQuery.isPending)
    return (
      <Card>
        <p className="muted">{tr('shopping:loadingPreShopping')}</p>
      </Card>
    );
  if (checkQuery.isError)
    return (
      <Card>
        <p className="eyebrow">{tr('shopping:checkHome')}</p>
        <Notice kind="error">
          {tr('shopping:stockCheckLoad')} {localizedError(checkQuery.error)}
        </Notice>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void checkQuery.refetch()}
        >
          {tr('shopping:retryStockCheck')}
        </Button>
      </Card>
    );

  const checkedCount = checkQuery.data.items.filter(
    (item) => item.status === 'CONFIRM' || item.status === 'CORRECT',
  ).length;
  return (
    <Card className="stock-check-panel">
      <p className="eyebrow">{tr('common:shopping')}</p>
      <h3>{tr('shopping:checkHome')}</h3>
      <p className="muted">{tr('shopping:reviewApiRanked')}</p>
      <p className="stock-check-progress" role="status">
        {formatNumber(checkedCount)} {tr('common:of')}{' '}
        {formatNumber(checkQuery.data.items.length)}{' '}
        {tr('shopping:checksSaved')}
      </p>
      {checkQuery.data.items.length === 0 ? (
        <p className="muted">{tr('shopping:apiReturnedItems')}</p>
      ) : (
        <div className="stock-check-list">
          {checkQuery.data.items.map((entry) => (
            <StockCheckEntry key={entry.itemId} entry={entry} onSave={save} />
          ))}
        </div>
      )}
    </Card>
  );
}
