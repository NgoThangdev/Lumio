import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { StockLevel } from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';

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
        setNotice(
          'Stock changed since this check. Review the refreshed stock above, then choose Confirm or Correct again.',
        );
      } else {
        setStockConflict(false);
        setNotice(
          decision === 'CONFIRM' ? 'Stock confirmed.' : 'Correction saved.',
        );
        if (result.refreshFailed)
          setError(
            'Saved successfully, but some inventory views did not refresh. Reload Inventory to verify current stock.',
          );
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
        setError(
          'The API needs batch-level detail to preserve expiry and opened-stock accounting. Review the returned batches and enter each observed count.',
        );
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : 'This stock check could not be saved.',
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
            {entry.trackingMode === 'QUANTITY'
              ? 'Quantity'
              : entry.trackingMode === 'FIVE_LEVEL'
                ? 'Five-level'
                : 'Presence + backups'}{' '}
            · {entry.reason.replaceAll('_', ' ').toLowerCase()}
          </small>
        </div>
        <span
          className={`pill ${entry.status === 'STALE' ? 'stock-check-stale' : ''}`}
        >
          {entry.status.toLowerCase()}
        </span>
      </div>
      {quantityStock ? (
        <>
          <p className="muted">
            Current total: <strong>{entry.stock.quantity}</strong>
          </p>
          {entry.openedTrackingEnabled && (
            <p className="muted">
              Opening tracking is enabled. The API validates package counts.
            </p>
          )}
        </>
      ) : (
        <p className="muted">
          Current state:{' '}
          <strong>
            {entry.trackingMode === 'FIVE_LEVEL'
              ? (entry.stock.currentLevel ?? 'Not set')
              : entry.stock.isPresent === null
                ? 'Not set'
                : entry.stock.isPresent
                  ? 'Present'
                  : 'Absent'}
          </strong>{' '}
          · Backups: <strong>{stateStock?.backupCount ?? 0}</strong>
        </p>
      )}
      {entry.checkedAt && (
        <small className="muted">
          Last saved {new Date(entry.checkedAt).toLocaleString()}
        </small>
      )}
      {entry.status === 'STALE' && (
        <Notice kind="error">
          Inventory changed after the saved check. Review this latest stock
          before confirming or correcting again.
        </Notice>
      )}
      {stockConflict && entry.status !== 'STALE' && (
        <Notice kind="error">
          Review the latest stock before saving this check again.
        </Notice>
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
          {pending ? 'Saving…' : 'Confirm'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setShowCorrection((current) => !current)}
        >
          {showCorrection ? 'Close correction' : 'Correct'}
        </Button>
      </div>
      {showCorrection && (
        <form className="stock-check-correction" onSubmit={correct}>
          {entry.trackingMode === 'QUANTITY' ? (
            <>
              <label>
                Observed total quantity
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
                  <p className="muted">
                    Enter the observed count for each positive batch from the
                    API response. Batch identity stays attached to its
                    expiry/opened dates. Any extra stock is recorded as unopened
                    and undated.
                  </p>
                  {entry.trackingMode === 'QUANTITY' &&
                    entry.stock.batches
                      .filter((batch) => Number(batch.quantity) > 0)
                      .map((batch) => (
                        <label className="stock-check-batch" key={batch.id}>
                          <span>
                            Batch ·{' '}
                            {batch.expiryDate
                              ? `expires ${batch.expiryDate}`
                              : 'no expiry'}
                            {batch.openedAt
                              ? ` · opened ${batch.openedAt.slice(0, 10)}`
                              : ' · unopened'}
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
                    Extra unopened quantity
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
                  <p className="muted">
                    Batch counts plus extra unopened quantity must equal the
                    observed total. The API will validate the correction.
                  </p>
                </>
              )}
            </>
          ) : entry.trackingMode === 'FIVE_LEVEL' ? (
            <>
              <label>
                Current level
                <select
                  value={currentLevel}
                  onChange={(event) =>
                    setCurrentLevel(event.target.value as StockLevel)
                  }
                  required
                >
                  <option value="">Choose level</option>
                  {levels.map((level) => (
                    <option value={level.value} key={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Backup count
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
                Current item
                <select
                  value={isPresent}
                  onChange={(event) => setIsPresent(event.target.value)}
                  required
                >
                  <option value="">Choose state</option>
                  <option value="true">Present</option>
                  <option value="false">Absent</option>
                </select>
              </label>
              <label>
                Backup count
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
            {pending ? 'Saving…' : 'Save correction'}
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
        <p className="muted">Loading pre-shopping stock check…</p>
      </Card>
    );
  if (checkQuery.isError)
    return (
      <Card>
        <p className="eyebrow">Check what is at home</p>
        <Notice kind="error">
          The stock check could not load: {checkQuery.error.message}
        </Notice>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void checkQuery.refetch()}
        >
          Retry stock check
        </Button>
      </Card>
    );

  const checkedCount = checkQuery.data.items.filter(
    (item) => item.status === 'CONFIRM' || item.status === 'CORRECT',
  ).length;
  return (
    <Card className="stock-check-panel">
      <p className="eyebrow">Before shopping</p>
      <h3>Check what is at home</h3>
      <p className="muted">
        Review the API-ranked shortlist. Each result saves separately, so you
        can leave and resume. Import remains available without completing every
        check.
      </p>
      <p className="stock-check-progress" role="status">
        {checkedCount} of {checkQuery.data.items.length} checks saved
      </p>
      {checkQuery.data.items.length === 0 ? (
        <p className="muted">The API returned no items for this stock check.</p>
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
