import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { Item, UndoCandidate, UndoEligibility } from '@/shared/api/types';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import { formatNumber, localizedError, tr } from '@/shared/i18n';
import { useItemUndoAction } from './useItemUndoAction';

export function OpeningActions({
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
  const undoAction = useItemUndoAction({
    householdId,
    itemId: item.id,
    onRefresh,
    onUndoStarted: () => setUndoCandidate(null),
    onUndoComplete: (result) =>
      setUndoMessage(
        result.alreadyUndone
          ? tr('item-detail:actionAlreadyUndone')
          : tr('item-detail:actionUndone'),
      ),
    onConflict: () => setUndoCandidate(null),
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
            onClick={() => undoAction.undo(undoCandidate)}
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
