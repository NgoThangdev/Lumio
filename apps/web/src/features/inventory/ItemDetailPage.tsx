import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router';
import { useHousehold } from '../../app/useHousehold';
import { ApiError, api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  Assessment,
  CatalogOption,
  Config,
  Intelligence,
  Item,
  StockLevel,
  UndoCandidate,
  UndoEligibility,
  UndoResult,
} from '../../shared/api/types';
import {
  Button,
  Card,
  ItemVisual,
  Notice,
  StockBadge,
} from '../../shared/ui/primitives';

const asDate = (value: string | null) =>
  value ? value.slice(0, 10) : 'No expiry';

export function ItemDetailPage() {
  const household = useHousehold();
  const { itemId = '' } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [restock, setRestock] = useState('');
  const [expiry, setExpiry] = useState('');
  const [restockLocation, setRestockLocation] = useState<string | null>(null);
  const [use, setUse] = useState('');
  const [notice, setNotice] = useState(
    (location.state as { notice?: string } | null)?.notice ?? '',
  );
  const [undoCandidate, setUndoCandidate] = useState<UndoCandidate | null>(
    null,
  );
  const itemQuery = useQuery({
    queryKey: keys.item(household.id, itemId),
    queryFn: () => api<Item>(`/households/${household.id}/items/${itemId}`),
  });
  const intelligence = useQuery({
    queryKey: keys.intelligence(household.id, ''),
    queryFn: () =>
      api<Intelligence>(`/households/${household.id}/stock-intelligence`),
  });
  const locations = useQuery({
    queryKey: keys.catalog(household.id, 'locations'),
    queryFn: () =>
      api<CatalogOption[]>(`/households/${household.id}/locations`),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: keys.item(household.id, itemId),
      }),
      queryClient.invalidateQueries({ queryKey: keys.items(household.id) }),
      queryClient.invalidateQueries({
        queryKey: ['household', household.id, 'intelligence'],
      }),
      queryClient.invalidateQueries({
        queryKey: keys.needsAttention(household.id),
      }),
      queryClient.invalidateQueries({
        queryKey: keys.recentActivity(household.id),
      }),
      queryClient.invalidateQueries({ queryKey: keys.trips(household.id) }),
      queryClient.invalidateQueries({
        queryKey: ['household', household.id, 'trip'],
      }),
    ]);
  };
  const restockAction = useMutation({
    mutationFn: (input: {
      quantity: string;
      expiryDate: string | null;
      locationId?: string;
    }) =>
      api(`/households/${household.id}/items/${itemId}/restock`, 'POST', {
        ...input,
      }),
    onSuccess: refresh,
  });
  const useAction = useMutation({
    mutationFn: () =>
      api<{ id: string; undoEligibility?: UndoEligibility }>(
        `/households/${household.id}/items/${itemId}/use`,
        'POST',
        { quantity: use },
      ),
    onSuccess: async (result) => {
      await refresh();
      setUndoCandidate(
        itemQuery.data?.trackingMode === 'QUANTITY' &&
          itemQuery.data.openedTrackingEnabled === false &&
          result.undoEligibility?.eligible === true
          ? { actionId: result.id, actionKind: 'INVENTORY' }
          : null,
      );
    },
  });
  const undoAction = useMutation({
    mutationFn: (candidate: UndoCandidate) =>
      api<UndoResult>(
        `/households/${household.id}/items/${itemId}/undo`,
        'POST',
        candidate,
      ),
    onSuccess: async (result) => {
      setUndoCandidate(null);
      await refresh();
      setNotice(
        result.alreadyUndone
          ? 'This action was already undone. Stock and activity refreshed.'
          : 'Action undone. Stock and activity refreshed.',
      );
    },
    onError: async (error) => {
      await refresh();
      if (error instanceof ApiError && error.status === 409)
        setUndoCandidate(null);
    },
  });
  const item = itemQuery.data;
  const restockLocationId =
    restockLocation ?? item?.preferredRestockLocation?.id ?? '';
  const assessment = intelligence.data?.assessments.find(
    (entry) => entry.itemId === itemId,
  );
  const stockCheckEvents = (item?.stockChecks ?? [])
    .flatMap((check) =>
      check.history.map((event, index) => ({
        ...event,
        checkId: check.id,
        index,
      })),
    )
    .sort(
      (left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt),
    );
  const busy =
    restockAction.isPending || useAction.isPending || undoAction.isPending;
  const needsRestockLocation =
    restockAction.error instanceof ApiError &&
    restockAction.error.code === 'LOCATION_REQUIRED' &&
    restockAction.error.itemId === itemId;

  if (itemQuery.isPending)
    return (
      <Card>
        <p className="muted">Loading item detail…</p>
      </Card>
    );
  if (itemQuery.isError)
    return (
      <>
        {notice && <Notice kind="success">{notice}</Notice>}
        <Notice kind="error">
          {notice
            ? `The item was saved, but its latest detail could not be refreshed. Check Inventory or retry opening this item. ${itemQuery.error.message}`
            : itemQuery.error.message}
        </Notice>
      </>
    );
  if (!item) return <Notice kind="error">Item detail is unavailable.</Notice>;
  return (
    <>
      <div className="detail-intro">
        <div>
          <p className="eyebrow">A little part of your home</p>
          <h2 className="detail-title">{item.name}</h2>
          <div className="detail-badges">
            <StockBadge status={assessment?.lowStockRisk} />
            {assessment?.expiryRisk === 'USE_SOON' && (
              <StockBadge status="USE_SOON" />
            )}
          </div>
        </div>
        <ItemVisual name={item.name} large />
      </div>
      {notice && <Notice kind="success">{notice}</Notice>}
      {undoCandidate && (
        <Card className="action-card">
          <p className="eyebrow">Recent action</p>
          <p className="muted">The server says this action can be undone.</p>
          {undoAction.isError && (
            <Notice kind="error">{undoAction.error.message}</Notice>
          )}
          {undoAction.isPending && (
            <p className="muted" role="status">
              Undoing action...
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={undoAction.isPending}
            onClick={() => undoAction.mutate(undoCandidate)}
          >
            Undo
          </Button>
        </Card>
      )}
      {!undoCandidate && undoAction.isError && (
        <Notice kind="error">{undoAction.error.message}</Notice>
      )}
      {intelligence.isError && (
        <Notice kind="error">
          Assessment could not be loaded: {intelligence.error.message}
        </Notice>
      )}
      <div
        className={
          item.trackingMode === 'QUANTITY'
            ? 'detail-grid'
            : 'detail-grid state-detail'
        }
      >
        <div className="stack detail-overview">
          {item.trackingMode === 'QUANTITY' ? (
            <section className="stock-summary">
              <p className="eyebrow">Ready to use</p>
              <strong>{assessment?.eligibleStock ?? '—'}</strong>{' '}
              <span>{item.primaryUnit}</span>
              <p>
                Physical: {assessment?.physicalStock ?? '—'} {item.primaryUnit}{' '}
                · Expired: {assessment?.expiredStock ?? '—'} {item.primaryUnit}
              </p>
              {item.openedTrackingEnabled && (
                <p>
                  Opened: {item.openedQuantity ?? '—'} {item.primaryUnit} ·
                  Unopened: {item.unopenedQuantity ?? '—'} {item.primaryUnit}
                </p>
              )}
              {item.openedTrackingEnabled && (
                <p className="muted">
                  Opening tracking is on
                  {item.recommendedDaysAfterOpening
                    ? ` · use within ${item.recommendedDaysAfterOpening} days after opening`
                    : ' · no use-by interval set'}
                  .
                </p>
              )}
            </section>
          ) : (
            <section className="stock-summary">
              <p className="eyebrow">
                {item.trackingMode === 'FIVE_LEVEL'
                  ? 'Current level'
                  : 'Current item'}
              </p>
              <strong className="state-value">
                {item.trackingMode === 'FIVE_LEVEL'
                  ? (item.currentLevel?.replaceAll('_', ' ').toLowerCase() ??
                    '—')
                  : item.isPresent
                    ? 'Present'
                    : 'Absent'}
              </strong>
              <p>
                {item.backupCount}{' '}
                {item.backupCount === 1 ? 'backup' : 'backups'} available
              </p>
              {item.currentLocation?.name && (
                <p>Current location: {item.currentLocation.name}</p>
              )}
              {item.backupLocation?.name && (
                <p>Backup location: {item.backupLocation.name}</p>
              )}
            </section>
          )}
          {intelligence.isPending && (
            <Card className="assessment-loading">
              <p className="muted">Loading stock assessment…</p>
            </Card>
          )}
          {assessment && (
            <Card className="assessment-card">
              <p className="eyebrow">Stock health</p>
              <h2>How things are looking</h2>
              {assessment.reasons.map((reason) => (
                <p className="muted" key={reason}>
                  {reason}
                </p>
              ))}
              {assessment.expiryReason && (
                <p className="use-soon-note">{assessment.expiryReason}</p>
              )}
              {item.trackingMode === 'QUANTITY' && (
                <p className="muted">
                  {assessment.prediction.reason}
                  {assessment.prediction.basis === 'USE_14_DAY' &&
                    ` Daily rate: ${assessment.prediction.dailyRate} ${item.primaryUnit}; projected need through ${intelligence.data?.shoppingDate}: ${assessment.prediction.projectedNeed} ${item.primaryUnit}.`}
                </p>
              )}
              {item.trackingMode !== 'QUANTITY' &&
                assessment.recommendedAction &&
                assessment.recommendedAction !== 'NONE' && (
                  <p className="muted">
                    Recommended:{' '}
                    {assessment.recommendedAction === 'OPEN_REFILL'
                      ? 'Open a backup'
                      : 'Buy a backup'}
                  </p>
                )}
            </Card>
          )}
        </div>
        {item.trackingMode === 'QUANTITY' && (
          <div className="stack detail-actions">
            <Card className="action-card use-action">
              <details>
                <summary className="action-summary">
                  <span aria-hidden="true">−</span> Use{' '}
                  <span className="disclosure-arrow" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="action-body">
                  <h2>Use stock</h2>
                  <p className="muted">
                    {item.openedTrackingEnabled
                      ? 'Eligible opened stock is used first. Lumio opens eligible packages only when needed.'
                      : 'The earliest eligible expiry is used first.'}
                  </p>
                  {useAction.isError && (
                    <Notice kind="error">{useAction.error.message}</Notice>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      setNotice('');
                      void useAction
                        .mutateAsync()
                        .then(() => {
                          setUse('');
                          setNotice('Use recorded.');
                        })
                        .catch(() => undefined);
                    }}
                  >
                    <label>
                      Quantity used
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0.000001"
                        step="0.000001"
                        value={use}
                        onChange={(event) => setUse(event.target.value)}
                        required
                      />
                    </label>
                    <Button className="wide" disabled={busy}>
                      Record use
                    </Button>
                  </form>
                </div>
              </details>
            </Card>
            <Card className="action-card restock-action">
              <details>
                <summary className="action-summary">
                  <span aria-hidden="true">＋</span> Restock{' '}
                  <span className="disclosure-arrow" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="action-body">
                  <h2>Add a little more</h2>
                  {restockAction.isError && (
                    <Notice kind="error">{restockAction.error.message}</Notice>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      setNotice('');
                      void restockAction
                        .mutateAsync({
                          quantity: restock,
                          expiryDate: expiry || null,
                          locationId: restockLocationId || undefined,
                        })
                        .then(() => {
                          setRestock('');
                          setExpiry('');
                          setRestockLocation(null);
                          setNotice('Stock added.');
                        })
                        .catch(() => undefined);
                    }}
                  >
                    <label>
                      Actual quantity
                      <input
                        type="number"
                        inputMode={
                          item.openedTrackingEnabled ? 'numeric' : 'decimal'
                        }
                        min={item.openedTrackingEnabled ? '1' : '0.000001'}
                        step={item.openedTrackingEnabled ? '1' : '0.000001'}
                        value={restock}
                        onChange={(event) => setRestock(event.target.value)}
                        required
                      />
                    </label>
                    {item.openedTrackingEnabled && (
                      <p className="muted">
                        Enter whole unopened package counts.
                      </p>
                    )}
                    <label>
                      Expiry date <em>optional</em>
                      <input
                        type="date"
                        value={expiry}
                        onChange={(event) => setExpiry(event.target.value)}
                      />
                    </label>
                    {locations.isError && (
                      <Notice kind="error">
                        Household locations could not be loaded:{' '}
                        {locations.error.message}
                      </Notice>
                    )}
                    <label>
                      Stock location
                      <select
                        value={restockLocationId}
                        onChange={(event) =>
                          setRestockLocation(event.target.value)
                        }
                        disabled={
                          locations.isPending || locations.isError || busy
                        }
                      >
                        <option value="">Choose a location</option>
                        {locations.data?.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                            {entry.id === item.preferredRestockLocation?.id
                              ? ' · preferred'
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {needsRestockLocation ? (
                      <>
                        <Notice kind="error">
                          Choose a location for this item before this stock
                          write can be retried.
                        </Notice>
                        <Button
                          type="button"
                          variant="secondary"
                          className="wide"
                          disabled={
                            busy || !restockLocationId || locations.isError
                          }
                          onClick={() => {
                            void restockAction
                              .mutateAsync({
                                quantity: restock,
                                expiryDate: expiry || null,
                                locationId: restockLocationId,
                              })
                              .then(() => {
                                setRestock('');
                                setExpiry('');
                                setRestockLocation(null);
                                setNotice('Stock added.');
                              })
                              .catch(() => undefined);
                          }}
                        >
                          Confirm location and retry Restock
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        className="wide"
                        disabled={
                          busy || locations.isPending || locations.isError
                        }
                      >
                        Add stock
                      </Button>
                    )}
                  </form>
                </div>
              </details>
            </Card>
            {item.openedTrackingEnabled && (
              <OpeningActions
                householdId={household.id}
                item={item}
                onRefresh={refresh}
              />
            )}
            {household.role === 'ADMIN' && (
              <ConfigForm
                householdId={household.id}
                item={item}
                onSaved={refresh}
              />
            )}
            {household.role === 'ADMIN' && (
              <OpeningConfigForm
                householdId={household.id}
                item={item}
                onSaved={refresh}
              />
            )}
          </div>
        )}
        {item.trackingMode !== 'QUANTITY' && (
          <StateActions
            householdId={household.id}
            item={item}
            recommendedAction={assessment?.recommendedAction}
            onRefresh={refresh}
          />
        )}
        <details className="history-disclosure">
          <summary>Stock breakdown &amp; activity</summary>
          <div className="detail-history">
            {item.trackingMode === 'QUANTITY' ? (
              <>
                <Card>
                  <h2>
                    Batches <span className="count">{item.batches.length}</span>
                  </h2>
                  {item.batches.length === 0 ? (
                    <p className="muted">No stock batches yet.</p>
                  ) : (
                    item.batches.map((batch) => (
                      <div className="row static" key={batch.id}>
                        <span>
                          <strong>
                            {batch.quantity} {item.primaryUnit}
                            {batch.openedAt ? ' · Opened' : ' · Unopened'}
                          </strong>
                          <small>
                            {batch.expiryDate
                              ? `Original expiry ${asDate(batch.expiryDate)}`
                              : 'No original expiry'}{' '}
                            · {batch.location?.name ?? 'Location not set'}
                            {batch.openedAt
                              ? ` · Opened ${asDate(batch.openedAt)}${batch.openedUseByDate ? ` · Use by ${asDate(batch.openedUseByDate)}` : ''}`
                              : ''}
                            {batch.effectiveExpiryDate
                              ? ` · Effective expiry ${asDate(batch.effectiveExpiryDate)}`
                              : ''}
                          </small>
                        </span>
                      </div>
                    ))
                  )}
                </Card>
                <Card>
                  <h2>
                    Activity{' '}
                    <span className="count">{item.actions?.length ?? 0}</span>
                  </h2>
                  {!item.actions?.length ? (
                    <p className="muted">No activity yet.</p>
                  ) : (
                    [...item.actions].reverse().map((action) => (
                      <div className="row static" key={action.id}>
                        <span>
                          <strong>
                            <span
                              className={
                                action.type === 'USE' ||
                                action.type === 'FINISH_OPENED'
                                  ? 'minus'
                                  : 'plus'
                              }
                            >
                              {action.type === 'OPEN'
                                ? '↗'
                                : action.type === 'USE' ||
                                    action.type === 'FINISH_OPENED'
                                  ? '−'
                                  : '+'}
                            </span>{' '}
                            {action.type === 'USE'
                              ? 'Used'
                              : action.type === 'RESTOCK'
                                ? 'Restocked'
                                : action.type === 'OPEN'
                                  ? 'Opened'
                                  : action.type === 'FINISH_OPENED'
                                    ? 'Finished opened stock'
                                    : 'Initial stock'}{' '}
                            {action.quantity} {item.primaryUnit}
                          </strong>
                          <small>
                            {new Date(action.createdAt).toLocaleString()} ·{' '}
                            {action.openTransfer
                              ? 'Package moved into opened stock'
                              : `${action.allocations.length} ${action.allocations.length === 1 ? 'batch' : 'batches'}`}
                            {action.undo
                              ? ` · Undone ${new Date(action.undo.createdAt).toLocaleString()}`
                              : ''}
                          </small>
                        </span>
                      </div>
                    ))
                  )}
                </Card>
              </>
            ) : (
              <Card>
                <h2>
                  State activity{' '}
                  <span className="count">
                    {item.stateActions?.length ?? 0}
                  </span>
                </h2>
                {!item.stateActions?.length ? (
                  <p className="muted">No state activity yet.</p>
                ) : (
                  [...item.stateActions].reverse().map((action) => (
                    <div className="row static" key={action.id}>
                      <span>
                        <strong>
                          {action.type.replaceAll('_', ' ').toLowerCase()}
                        </strong>
                        <small>
                          {new Date(action.createdAt).toLocaleString()} ·{' '}
                          {action.afterBackupCount} backups
                          {action.undo
                            ? ` · Undone ${new Date(action.undo.createdAt).toLocaleString()}`
                            : ''}
                        </small>
                      </span>
                    </div>
                  ))
                )}
              </Card>
            )}
            <Card>
              <h2>
                Undo history{' '}
                <span className="count">{item.undos?.length ?? 0}</span>
              </h2>
              {!item.undos?.length ? (
                <p className="muted">No actions undone yet.</p>
              ) : (
                [...item.undos].reverse().map((undo) => (
                  <div className="row static" key={undo.id}>
                    <span>
                      <strong>
                        {undo.inventoryActionId
                          ? 'Inventory action undone'
                          : 'State action undone'}
                      </strong>
                      <small>{new Date(undo.createdAt).toLocaleString()}</small>
                    </span>
                  </div>
                ))
              )}
            </Card>
            <Card>
              <h2>
                Stock-check history{' '}
                <span className="count">{stockCheckEvents.length}</span>
              </h2>
              {!stockCheckEvents.length ? (
                <p className="muted">No stock checks recorded yet.</p>
              ) : (
                stockCheckEvents.map((event) => (
                  <div
                    className="row static"
                    key={`${event.checkId}-${event.index}`}
                  >
                    <span>
                      <strong>
                        {event.decision === 'CONFIRM'
                          ? 'Stock confirmed'
                          : 'Stock corrected'}
                      </strong>
                      <small>
                        {new Date(event.checkedAt).toLocaleString()}
                      </small>
                    </span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </details>
      </div>
    </>
  );
}

const stateLevels: StockLevel[] = [
  'FULL',
  'THREE_QUARTERS',
  'HALF',
  'QUARTER',
  'EMPTY',
];

function OpeningActions({
  householdId,
  item,
  onRefresh,
}: {
  householdId: string;
  item: Item;
  onRefresh: () => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [undoCandidate, setUndoCandidate] = useState<UndoCandidate | null>(
    null,
  );
  const [undoMessage, setUndoMessage] = useState('');
  const undoAction = useMutation({
    mutationFn: (candidate: UndoCandidate) =>
      api<UndoResult>(
        `/households/${householdId}/items/${item.id}/undo`,
        'POST',
        candidate,
      ),
    onSuccess: async (result) => {
      setUndoCandidate(null);
      await onRefresh();
      setUndoMessage(
        result.alreadyUndone
          ? 'This action was already undone. Stock and activity refreshed.'
          : 'Action undone. Stock and activity refreshed.',
      );
    },
    onError: async (error) => {
      await onRefresh();
      if (error instanceof ApiError && error.status === 409)
        setUndoCandidate(null);
    },
  });
  const action = useMutation({
    mutationFn: async (operation: 'open' | 'finish-opened') => {
      const result = await api<{
        id: string;
        batch?: { quantity: string };
        quantity?: string;
        type?: string;
        undoEligibility?: UndoEligibility;
      }>(`/households/${householdId}/items/${item.id}/${operation}`, 'POST');
      return { operation, result };
    },
    onSuccess: async ({ operation, result }) => {
      await onRefresh();
      setUndoCandidate(
        operation === 'finish-opened' &&
          result.undoEligibility?.eligible === true
          ? { actionId: result.id, actionKind: 'INVENTORY' }
          : null,
      );
      setUndoMessage('');
      setMessage(
        operation === 'open'
          ? `Opened ${result.batch?.quantity ?? 'one'} ${item.primaryUnit}. Stock refreshed.`
          : `Finished ${result.quantity ?? 'opened'} ${item.primaryUnit}. Stock and activity refreshed.`,
      );
    },
  });
  return (
    <Card className="action-card plain-action-card">
      <p className="eyebrow">Opened stock</p>
      <p className="muted">Lumio chooses the eligible package and batch.</p>
      {message && <Notice kind="success">{message}</Notice>}
      {undoMessage && <Notice kind="success">{undoMessage}</Notice>}
      {action.isError && <Notice kind="error">{action.error.message}</Notice>}
      {undoCandidate && (
        <>
          <p className="muted">
            The server says this Finish opened action can be undone.
          </p>
          {undoAction.isError && (
            <Notice kind="error">{undoAction.error.message}</Notice>
          )}
          {undoAction.isPending && (
            <p className="muted" role="status">
              Undoing action...
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={undoAction.isPending || action.isPending}
            onClick={() => undoAction.mutate(undoCandidate)}
          >
            Undo finished action
          </Button>
        </>
      )}
      {!undoCandidate && undoAction.isError && (
        <Notice kind="error">{undoAction.error.message}</Notice>
      )}
      {action.isPending && (
        <p className="muted" role="status">
          Updating opened stock…
        </p>
      )}
      <div className="state-level-actions">
        <Button
          type="button"
          disabled={action.isPending || undoAction.isPending}
          onClick={() => {
            setMessage('');
            action.mutate('open');
          }}
        >
          Open one package
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={action.isPending || undoAction.isPending}
          onClick={() => {
            setMessage('');
            action.mutate('finish-opened');
          }}
        >
          Finish opened stock
        </Button>
      </div>
    </Card>
  );
}

function OpeningConfigForm({
  householdId,
  item,
  onSaved,
}: {
  householdId: string;
  item: Item;
  onSaved: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(item.openedTrackingEnabled ?? false);
  const [days, setDays] = useState(
    item.recommendedDaysAfterOpening?.toString() ?? '',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/households/${householdId}/items/${item.id}/opening-config`, 'PUT', {
        enabled,
        recommendedDaysAfterOpening: days ? Number(days) : null,
        ...(enabled ? { packageCountConfirmed: true } : {}),
      }),
    onSuccess: async () => {
      await onSaved();
      setConfirmed(false);
      setNotice(
        enabled ? 'Opening tracking enabled.' : 'Opening tracking disabled.',
      );
    },
  });
  return (
    <Card>
      <details>
        <summary className="settings-summary">Opening policy</summary>
        <p className="muted">
          Use this only when one primary unit equals one complete package.
          Existing positive unopened stock must be whole packages.
        </p>
        {notice && <Notice kind="success">{notice}</Notice>}
        {save.isError && <Notice kind="error">{save.error.message}</Notice>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (enabled && !confirmed) return;
            setNotice('');
            void save.mutateAsync().catch(() => undefined);
          }}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setConfirmed(false);
              }}
            />{' '}
            Track opened packages
          </label>
          {enabled && (
            <>
              <label>
                Recommended days after opening <em>optional</em>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  required
                />{' '}
                I confirm one {item.primaryUnit} equals one complete package.
              </label>
            </>
          )}
          <Button
            variant="secondary"
            className="wide"
            disabled={save.isPending || (enabled && !confirmed)}
          >
            {save.isPending ? 'Saving…' : 'Save opening policy'}
          </Button>
        </form>
      </details>
    </Card>
  );
}

function StateActions({
  householdId,
  item,
  recommendedAction,
  onRefresh,
}: {
  householdId: string;
  item: Item;
  recommendedAction?: Assessment['recommendedAction'];
  onRefresh: () => Promise<void>;
}) {
  const [backupCount, setBackupCount] = useState('1');
  const [success, setSuccess] = useState('');
  const [undoCandidate, setUndoCandidate] = useState<UndoCandidate | null>(
    null,
  );
  const undoAction = useMutation({
    mutationFn: (candidate: UndoCandidate) =>
      api<UndoResult>(
        `/households/${householdId}/items/${item.id}/undo`,
        'POST',
        candidate,
      ),
    onSuccess: async (result) => {
      setUndoCandidate(null);
      await onRefresh();
      setSuccess(
        result.alreadyUndone
          ? 'This action was already undone. Stock and activity refreshed.'
          : 'Action undone. Stock and activity refreshed.',
      );
    },
    onError: async (error) => {
      await onRefresh();
      if (error instanceof ApiError && error.status === 409)
        setUndoCandidate(null);
    },
  });
  const action = useMutation({
    mutationFn: async (intent: {
      endpoint: string;
      body?: object;
      message: string;
    }) => {
      const result = await api<{
        action: { id: string };
        undoEligibility?: UndoEligibility;
      }>(
        `/households/${householdId}/items/${item.id}/state/${intent.endpoint}`,
        'POST',
        intent.body,
      );
      return { intent, result };
    },
    onSuccess: async ({ intent, result }) => {
      await onRefresh();
      setBackupCount('1');
      setSuccess(intent.message);
      setUndoCandidate(
        (intent.endpoint === 'level' || intent.endpoint === 'presence') &&
          result.undoEligibility?.eligible === true
          ? { actionId: result.action.id, actionKind: 'STATE' }
          : null,
      );
    },
  });
  const submit = (
    endpoint: string,
    body: object | undefined,
    message: string,
  ) => {
    setSuccess('');
    action.mutate({ endpoint, body, message });
  };
  const busy = action.isPending || undoAction.isPending;

  return (
    <div className="stack detail-actions state-actions">
      <Card className="action-card plain-action-card">
        <p className="eyebrow">Quick action</p>
        <h2>
          {item.trackingMode === 'FIVE_LEVEL'
            ? 'Update current level'
            : 'Update current item'}
        </h2>
        <p className="muted">
          Choose what is true at home. Lumio will update the household state.
        </p>
        {success && <Notice kind="success">{success}</Notice>}
        {action.isError && <Notice kind="error">{action.error.message}</Notice>}
        {undoCandidate && (
          <>
            <p className="muted">
              The server says this state change can be undone.
            </p>
            {undoAction.isError && (
              <Notice kind="error">{undoAction.error.message}</Notice>
            )}
            {undoAction.isPending && (
              <p className="muted" role="status">
                Undoing action...
              </p>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={undoAction.isPending || action.isPending}
              onClick={() => undoAction.mutate(undoCandidate)}
            >
              Undo state change
            </Button>
          </>
        )}
        {!undoCandidate && undoAction.isError && (
          <Notice kind="error">{undoAction.error.message}</Notice>
        )}
        {action.isPending && (
          <p className="muted" role="status">
            Saving stock state…
          </p>
        )}
        {item.trackingMode === 'FIVE_LEVEL' ? (
          <div className="state-level-actions" aria-label="Set current level">
            {stateLevels.map((level) => (
              <Button
                key={level}
                type="button"
                variant={item.currentLevel === level ? 'primary' : 'secondary'}
                disabled={busy || item.currentLevel === level}
                aria-pressed={item.currentLevel === level}
                onClick={() =>
                  submit(
                    'level',
                    { level },
                    `Level updated to ${level.replaceAll('_', ' ').toLowerCase()}.`,
                  )
                }
              >
                {level.replaceAll('_', ' ').toLowerCase()}
              </Button>
            ))}
          </div>
        ) : (
          <div className="state-level-actions">
            <Button
              type="button"
              variant={item.isPresent === true ? 'primary' : 'secondary'}
              disabled={busy || item.isPresent === true}
              aria-pressed={item.isPresent === true}
              onClick={() =>
                submit(
                  'presence',
                  { present: true },
                  'Current item marked present.',
                )
              }
            >
              Present
            </Button>
            <Button
              type="button"
              variant={item.isPresent === false ? 'primary' : 'secondary'}
              disabled={busy || item.isPresent === false}
              aria-pressed={item.isPresent === false}
              onClick={() =>
                submit(
                  'presence',
                  { present: false },
                  'Current item marked absent.',
                )
              }
            >
              Absent
            </Button>
          </div>
        )}
        <form
          className="backup-action"
          onSubmit={(event) => {
            event.preventDefault();
            submit('backups', { count: Number(backupCount) }, 'Backup added.');
          }}
        >
          <label>
            Add backups
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={backupCount}
              onChange={(event) => setBackupCount(event.target.value)}
              required
            />
          </label>
          <Button
            type="submit"
            variant="secondary"
            disabled={
              busy ||
              !Number.isInteger(Number(backupCount)) ||
              Number(backupCount) < 1
            }
          >
            {action.isPending ? 'Saving…' : 'Add backups'}
          </Button>
        </form>
        {recommendedAction === 'OPEN_REFILL' && (
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              submit(
                'open-refill',
                undefined,
                'Backup opened and current stock updated.',
              )
            }
          >
            {action.isPending ? 'Saving…' : 'Open refill'}
          </Button>
        )}
      </Card>
    </div>
  );
}

function ConfigForm({
  householdId,
  item,
  onSaved,
}: {
  householdId: string;
  item: Item;
  onSaved: () => Promise<void>;
}) {
  const [config, setConfig] = useState<Config>({
    minimumStock: item.minimumStock,
    lowStockThreshold: item.lowStockThreshold,
    buyThreshold: item.buyThreshold,
    targetStock: item.targetStock,
    neverRunOut: item.neverRunOut,
    predictionEnabled: item.predictionEnabled,
  });
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/households/${householdId}/items/${item.id}/config`, 'PUT', config),
    onSuccess: onSaved,
  });
  return (
    <Card>
      <details>
        <summary className="settings-summary">Stock rules</summary>
        <p className="muted">
          Optional values use {item.primaryUnit}. Set a target to enable
          purchase quantities.
        </p>
        {notice && <Notice kind="success">{notice}</Notice>}
        {save.isError && <Notice kind="error">{save.error.message}</Notice>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setNotice('');
            void save
              .mutateAsync()
              .then(() => setNotice('Stock rules saved.'))
              .catch(() => undefined);
          }}
        >
          {(
            [
              ['minimumStock', 'Minimum stock'],
              ['buyThreshold', 'Buy threshold'],
              ['lowStockThreshold', 'Low threshold'],
              ['targetStock', 'Target stock'],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type="number"
                min="0"
                step="0.000001"
                value={config[field] ?? ''}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    [field]: event.target.value || null,
                  }))
                }
              />
            </label>
          ))}
          <label className="check-label">
            <input
              type="checkbox"
              checked={config.neverRunOut}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  neverRunOut: event.target.checked,
                }))
              }
            />{' '}
            Never run out
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={config.predictionEnabled}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  predictionEnabled: event.target.checked,
                }))
              }
            />{' '}
            Predict from USE history
          </label>
          <Button
            variant="secondary"
            className="wide"
            disabled={save.isPending}
          >
            Save stock rules
          </Button>
        </form>
      </details>
    </Card>
  );
}
