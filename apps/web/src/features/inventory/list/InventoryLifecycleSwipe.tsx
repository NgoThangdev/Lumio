import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  ApiError,
  api,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { Item } from '@/shared/api/types';
import { localizedError, tr } from '@/shared/i18n';
import { Button, Notice } from '@/shared/ui/primitives';
import { SwipeReveal } from '@/shared/ui/SwipeReveal';
import {
  refreshAfterPermanentItemDeletion,
  refreshItemLifecycle,
} from '../item-detail/itemLifecycle';

type LifecycleItem = Pick<Item, 'id' | 'name' | 'archivedAt'>;
type RowAction = 'archive' | 'delete';

export function InventoryLifecycleSwipe({
  householdId,
  item,
  action,
  isAdmin,
  onSaved,
  children,
}: {
  householdId: string;
  item: LifecycleItem;
  action: RowAction;
  isAdmin: boolean;
  onSaved: (message: string, kind: 'success' | 'error') => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteInputRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<RowAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentName, setCurrentName] = useState(item.name);
  const [deleteName, setDeleteName] = useState('');
  const [error, setError] = useState('');
  const [blockingTrips, setBlockingTrips] = useState<string[]>([]);

  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) {
      element.showModal();
      if (dialog === 'delete') {
        window.requestAnimationFrame(() => deleteInputRef.current?.focus());
      }
    } else if (!dialog && element?.open) {
      element.close();
    }
  }, [dialog]);

  if (!isAdmin) return <>{children}</>;

  const itemPath = `/households/${householdId}/items/${item.id}`;
  const isArchiveAction = action === 'archive';

  function openDialog(next: RowAction) {
    setError('');
    setBlockingTrips([]);
    setCurrentName(item.name);
    setDeleteName('');
    setDialog(next);
  }

  function reportSaved(message: string, refreshed: boolean) {
    onSaved(
      refreshed
        ? message
        : `${message} ${tr('inventory:lifecycleRefreshWarning')}`,
      refreshed ? 'success' : 'error',
    );
    setDialog(null);
  }

  async function archive() {
    if (busy || action !== 'archive') return;
    setBusy(true);
    setError('');
    setBlockingTrips([]);
    let sent = false;
    try {
      sent = true;
      const saved = await api<Item>(`${itemPath}/archive`, 'POST');
      queryClient.setQueryData(keys.item(householdId, item.id), saved);
      const refreshed = await refreshItemLifecycle(
        queryClient,
        householdId,
        item.id,
      );
      reportSaved(tr('inventory:rowArchived', { name: saved.name }), refreshed);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'ACTIVE_TRIP_ENTRY') {
        setBlockingTrips(cause.tripIds);
        setError(tr('item-detail:archiveBlockedGuidance'));
      } else if (
        sent &&
        !(cause instanceof OfflineBeforeSendError) &&
        isMutationOutcomeUnknown(cause)
      ) {
        try {
          const current = await api<Item>(itemPath);
          queryClient.setQueryData(keys.item(householdId, item.id), current);
          const refreshed = await refreshItemLifecycle(
            queryClient,
            householdId,
            item.id,
          );
          if (current.archivedAt) {
            reportSaved(
              tr('inventory:rowArchiveReconciled', { name: current.name }),
              refreshed,
            );
          } else {
            setError(tr('inventory:rowArchiveStillActive'));
          }
        } catch {
          setError(tr('item-detail:lifecycleOutcomeUncertain'));
        }
      } else {
        setError(
          cause instanceof OfflineBeforeSendError
            ? localizedError(cause)
            : cause instanceof Error
              ? `${tr('item-detail:lifecycleChangeRejected')} ${localizedError(cause)}`
              : tr('item-detail:lifecycleChangeRejected'),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function reconcileDelete() {
    const [detailResult, archivedResult] = await Promise.allSettled([
      api<Item>(itemPath),
      api<Pick<Item, 'id' | 'name' | 'primaryUnit' | 'archivedAt'>[]>(
        `/households/${householdId}/items/archived`,
      ),
    ]);
    const detail =
      detailResult.status === 'fulfilled' ? detailResult.value : null;
    const archived =
      archivedResult.status === 'fulfilled' ? archivedResult.value : null;
    if (archived) {
      queryClient.setQueryData(keys.archivedItems(householdId), archived);
    }
    if (detail) {
      queryClient.setQueryData(keys.item(householdId, item.id), detail);
    }
    const detailConfirmsMissing =
      detailResult.status === 'rejected' &&
      detailResult.reason instanceof ApiError &&
      detailResult.reason.code === 'ITEM_NOT_FOUND';
    if (
      archived &&
      !archived.some((entry) => entry.id === item.id) &&
      detailConfirmsMissing
    ) {
      queryClient.removeQueries({
        queryKey: keys.item(householdId, item.id),
        exact: true,
      });
      const refreshed = await refreshAfterPermanentItemDeletion(
        queryClient,
        householdId,
      );
      reportSaved(
        tr('inventory:rowDeleteReconciled', { name: currentName }),
        refreshed,
      );
      return;
    }
    if (archived?.some((entry) => entry.id === item.id) && detail) {
      setCurrentName(detail.name);
      setDeleteName('');
      setError(tr('item-detail:deleteOutcomeStillPresent'));
      return;
    }
    setError(tr('item-detail:deleteOutcomeUncertain'));
  }

  async function deletePermanently() {
    if (busy || action !== 'delete') return;
    setError('');
    if (deleteName !== currentName) {
      setError(tr('item-detail:deleteNameMismatch'));
      return;
    }
    setBusy(true);
    let sent = false;
    try {
      const current = await api<Item>(itemPath);
      queryClient.setQueryData(keys.item(householdId, item.id), current);
      if (!current.archivedAt) {
        setCurrentName(current.name);
        setDeleteName('');
        setError(tr('item-detail:deleteNoLongerArchived'));
        return;
      }
      if (current.name !== currentName) {
        setCurrentName(current.name);
        setDeleteName('');
        setError(tr('item-detail:deleteNameChanged'));
        return;
      }
      if (deleteName !== current.name) {
        setError(tr('item-detail:deleteNameMismatch'));
        return;
      }
      sent = true;
      await api<void>(itemPath, 'DELETE', { confirmName: deleteName });
      queryClient.removeQueries({
        queryKey: keys.item(householdId, item.id),
        exact: true,
      });
      const refreshed = await refreshAfterPermanentItemDeletion(
        queryClient,
        householdId,
      );
      reportSaved(
        tr('inventory:rowDeleted', { name: current.name }),
        refreshed,
      );
    } catch (cause) {
      if (
        sent &&
        !(cause instanceof OfflineBeforeSendError) &&
        isMutationOutcomeUnknown(cause)
      ) {
        setError(tr('item-detail:deleteOutcomeUncertain'));
        await reconcileDelete();
      } else {
        if (
          cause instanceof ApiError &&
          ['DELETE_NAME_MISMATCH', 'ITEM_NOT_ARCHIVED'].includes(
            cause.code ?? '',
          )
        ) {
          try {
            const current = await api<Item>(itemPath);
            queryClient.setQueryData(keys.item(householdId, item.id), current);
            setCurrentName(current.name);
            if (current.name !== currentName) {
              setDeleteName('');
              setError(tr('item-detail:deleteNameChanged'));
              return;
            }
          } catch {
            // Keep the server's deletion response visible if detail cannot refresh.
          }
        }
        setError(
          cause instanceof OfflineBeforeSendError
            ? localizedError(cause)
            : cause instanceof Error
              ? localizedError(cause)
              : tr('item-detail:deleteRejected'),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SwipeReveal
        className="inventory-swipe-item"
        action={action}
        actionLabel={
          isArchiveAction
            ? tr('common:archive')
            : tr('item-detail:deletePermanently')
        }
        itemName={item.name}
        showActionsLabel={tr('inventory:showRowActions', { name: item.name })}
        hideActionsLabel={tr('inventory:hideRowActions', { name: item.name })}
        targetSelector=".inventory-row, .archived-inventory-row a"
        onAction={() => openDialog(action)}
      >
        {children}
      </SwipeReveal>
      <dialog
        className="inventory-lifecycle-dialog"
        ref={dialogRef}
        aria-labelledby={`inventory-lifecycle-title-${id}`}
        onClose={() => setDialog(null)}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDialog(null);
        }}
      >
        {dialog === 'archive' && (
          <div className="field-stack">
            <h2 id={`inventory-lifecycle-title-${id}`}>
              {tr('inventory:confirmArchiveTitle', { name: item.name })}
            </h2>
            <p>{tr('inventory:confirmArchiveBody')}</p>
            {error && <Notice kind="error">{error}</Notice>}
            {blockingTrips.length > 0 && (
              <ul>
                {blockingTrips.map((tripId) => (
                  <li key={tripId}>
                    <Link to={`/households/${householdId}/shopping/${tripId}`}>
                      {tr('item-detail:openBlockingTrip')} {tripId}
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
                onClick={() => setDialog(null)}
              >
                {tr('inventory:confirmArchiveNo')}
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void archive()}
              >
                {busy
                  ? tr('item-detail:archiving')
                  : tr('inventory:confirmArchiveYes')}
              </Button>
            </div>
          </div>
        )}
        {dialog === 'delete' && (
          <div className="field-stack">
            <h2 id={`inventory-lifecycle-title-${id}`}>
              {tr('inventory:confirmDeleteTitle', { name: currentName })}
            </h2>
            <Notice kind="error">
              {tr('inventory:confirmDeleteWarning', { name: currentName })}
            </Notice>
            {error && <Notice kind="error">{error}</Notice>}
            <label htmlFor={`inventory-delete-name-${id}`}>
              {tr('item-detail:typeNameToDelete', { name: currentName })}
              <input
                id={`inventory-delete-name-${id}`}
                ref={deleteInputRef}
                autoComplete="off"
                value={deleteName}
                disabled={busy}
                onChange={(event) => {
                  setDeleteName(event.target.value);
                  setError('');
                }}
              />
            </label>
            <div className="inventory-dialog-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                {tr('inventory:confirmDeleteNo')}
              </Button>
              <Button
                className="inventory-permanent-delete"
                type="button"
                disabled={busy || !deleteName}
                onClick={() => void deletePermanently()}
              >
                {busy
                  ? tr('item-detail:deletingPermanently')
                  : tr('item-detail:deletePermanently')}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
