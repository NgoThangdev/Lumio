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
import { ItemLifecyclePanel } from './ItemLifecyclePanel';

import { tr } from '../../shared/i18n';
import {
  formatDate,
  formatDateOnly,
  formatNumber,
  localizedError,
  localizedEnum,
} from '../../shared/i18n';
const asDate = (value: string | null) =>
  value ? formatDateOnly(value) : tr('common:expiry2');

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
          ? tr('item-detail:actionAlreadyUndone')
          : tr('item-detail:actionUndone'),
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
        <p className="muted">{tr('common:loadingItemDetail')}</p>
      </Card>
    );
  if (itemQuery.isError)
    return (
      <>
        {notice && <Notice kind="success">{notice}</Notice>}
        <Notice kind="error">
          {notice
            ? `The item was saved, but its latest detail could not be refreshed. Check Inventory or retry opening this item. ${localizedError(itemQuery.error)}`
            : localizedError(itemQuery.error)}
        </Notice>
      </>
    );
  if (!item)
    return (
      <Notice kind="error">{tr('item-detail:itemDetailUnavailable')}</Notice>
    );
  return (
    <>
      <div className="detail-intro">
        <div>
          <p className="eyebrow">{tr('item-detail:littlePartHome')}</p>
          <h2 className="detail-title">{item.name}</h2>
          {item.archivedAt && (
            <p className="muted">{tr('item-detail:archivedStockHistory')}</p>
          )}
          <div className="detail-badges">
            {!item.archivedAt && (
              <StockBadge status={assessment?.lowStockRisk} />
            )}
            {!item.archivedAt && assessment?.expiryRisk === 'USE_SOON' && (
              <StockBadge status="USE_SOON" />
            )}
          </div>
        </div>
        <ItemVisual name={item.name} large />
      </div>
      {notice && <Notice kind="success">{notice}</Notice>}
      {!item.archivedAt && !undoCandidate && undoAction.isError && (
        <Notice kind="error">{localizedError(undoAction.error)}</Notice>
      )}
      {intelligence.isError && (
        <Notice kind="error">
          {tr('item-detail:assessmentLoaded')}{' '}
          {localizedError(intelligence.error)}
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
          {item.archivedAt ? (
            <section className="stock-summary">
              <p className="eyebrow">{tr('item-detail:archivedStock')}</p>
              <p>{tr('item-detail:stockHistoryRetained')}</p>
            </section>
          ) : item.trackingMode === 'QUANTITY' ? (
            <section className="stock-summary">
              <p className="eyebrow">{tr('item-detail:readyUse')}</p>
              <strong>
                {formatNumber(assessment?.eligibleStock ?? '—')}
              </strong>{' '}
              <span>{item.primaryUnit}</span>
              <p>
                {tr('common:physical')}{' '}
                {formatNumber(assessment?.physicalStock ?? '—')}{' '}
                {item.primaryUnit} {tr('common:expired2')}{' '}
                {formatNumber(assessment?.expiredStock ?? '—')}{' '}
                {item.primaryUnit}
              </p>
              {item.openedTrackingEnabled && (
                <p>
                  {tr('item-detail:opened4')}{' '}
                  {formatNumber(item.openedQuantity ?? '—')} {item.primaryUnit}{' '}
                  {tr('item-detail:unopened2')}{' '}
                  {formatNumber(item.unopenedQuantity ?? '—')}{' '}
                  {item.primaryUnit}
                </p>
              )}
              {item.openedTrackingEnabled && (
                <p className="muted">
                  {tr('common:openingTracking')}
                  {item.recommendedDaysAfterOpening
                    ? ` · ${tr('item-detail:useWithinDaysAfterOpening', { days: item.recommendedDaysAfterOpening })}`
                    : ` · ${tr('item-detail:noUseByInterval')}`}
                  .
                </p>
              )}
            </section>
          ) : (
            <section className="stock-summary">
              <p className="eyebrow">
                {item.trackingMode === 'FIVE_LEVEL'
                  ? tr('common:currentLevel')
                  : tr('common:currentItem')}
              </p>
              <strong className="state-value">
                {item.trackingMode === 'FIVE_LEVEL'
                  ? ((item.currentLevel
                      ? localizedEnum(item.currentLevel)
                      : undefined) ?? '—')
                  : item.isPresent
                    ? tr('common:present')
                    : tr('common:absent')}
              </strong>
              <p>
                {formatNumber(item.backupCount)}{' '}
                {tr(
                  item.backupCount === 1 ? 'common:backup' : 'common:backups2',
                )}{' '}
                {tr('common:available')}
              </p>
              {item.currentLocation?.name && (
                <p>
                  {tr('item-detail:currentLocation')}{' '}
                  {item.currentLocation.name}
                </p>
              )}
              {item.backupLocation?.name && (
                <p>
                  {tr('item-detail:backupLocation')} {item.backupLocation.name}
                </p>
              )}
            </section>
          )}
          {!item.archivedAt && intelligence.isPending && (
            <Card className="assessment-loading">
              <p className="muted">{tr('common:loadingStockAssessment')}</p>
            </Card>
          )}
          {!item.archivedAt && assessment && (
            <Card className="assessment-card">
              <p className="eyebrow">{tr('common:stockHealth')}</p>
              <h2>{tr('item-detail:howThingsLooking')}</h2>
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
                    {tr('common:recommended')}{' '}
                    {assessment.recommendedAction === 'OPEN_REFILL'
                      ? tr('common:openBackup')
                      : tr('common:buyBackup')}
                  </p>
                )}
            </Card>
          )}
        </div>
        {!item.archivedAt && item.trackingMode === 'QUANTITY' && (
          <div className="stack detail-actions">
            {undoCandidate && (
              <Card className="action-card plain-action-card undo-action">
                <p className="eyebrow">{tr('item-detail:recentAction')}</p>
                <p className="muted">{tr('item-detail:serverSaysAction')}</p>
                {undoAction.isError && (
                  <Notice kind="error">
                    {localizedError(undoAction.error)}
                  </Notice>
                )}
                {undoAction.isPending && (
                  <p className="muted" role="status">
                    {tr('item-detail:undoingAction')}
                  </p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={undoAction.isPending}
                  onClick={() => undoAction.mutate(undoCandidate)}
                >
                  {tr('common:undo')}
                </Button>
              </Card>
            )}
            <Card className="action-card use-action">
              <details>
                <summary className="action-summary">
                  <span aria-hidden="true">−</span> {tr('common:use')}{' '}
                  <span className="disclosure-arrow" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="action-body">
                  <h2>{tr('common:useStock')}</h2>
                  <p className="muted">
                    {item.openedTrackingEnabled
                      ? tr('item-detail:eligibleOpenedStock')
                      : tr('common:earliestEligibleExpiry')}
                  </p>
                  {useAction.isError && (
                    <Notice kind="error">
                      {localizedError(useAction.error)}
                    </Notice>
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
                      {tr('common:quantityUsed')}
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
                      {tr('common:recordUse')}
                    </Button>
                  </form>
                </div>
              </details>
            </Card>
            <Card className="action-card restock-action">
              <details>
                <summary className="action-summary">
                  <span aria-hidden="true">＋</span> {tr('common:restock')}{' '}
                  <span className="disclosure-arrow" aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className="action-body">
                  <h2>{tr('item-detail:addLittle')}</h2>
                  {restockAction.isError && (
                    <Notice kind="error">
                      {localizedError(restockAction.error)}
                    </Notice>
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
                      {tr('common:actualQuantity')}
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
                        {tr('item-detail:enterWholeUnopened')}
                      </p>
                    )}
                    <label>
                      {tr('common:expiryDate')}{' '}
                      <em>{tr('common:optional2')}</em>
                      <input
                        type="date"
                        value={expiry}
                        onChange={(event) => setExpiry(event.target.value)}
                      />
                    </label>
                    {locations.isError && (
                      <Notice kind="error">
                        {tr('common:householdLocationsLoaded')}{' '}
                        {localizedError(locations.error)}
                      </Notice>
                    )}
                    <label>
                      {tr('common:stockLocation')}
                      <select
                        value={restockLocationId}
                        onChange={(event) =>
                          setRestockLocation(event.target.value)
                        }
                        disabled={
                          locations.isPending || locations.isError || busy
                        }
                      >
                        <option value="">{tr('common:chooseLocation')}</option>
                        {locations.data?.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                            {entry.id === item.preferredRestockLocation?.id
                              ? ` · ${tr('common:preferred')}`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    {needsRestockLocation ? (
                      <>
                        <Notice kind="error">
                          {tr('item-detail:chooseLocationItem')}
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
                          {tr('item-detail:confirmLocationRetry2')}
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
                        {tr('common:addStock')}
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
          </div>
        )}
        {!item.archivedAt && item.trackingMode !== 'QUANTITY' && (
          <StateActions
            householdId={household.id}
            item={item}
            recommendedAction={assessment?.recommendedAction}
            onRefresh={refresh}
          />
        )}
        <details className="history-disclosure">
          <summary>{tr('item-detail:stockBreakdownActivity')}</summary>
          <div className="detail-history">
            {item.trackingMode === 'QUANTITY' ? (
              <>
                <Card>
                  <h2>
                    {tr('common:batches')}{' '}
                    <span className="count">
                      {formatNumber(item.batches.length)}
                    </span>
                  </h2>
                  {item.batches.length === 0 ? (
                    <p className="muted">{tr('common:stockBatchesYet')}</p>
                  ) : (
                    item.batches.map((batch) => (
                      <div className="row static" key={batch.id}>
                        <span>
                          <strong>
                            {formatNumber(batch.quantity)} {item.primaryUnit}
                            {tr(
                              batch.openedAt
                                ? 'common:opened'
                                : 'common:unopened',
                            )}
                          </strong>
                          <small>
                            {batch.expiryDate
                              ? tr('item-detail:originalExpiry2', {
                                  date: asDate(batch.expiryDate),
                                })
                              : tr('item-detail:originalExpiry')}{' '}
                            · {batch.location?.name ?? tr('common:locationSet')}
                            {batch.openedAt
                              ? tr('item-detail:opened3', {
                                  date: asDate(batch.openedAt),
                                  useBy: batch.openedUseByDate
                                    ? tr('common:use2', {
                                        date: asDate(batch.openedUseByDate),
                                      })
                                    : '',
                                })
                              : ''}
                            {batch.effectiveExpiryDate
                              ? tr('item-detail:effectiveExpiry', {
                                  date: asDate(batch.effectiveExpiryDate),
                                })
                              : ''}
                          </small>
                        </span>
                      </div>
                    ))
                  )}
                </Card>
                <Card>
                  <h2>
                    {tr('common:activity')}{' '}
                    <span className="count">
                      {formatNumber(item.actions?.length ?? 0)}
                    </span>
                  </h2>
                  {!item.actions?.length ? (
                    <p className="muted">{tr('common:activityYet')}</p>
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
                              ? tr('common:used2')
                              : action.type === 'RESTOCK'
                                ? tr('common:restocked2')
                                : action.type === 'OPEN'
                                  ? tr('common:opened')
                                  : action.type === 'FINISH_OPENED'
                                    ? tr('common:finishedOpenedStock')
                                    : tr('common:initialStock')}{' '}
                            {formatNumber(action.quantity)} {item.primaryUnit}
                          </strong>
                          <small>
                            {formatDate(action.createdAt)} ·{' '}
                            {action.openTransfer
                              ? tr('item-detail:packageMovedOpened')
                              : `${formatNumber(action.allocations.length)} ${action.allocations.length === 1 ? 'batch' : 'batches'}`}
                            {action.undo
                              ? ` · Undone ${formatDate(action.undo.createdAt)}`
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
                  {tr('common:stateActivity')}{' '}
                  <span className="count">
                    {item.stateActions?.length ?? 0}
                  </span>
                </h2>
                {!item.stateActions?.length ? (
                  <p className="muted">{tr('common:stateActivityYet')}</p>
                ) : (
                  [...item.stateActions].reverse().map((action) => (
                    <div className="row static" key={action.id}>
                      <span>
                        <strong>{localizedEnum(action.type)}</strong>
                        <small>
                          {formatDate(action.createdAt)} ·{' '}
                          {formatNumber(action.afterBackupCount)}{' '}
                          {tr('common:backups2')}
                          {action.undo
                            ? ` · Undone ${formatDate(action.undo.createdAt)}`
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
                {tr('item-detail:undoHistory')}{' '}
                <span className="count">{item.undos?.length ?? 0}</span>
              </h2>
              {!item.undos?.length ? (
                <p className="muted">{tr('item-detail:actionsUndoneYet')}</p>
              ) : (
                [...item.undos].reverse().map((undo) => (
                  <div className="row static" key={undo.id}>
                    <span>
                      <strong>
                        {undo.inventoryActionId
                          ? tr('item-detail:inventoryActionUndone')
                          : tr('item-detail:stateActionUndone')}
                      </strong>
                      <small>{formatDate(undo.createdAt)}</small>
                    </span>
                  </div>
                ))
              )}
            </Card>
            <Card>
              <h2>
                {tr('item-detail:stockCheckHistory')}{' '}
                <span className="count">{stockCheckEvents.length}</span>
              </h2>
              {!stockCheckEvents.length ? (
                <p className="muted">{tr('item-detail:stockChecksRecorded')}</p>
              ) : (
                stockCheckEvents.map((event) => (
                  <div
                    className="row static"
                    key={`${event.checkId}-${event.index}`}
                  >
                    <span>
                      <strong>
                        {event.decision === 'CONFIRM'
                          ? tr('item-detail:stockConfirmed')
                          : tr('item-detail:stockCorrected')}
                      </strong>
                      <small>{formatDate(event.checkedAt)}</small>
                    </span>
                  </div>
                ))
              )}
            </Card>
            <Card>
              <h2>
                {tr('item-detail:itemChanges')}{' '}
                <span className="count">{item.changes?.length ?? 0}</span>
              </h2>
              {!item.changes?.length ? (
                <p className="muted">{tr('item-detail:itemChangesYet')}</p>
              ) : (
                item.changes.map((change) => (
                  <div className="row static" key={change.id}>
                    <span>
                      <strong>
                        {change.kind === 'EDIT'
                          ? tr('item-detail:detailsEdited')
                          : change.kind === 'ARCHIVE'
                            ? tr('common:archived')
                            : tr('common:restored')}
                      </strong>
                      <small>{formatDate(change.createdAt)}</small>
                    </span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </details>
      </div>
      {household.role === 'ADMIN' && (
        <section
          className="stack detail-management"
          aria-label={tr('item-detail:itemManagement')}
        >
          <ItemLifecyclePanel householdId={household.id} item={item} />
          {!item.archivedAt && item.trackingMode === 'QUANTITY' && (
            <>
              <ConfigForm
                householdId={household.id}
                item={item}
                onSaved={refresh}
              />
              <OpeningConfigForm
                householdId={household.id}
                item={item}
                onSaved={refresh}
              />
            </>
          )}
        </section>
      )}
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
          ? tr('item-detail:actionAlreadyUndone')
          : tr('item-detail:actionUndone'),
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
          ? tr('item-detail:openedStockRefreshed', {
              quantity: formatNumber(result.batch?.quantity ?? '\u2014'),
              unit: item.primaryUnit,
            })
          : tr('item-detail:finishedStockActivity', {
              quantity: formatNumber(result.quantity ?? '\u2014'),
              unit: item.primaryUnit,
            }),
      );
    },
  });
  return (
    <Card className="action-card plain-action-card">
      <p className="eyebrow">{tr('item-detail:openedStock')}</p>
      <p className="muted">{tr('item-detail:lumioChoosesEligible')}</p>
      {message && <Notice kind="success">{message}</Notice>}
      {undoMessage && <Notice kind="success">{undoMessage}</Notice>}
      {action.isError && (
        <Notice kind="error">{localizedError(action.error)}</Notice>
      )}
      {undoCandidate && (
        <>
          <p className="muted">{tr('item-detail:serverSaysFinish')}</p>
          {undoAction.isError && (
            <Notice kind="error">{localizedError(undoAction.error)}</Notice>
          )}
          {undoAction.isPending && (
            <p className="muted" role="status">
              {tr('item-detail:undoingAction')}
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={undoAction.isPending || action.isPending}
            onClick={() => undoAction.mutate(undoCandidate)}
          >
            {tr('item-detail:undoFinishedAction')}
          </Button>
        </>
      )}
      {!undoCandidate && undoAction.isError && (
        <Notice kind="error">{localizedError(undoAction.error)}</Notice>
      )}
      {action.isPending && (
        <p className="muted" role="status">
          {tr('item-detail:updatingOpenedStock')}
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
          {tr('item-detail:openOnePackage')}
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
          {tr('item-detail:finishOpenedStock')}
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
        enabled
          ? tr('item-detail:openingTrackingEnabled')
          : tr('item-detail:openingTrackingDisabled'),
      );
    },
  });
  return (
    <Card>
      <details>
        <summary className="settings-summary">
          {tr('common:openingPolicy')}
        </summary>
        <p className="muted">{tr('item-detail:useOnlyOne')}</p>
        {notice && <Notice kind="success">{notice}</Notice>}
        {save.isError && (
          <Notice kind="error">{localizedError(save.error)}</Notice>
        )}
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
            {tr('item-detail:trackOpenedPackages')}
          </label>
          {enabled && (
            <>
              <label>
                {tr('item-detail:recommendedDaysOpening')}{' '}
                <em>{tr('common:optional2')}</em>
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
                {tr('item-detail:iConfirmOne')} {item.primaryUnit}{' '}
                {tr('item-detail:equalsOneComplete')}
              </label>
            </>
          )}
          <Button
            variant="secondary"
            className="wide"
            disabled={save.isPending || (enabled && !confirmed)}
          >
            {save.isPending
              ? tr('common:saving')
              : tr('item-detail:saveOpeningPolicy')}
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
          ? tr('item-detail:actionAlreadyUndone')
          : tr('item-detail:actionUndone'),
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
        <p className="eyebrow">{tr('common:quickAction')}</p>
        <h2>
          {item.trackingMode === 'FIVE_LEVEL'
            ? tr('item-detail:updateCurrentLevel')
            : tr('item-detail:updateCurrentItem')}
        </h2>
        <p className="muted">{tr('item-detail:chooseTrueHome')}</p>
        {success && <Notice kind="success">{success}</Notice>}
        {action.isError && (
          <Notice kind="error">{localizedError(action.error)}</Notice>
        )}
        {undoCandidate && (
          <>
            <p className="muted">{tr('item-detail:serverSaysState')}</p>
            {undoAction.isError && (
              <Notice kind="error">{localizedError(undoAction.error)}</Notice>
            )}
            {undoAction.isPending && (
              <p className="muted" role="status">
                {tr('item-detail:undoingAction')}
              </p>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={undoAction.isPending || action.isPending}
              onClick={() => undoAction.mutate(undoCandidate)}
            >
              {tr('item-detail:undoStateChange')}
            </Button>
          </>
        )}
        {!undoCandidate && undoAction.isError && (
          <Notice kind="error">{localizedError(undoAction.error)}</Notice>
        )}
        {action.isPending && (
          <p className="muted" role="status">
            {tr('item-detail:savingStockState')}
          </p>
        )}
        {item.trackingMode === 'FIVE_LEVEL' ? (
          <div
            className="state-level-actions"
            aria-label={tr('item-detail:setCurrentLevel')}
          >
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
                    tr('item-detail:levelUpdatedTo', {
                      level: localizedEnum(level),
                    }),
                  )
                }
              >
                {localizedEnum(level)}
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
                  tr('item-detail:itemMarkedPresent'),
                )
              }
            >
              {tr('common:present')}
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
                  tr('item-detail:itemMarkedAbsent'),
                )
              }
            >
              {tr('common:absent')}
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
            {tr('item-detail:addBackups')}
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
            {action.isPending
              ? tr('common:saving')
              : tr('item-detail:addBackups')}
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
                tr('item-detail:backupOpenedStockUpdated'),
              )
            }
          >
            {action.isPending
              ? tr('common:saving')
              : tr('item-detail:openRefill')}
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
        <summary className="settings-summary">
          {tr('item-detail:stockRules')}
        </summary>
        <p className="muted">
          {tr('common:optionalValuesUse')} {item.primaryUnit}
          {tr('item-detail:setTargetEnable')}
        </p>
        {notice && <Notice kind="success">{notice}</Notice>}
        {save.isError && (
          <Notice kind="error">{localizedError(save.error)}</Notice>
        )}
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
              ['minimumStock', tr('common:minimumStock')],
              ['buyThreshold', tr('common:buyThreshold')],
              ['lowStockThreshold', tr('common:lowThreshold')],
              ['targetStock', tr('common:targetStock')],
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
            {tr('common:neverRunOut')}
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
            {tr('common:predictUseHistory')}
          </label>
          <Button
            variant="secondary"
            className="wide"
            disabled={save.isPending}
          >
            {tr('common:saveStockRules')}
          </Button>
        </form>
      </details>
    </Card>
  );
}
