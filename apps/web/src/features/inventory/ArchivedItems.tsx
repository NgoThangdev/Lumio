import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  api,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { Item } from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';
import { refreshItemLifecycle } from './itemLifecycle';

type ArchivedItem = Pick<Item, 'id' | 'name' | 'primaryUnit' | 'archivedAt'>;

export function ArchivedItems({ householdId }: { householdId: string }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const archived = useQuery({
    queryKey: ['household', householdId, 'archived-items'],
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
      setNotice(`${saved.name} restored to active Inventory.`);
      if (!(await refreshItemLifecycle(queryClient, householdId, itemId))) {
        setError(
          'Restored, but some views could not refresh. Reload to check current Inventory and Shopping data.',
        );
      }
    } catch (cause) {
      setError(
        cause instanceof OfflineBeforeSendError
          ? cause.message
          : isMutationOutcomeUnknown(cause)
            ? 'The result is uncertain. Reload archived items and check Item Detail before choosing to retry.'
            : cause instanceof Error
              ? `Restore was not saved: ${cause.message}`
              : 'Restore was not saved.',
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <Card>
      <h2>Archived items</h2>
      <p className="muted">
        Stock and history remain available in Item Detail.
      </p>
      {notice && <Notice kind="success">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {archived.isPending && <p role="status">Loading archived items…</p>}
      {archived.isError && (
        <>
          <Notice kind="error">
            Archived items could not load: {archived.error.message}
          </Notice>
          <Button variant="secondary" onClick={() => void archived.refetch()}>
            Retry
          </Button>
        </>
      )}
      {archived.data?.length === 0 && (
        <p className="muted">No archived items.</p>
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
            {busyId === item.id ? 'Restoring…' : 'Restore'}
          </Button>
        </div>
      ))}
    </Card>
  );
}
