import type {
  CatalogOption,
  Item,
  LocationStockSnapshot,
} from '@/shared/api/types';
import { Card } from '@/shared/ui/primitives';
import {
  formatDate,
  formatDateOnly,
  formatNumber,
  localizedEnum,
  tr,
} from '@/shared/i18n';

const asDate = (value: string | null) =>
  value ? formatDateOnly(value) : tr('common:expiry2');

function observedStock(snapshot: LocationStockSnapshot, unit: string) {
  const parts: string[] = [];
  if (snapshot.quantity !== undefined)
    parts.push(`${formatNumber(snapshot.quantity)} ${unit}`);
  if (Object.hasOwn(snapshot, 'currentLevel'))
    parts.push(
      `${tr('common:currentLevel')}: ${snapshot.currentLevel ? localizedEnum(snapshot.currentLevel) : tr('location-check:recorded')}`,
    );
  if (Object.hasOwn(snapshot, 'isPresent'))
    parts.push(
      `${tr('common:currentItem')}: ${snapshot.isPresent === null ? tr('location-check:recorded') : tr(snapshot.isPresent ? 'common:present' : 'common:absent')}`,
    );
  if (snapshot.backupCount !== undefined)
    parts.push(
      `${tr('common:backups2')}: ${formatNumber(snapshot.backupCount)}`,
    );
  return parts.join(' · ');
}

export function ItemDetailHistory({
  item,
  locations,
  signedInUserId,
}: {
  item: Item;
  locations: CatalogOption[];
  signedInUserId?: string;
}) {
  const stockCheckEvents = (item.stockChecks ?? [])
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
  const locationCheckEvents = (item.locationStockChecks ?? [])
    .flatMap((check) =>
      check.history.map((event, index) => ({
        ...event,
        locationId: check.locationId,
        index,
      })),
    )
    .sort(
      (left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt),
    );

  return (
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
                          batch.openedAt ? 'common:opened' : 'common:unopened',
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
              <span className="count">{item.stateActions?.length ?? 0}</span>
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
            {tr('item-detail:locationCorrectionHistory')}{' '}
            <span className="count">{locationCheckEvents.length}</span>
          </h2>
          {!locationCheckEvents.length ? (
            <p className="muted">{tr('item-detail:noLocationCorrections')}</p>
          ) : (
            locationCheckEvents.map((event) => (
              <div
                className="row static"
                key={`${event.locationId}-${event.index}`}
              >
                <span>
                  <strong>
                    {event.decision === 'CORRECT'
                      ? tr('item-detail:stockCorrected')
                      : tr('item-detail:stockConfirmed')}
                  </strong>
                  <small>
                    {locations.find((place) => place.id === event.locationId)
                      ?.name ?? event.locationId}
                    {' · '}
                    {formatDate(event.checkedAt)}
                    {' · '}
                    {event.userId === signedInUserId
                      ? tr('common:you')
                      : tr('item-detail:householdMember')}
                  </small>
                  {event.decision === 'CORRECT' && (
                    <small>
                      {observedStock(event.before, item.primaryUnit)} →{' '}
                      {observedStock(event.after, item.primaryUnit)}
                    </small>
                  )}
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
  );
}
