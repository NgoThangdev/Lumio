import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { STOCK_LEVELS } from '@/shared/api/types';
import type {
  Assessment,
  Item,
  UndoCandidate,
  UndoEligibility,
} from '@/shared/api/types';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import { localizedError, localizedEnum, tr } from '@/shared/i18n';
import { useItemUndoAction } from './useItemUndoAction';

export function StateModeActions({
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
  const undoAction = useItemUndoAction({
    householdId,
    itemId: item.id,
    onRefresh,
    onUndoStarted: () => setUndoCandidate(null),
    onUndoComplete: (result) =>
      setSuccess(
        result.alreadyUndone
          ? tr('item-detail:actionAlreadyUndone')
          : tr('item-detail:actionUndone'),
      ),
    onConflict: () => setUndoCandidate(null),
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
              onClick={() => undoAction.undo(undoCandidate)}
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
            {STOCK_LEVELS.map((level) => (
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
