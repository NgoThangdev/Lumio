import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  api,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { Item } from '@/shared/api/types';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import { refreshItemLifecycle } from '../item-detail/itemLifecycle';

import { tr } from '@/shared/i18n';
import { localizedError } from '@/shared/i18n';
type ArchivedItem = Pick<Item, 'id' | 'name' | 'primaryUnit' | 'archivedAt'>;

export function ArchivedItems({ householdId }: { householdId: string }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const archived = useQuery({
    queryKey: keys.archivedItems(householdId),
    queryFn: () =>
      api<ArchivedItem[]>(`/households/${householdId}/items/archived`),
  });

  async function restore(itemId: string) {
    if (busyId) return;
    setBusyId(itemId);
    setNotice('');
    setError('');
    try {
      const saved = await api<Item>(
        `/households/${householdId}/items/${itemId}/restore`,
        'POST',
      );
      queryClient.setQueryData(keys.item(householdId, itemId), saved);
      setNotice(tr('inventory:restoredActiveInventory', { name: saved.name }));
      if (!(await refreshItemLifecycle(queryClient, householdId, itemId))) {
        setError(tr('inventory:restoreRefreshWarning'));
      }
    } catch (cause) {
      setError(
        cause instanceof OfflineBeforeSendError
          ? localizedError(cause)
          : isMutationOutcomeUnknown(cause)
            ? tr('inventory:restoreOutcomeUncertain')
            : cause instanceof Error
              ? `Restore was not saved: ${localizedError(cause)}`
              : tr('inventory:restoreRejected'),
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <Card>
      <h2>{tr('inventory:archivedItems')}</h2>
      <p className="muted">{tr('inventory:stockHistoryRemain')}</p>
      {notice && <Notice kind="success">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {archived.isPending && (
        <p role="status">{tr('inventory:loadingArchivedItems')}</p>
      )}
      {archived.isError && (
        <>
          <Notice kind="error">
            {tr('inventory:archivedItemsLoad')} {localizedError(archived.error)}
          </Notice>
          <Button variant="secondary" onClick={() => void archived.refetch()}>
            {tr('common:retry')}
          </Button>
        </>
      )}
      {archived.data?.length === 0 && (
        <p className="muted">{tr('inventory:archivedItems2')}</p>
      )}
      {archived.data?.map((item) => (
        <div className="row" key={item.id}>
          <Link to={`/households/${householdId}/inventory/${item.id}`}>
            {item.name} · {item.primaryUnit}
          </Link>
          <Button
            variant="secondary"
            disabled={!!busyId}
            onClick={() => void restore(item.id)}
          >
            {busyId === item.id ? tr('common:restoring') : tr('common:restore')}
          </Button>
        </div>
      ))}
    </Card>
  );
}
