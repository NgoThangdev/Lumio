import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError, api, isMutationOutcomeUnknown } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { Household, User } from '@/shared/api/types';
import { formatDate, localizedError, tr } from '@/shared/i18n';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import {
  HOUSEHOLD_DELETION_COUNT_GROUPS,
  HOUSEHOLD_DELETION_COUNT_LABELS,
  isHouseholdDeletionImpact,
  type HouseholdDeletionImpact,
  type HouseholdDeletionSchedule,
} from './householdDeletionTypes';
import {
  refreshAfterHouseholdDeletion,
  refreshHouseholdLists,
} from './householdDeletionQueries';

const scheduleSmokeEnabled =
  import.meta.env.DEV &&
  import.meta.env.VITE_ENABLE_HOUSEHOLD_DELETION_SMOKE === 'true';

export function HouseholdDeletionSection({
  household,
  user,
  titleId,
  onComplete,
}: {
  household: Household;
  user: User;
  titleId?: string;
  onComplete?: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const impactKey = keys.householdDeletionImpact(household.id);
  const impact = useQuery({
    queryKey: impactKey,
    queryFn: () =>
      api<HouseholdDeletionImpact>(
        `/households/${household.id}/deletion-impact`,
      ),
  });
  const [typedName, setTypedName] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<'schedule' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function resetConfirmation() {
    setTypedName('');
    setReviewed(false);
  }

  function confirmationReady(current: HouseholdDeletionImpact) {
    if (!reviewed) {
      setError(tr('settings:deletionReviewRequired'));
      return false;
    }
    if (typedName !== current.household.name) {
      setError(tr('settings:deletionNameMismatch'));
      return false;
    }
    return true;
  }

  function applyFreshImpact(cause: ApiError) {
    if (cause.code !== 'HOUSEHOLD_IMPACT_CHANGED') return false;
    if (isHouseholdDeletionImpact(cause.impact)) {
      queryClient.setQueryData(impactKey, cause.impact);
      resetConfirmation();
      setError(tr('settings:deletionImpactChangedReview'));
    } else {
      void impact.refetch();
      resetConfirmation();
      setError(tr('settings:deletionImpactChangedReload'));
    }
    return true;
  }

  async function reconcileUncertain(kind: 'schedule' | 'delete') {
    const state = await refreshHouseholdLists(queryClient, user.id);
    const active = state.households?.find((entry) => entry.id === household.id);
    const pending = state.pending?.find((entry) => entry.id === household.id);
    queryClient.removeQueries({ queryKey: keys.household(household.id) });

    if (kind === 'schedule' && pending) {
      setError('');
      setNotice(
        tr('settings:deletionScheduleReconciled', {
          date: formatDate(pending.dueAt),
        }),
      );
      resetConfirmation();
      void navigate('/settings', { replace: true });
      return;
    }
    if (kind === 'delete' && state.refreshed && !active && !pending) {
      setError(tr('settings:deletionUnavailableAfterUncertain'));
      void navigate('/households', {
        replace: true,
        state: {
          notice: tr('settings:deletionUnavailableAfterUncertain'),
          noticeKind: 'error',
        },
      });
      onComplete?.();
      return;
    }
    if (active) {
      await impact.refetch();
      resetConfirmation();
      setError(
        kind === 'schedule'
          ? tr('settings:deletionScheduleUncertainStillActive')
          : tr('settings:deletionUncertainStillActive'),
      );
      return;
    }
    if (kind === 'delete' && pending) {
      setError(tr('settings:deletionAlreadyPending'));
      void navigate('/settings', { replace: true });
      return;
    }
    setError(tr('settings:deletionOutcomeUncertain'));
  }

  async function scheduleDeletion() {
    if (!scheduleSmokeEnabled || busy || !impact.data) return;
    setError('');
    setNotice('');
    if (!confirmationReady(impact.data)) return;
    setBusy('schedule');
    let sent = false;
    try {
      sent = true;
      const result = await api<HouseholdDeletionSchedule>(
        `/households/${household.id}/deletion-request`,
        'POST',
        {
          confirmName: typedName,
          confirmedImpact: impact.data.counts,
        },
      );
      queryClient.removeQueries({ queryKey: keys.household(household.id) });
      const lists = await refreshHouseholdLists(queryClient, user.id);
      resetConfirmation();
      if (!lists.refreshed) {
        setError(tr('settings:deletionSavedRefreshWarning'));
      } else {
        setNotice(
          tr('settings:deletionScheduled', {
            requestedAt: formatDate(result.requestedAt),
            dueAt: formatDate(result.dueAt),
          }),
        );
      }
      void navigate('/settings', { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && applyFreshImpact(cause)) return;
      if (sent && isMutationOutcomeUnknown(cause)) {
        setError(tr('settings:deletionScheduleUncertain'));
        await reconcileUncertain('schedule');
      } else {
        setError(localizedError(cause));
      }
    } finally {
      setBusy(null);
    }
  }

  async function deleteImmediately() {
    if (busy || !impact.data) return;
    setError('');
    setNotice('');
    if (!confirmationReady(impact.data)) return;
    setBusy('delete');
    let sent = false;
    try {
      sent = true;
      await api(`/households/${household.id}`, 'DELETE', {
        confirmName: typedName,
        confirmedImpact: impact.data.counts,
      });
      const refreshed = await refreshAfterHouseholdDeletion(
        queryClient,
        household.id,
        user.id,
      );
      void navigate('/households', {
        replace: true,
        state: {
          notice: refreshed
            ? tr('settings:deletionComplete')
            : tr('settings:deletionCompleteRefreshWarning'),
        },
      });
      onComplete?.();
    } catch (cause) {
      if (cause instanceof ApiError && applyFreshImpact(cause)) return;
      if (sent && isMutationOutcomeUnknown(cause)) {
        setError(tr('settings:deletionOutcomeUncertain'));
        await reconcileUncertain('delete');
      } else {
        if (
          cause instanceof ApiError &&
          cause.code === 'HOUSEHOLD_NAME_CONFIRMATION_MISMATCH'
        )
          resetConfirmation();
        setError(localizedError(cause));
      }
    } finally {
      setBusy(null);
    }
  }

  const currentImpact =
    impact.data && isHouseholdDeletionImpact(impact.data) ? impact.data : null;

  return (
    <Card className="household-deletion-card">
      <h3 id={titleId}>{tr('settings:householdDeletion')}</h3>
      <p className="muted">{tr('settings:deletionImpactIntro')}</p>
      {impact.isPending && <p role="status">{tr('common:loading')}</p>}
      {impact.isError && (
        <>
          <Notice kind="error">{localizedError(impact.error)}</Notice>
          <Button variant="secondary" onClick={() => void impact.refetch()}>
            {tr('common:retry')}
          </Button>
        </>
      )}
      {currentImpact && (
        <>
          <p>
            <strong>{currentImpact.household.name}</strong>
          </p>
          {HOUSEHOLD_DELETION_COUNT_GROUPS.map((group) => (
            <section className="deletion-impact-group" key={group.title}>
              <h4>{tr(group.title)}</h4>
              <dl>
                {group.fields.map((field) => (
                  <div key={field}>
                    <dt>{tr(HOUSEHOLD_DELETION_COUNT_LABELS[field])}</dt>
                    <dd>{currentImpact.counts[field]}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <label className="deletion-review-check">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy !== null}
              onChange={(event) => {
                setReviewed(event.target.checked);
                setError('');
              }}
            />
            <span>{tr('settings:deletionReviewCheck')}</span>
          </label>
          <label>
            {tr('settings:deletionTypeName', {
              name: currentImpact.household.name,
            })}
            <input
              value={typedName}
              disabled={busy !== null}
              autoComplete="off"
              onChange={(event) => {
                setTypedName(event.target.value);
                setError('');
              }}
            />
          </label>
          {notice && <Notice kind="success">{notice}</Notice>}
          {error && <Notice kind="error">{error}</Notice>}
          {scheduleSmokeEnabled && (
            <section className="deletion-schedule-area">
              <h4>{tr('settings:scheduleDeletion')}</h4>
              <p className="muted">{tr('settings:deletionNoWorker')}</p>
              <Button
                variant="secondary"
                disabled={busy !== null || !reviewed}
                onClick={() => void scheduleDeletion()}
              >
                {busy === 'schedule'
                  ? tr('common:saving')
                  : tr('settings:scheduleDeletion7Days')}
              </Button>
            </section>
          )}
          <section className="deletion-immediate-area">
            <h4>{tr('settings:deleteImmediately')}</h4>
            <Notice kind="error">
              {tr('settings:deletionIrreversibleWarning')}
            </Notice>
            <Button
              className="deletion-danger-button"
              disabled={busy !== null || !reviewed}
              onClick={() => void deleteImmediately()}
            >
              {busy === 'delete'
                ? tr('settings:deletingHousehold')
                : tr('settings:deleteHouseholdNow')}
            </Button>
          </section>
        </>
      )}
    </Card>
  );
}
