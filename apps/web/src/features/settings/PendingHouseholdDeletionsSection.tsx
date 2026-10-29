import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, isMutationOutcomeUnknown } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { User } from '@/shared/api/types';
import { formatDate, localizedError, tr } from '@/shared/i18n';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import type { PendingHouseholdDeletion } from './householdDeletionTypes';
import { refreshHouseholdLists } from './householdDeletionQueries';

export function PendingHouseholdDeletionsSection({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: keys.pendingDeletions(user.id),
    queryFn: () =>
      api<PendingHouseholdDeletion[]>('/households/pending-deletions'),
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function cancel(entry: PendingHouseholdDeletion) {
    if (busyId) return;
    setBusyId(entry.id);
    setError('');
    setNotice('');
    let sent = false;
    try {
      sent = true;
      await api(
        `/households/${entry.id}/deletion-request/${entry.requestId}`,
        'DELETE',
      );
      queryClient.removeQueries({ queryKey: keys.household(entry.id) });
      const lists = await refreshHouseholdLists(queryClient, user.id);
      setNotice(
        lists.refreshed
          ? tr('settings:deletionCancelled', { name: entry.name })
          : tr('settings:deletionCancelledRefreshWarning'),
      );
    } catch (cause) {
      if (sent && isMutationOutcomeUnknown(cause)) {
        const state = await refreshHouseholdLists(queryClient, user.id);
        const active = state.households?.some((item) => item.id === entry.id);
        const pending = state.pending?.some((item) => item.id === entry.id);
        setError(
          active && !pending
            ? tr('settings:deletionCancelReconciled')
            : tr('settings:deletionCancelUncertain'),
        );
      } else {
        setError(
          cause instanceof ApiError &&
            cause.code === 'HOUSEHOLD_DELETION_REQUEST_STALE'
            ? tr('settings:deletionRequestStale')
            : localizedError(cause),
        );
        await refreshHouseholdLists(queryClient, user.id);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="settings-scope" id="pending-deletions-settings">
      <div className="settings-scope-heading">
        <p className="eyebrow">{tr('settings:accountAcrossHouseholds')}</p>
        <h2>{tr('settings:pendingHouseholdDeletions')}</h2>
      </div>
      <Card>
        <p className="muted">{tr('settings:pendingDeletionWorkerNote')}</p>
        {query.isPending && <p role="status">{tr('common:loading')}</p>}
        {query.isError && (
          <>
            <Notice kind="error">{localizedError(query.error)}</Notice>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {tr('common:retry')}
            </Button>
          </>
        )}
        {query.data?.length === 0 && (
          <p className="muted">{tr('settings:noPendingDeletions')}</p>
        )}
        {query.data?.map((entry) => (
          <article className="pending-deletion-row" key={entry.requestId}>
            <h3>{entry.name}</h3>
            <p>
              {tr('settings:deletionRequestedAt', {
                date: formatDate(entry.requestedAt),
              })}
            </p>
            <p>
              {tr('settings:deletionDueAt', { date: formatDate(entry.dueAt) })}
            </p>
            <Button
              variant="secondary"
              disabled={busyId !== null}
              onClick={() => void cancel(entry)}
            >
              {busyId === entry.id
                ? tr('settings:cancellingDeletion')
                : tr('settings:cancelDeletion')}
            </Button>
          </article>
        ))}
        {notice && <Notice kind="success">{notice}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
      </Card>
    </section>
  );
}
