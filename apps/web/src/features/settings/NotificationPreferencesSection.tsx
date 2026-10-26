import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  api,
  MutationOutcomeUnknownError,
  OfflineBeforeSendError,
} from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { NotificationPreferences, User } from '@/shared/api/types';
import { localizedError, tr } from '@/shared/i18n';
import { Button, Card, Notice } from '@/shared/ui/primitives';

const categories = [
  [
    'expiryAlertsEnabled',
    'notifications:expiryAlerts',
    'notifications:expiryAlertDescription',
  ],
  [
    'lowStockAlertsEnabled',
    'notifications:lowStockAlerts',
    'notifications:lowStockAlertDescription',
  ],
  [
    'shoppingRemindersEnabled',
    'notifications:shoppingReminders',
    'notifications:shoppingReminderDescription',
  ],
  [
    'dailyDigestEnabled',
    'notifications:dailyDigest',
    'notifications:dailyDigestDescription',
  ],
  [
    'householdEventsEnabled',
    'notifications:householdEvents',
    'notifications:householdEventDescription',
  ],
] as const;

type PreferenceKey = (typeof categories)[number][0];

const SUGGESTED_QUIET_HOURS_DRAFT = { start: '22:00', end: '07:00' } as const;
const createQuietHoursDraft = (
  saved: NotificationPreferences['quietHours'],
): { start: string; end: string } =>
  saved ? { ...saved } : { ...SUGGESTED_QUIET_HOURS_DRAFT };

export function NotificationPreferencesSection({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const preferenceKey = keys.notificationPreferences(user.id);
  const preferences = useQuery({
    queryKey: preferenceKey,
    queryFn: () => api<NotificationPreferences>('/me/notification-preferences'),
  });
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursDraft, setQuietHoursDraft] = useState(() =>
    createQuietHoursDraft(null),
  );
  const quietStartInput = useRef<HTMLInputElement>(null);
  const quietEndInput = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState('');
  const save = useMutation({
    mutationFn: (
      body: Pick<NotificationPreferences, PreferenceKey> & {
        digestTime: NotificationPreferences['digestTime'];
        quietHours: NotificationPreferences['quietHours'];
      },
    ) =>
      api<NotificationPreferences>(
        '/me/notification-preferences',
        'PATCH',
        body,
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(preferenceKey, result);
      setDraft(result);
      setQuietHoursEnabled(result.quietHours !== null);
      setQuietHoursDraft(createQuietHoursDraft(result.quietHours));
      setSaved(true);
    },
  });

  useEffect(() => {
    if (!preferences.data) return;
    setDraft(preferences.data);
    setQuietHoursEnabled(preferences.data.quietHours !== null);
    setQuietHoursDraft(createQuietHoursDraft(preferences.data.quietHours));
  }, [preferences.data]);

  async function submit() {
    if (!draft || save.isPending) return;
    setSaved(false);
    setRefreshWarning('');
    const body = {
      expiryAlertsEnabled: draft.expiryAlertsEnabled,
      lowStockAlertsEnabled: draft.lowStockAlertsEnabled,
      shoppingRemindersEnabled: draft.shoppingRemindersEnabled,
      dailyDigestEnabled: draft.dailyDigestEnabled,
      digestTime: draft.digestTime,
      householdEventsEnabled: draft.householdEventsEnabled,
      quietHours: quietHoursEnabled
        ? {
            start: quietStartInput.current?.value || quietHoursDraft.start,
            end: quietEndInput.current?.value || quietHoursDraft.end,
          }
        : null,
    };
    try {
      const result = await save.mutateAsync(body);
      const refreshed = await queryClient
        .invalidateQueries(
          { queryKey: preferenceKey, exact: true, refetchType: 'active' },
          { throwOnError: true },
        )
        .then(() => true)
        .catch(() => false);
      if (!refreshed)
        setRefreshWarning(tr('notifications:preferencesSavedRefreshWarning'));
      else setDraft(result);
    } catch {
      // The mutation error below distinguishes rejection, pre-send offline, and uncertain outcome.
    }
  }

  return (
    <>
      <div
        id="notification-settings"
        className="settings-anchor"
        aria-hidden="true"
      />
      {preferences.isPending && (
        <p className="muted" role="status">
          {tr('notifications:loadingNotificationPreferences')}
        </p>
      )}
      {preferences.isError && (
        <>
          <Notice kind="error">
            {tr('notifications:notificationPreferencesLoaded')}{' '}
            {localizedError(preferences.error)}
          </Notice>
          <Button
            variant="secondary"
            onClick={() => void preferences.refetch()}
          >
            {tr('notifications:retryPreferences')}
          </Button>
        </>
      )}
      {draft &&
        preferences.data &&
        !preferences.data.expiryAlertsEnabled &&
        !preferences.data.lowStockAlertsEnabled &&
        !preferences.data.shoppingRemindersEnabled &&
        !preferences.data.dailyDigestEnabled &&
        !preferences.data.householdEventsEnabled && (
          <p className="muted">{tr('notifications:allAlertCategories')}</p>
        )}
      {saved && (
        <Notice kind="success">
          {tr('notifications:notificationPreferencesSaved')}
        </Notice>
      )}
      {refreshWarning && <Notice kind="error">{refreshWarning}</Notice>}
      {save.isError && (
        <Notice kind="error">
          {save.error instanceof OfflineBeforeSendError
            ? localizedError(save.error)
            : save.error instanceof MutationOutcomeUnknownError
              ? tr('notifications:saveResultUncertain')
              : save.error instanceof ApiError &&
                  save.error.status === 400 &&
                  save.error.code === 'INVALID_DIGEST_TIME'
                ? tr('notifications:digestTimeSaved', {
                    error: localizedError(save.error),
                  })
                : tr('settings:preferencesSaved', {
                    error: localizedError(save.error),
                  })}
        </Notice>
      )}
      {draft && (
        <Card>
          <p className="eyebrow">{tr('settings:accountAcrossHouseholds')}</p>
          <h2>{tr('notifications:notifications')}</h2>
          <p className="muted">{tr('notifications:preferencesSavedAccount')}</p>
          {categories.map(([key, title, help]) => (
            <label className="preference-row" key={key}>
              <span>
                <strong>{tr(title)}</strong>
                <small>{tr(help)}</small>
              </span>
              <input
                type="checkbox"
                checked={draft[key]}
                disabled={save.isPending}
                onChange={(event) => {
                  setSaved(false);
                  setDraft((current) =>
                    current
                      ? { ...current, [key]: event.target.checked }
                      : current,
                  );
                }}
              />
            </label>
          ))}
          {draft.dailyDigestEnabled && (
            <label>
              {tr('notifications:dailyDigestTime')}
              <input
                type="time"
                value={draft.digestTime}
                required
                disabled={save.isPending}
                onChange={(event) => {
                  setSaved(false);
                  setDraft((current) =>
                    current
                      ? { ...current, digestTime: event.target.value }
                      : current,
                  );
                }}
              />
              <small className="muted">
                {tr('notifications:timezone')} {draft.timezone}
              </small>
            </label>
          )}
          <section className="quiet-hours">
            <label className="check-label">
              <input
                type="checkbox"
                checked={quietHoursEnabled}
                disabled={save.isPending}
                onChange={(event) => {
                  setSaved(false);
                  setQuietHoursEnabled(event.target.checked);
                  if (event.target.checked)
                    setQuietHoursDraft(createQuietHoursDraft(draft.quietHours));
                }}
              />
              {tr('notifications:quietHours')}
            </label>
            {quietHoursEnabled && (
              <div className="quiet-hours-times">
                <label>
                  {tr('common:start')}
                  <input
                    ref={quietStartInput}
                    type="time"
                    value={quietHoursDraft.start}
                    disabled={save.isPending}
                    onChange={(event) => {
                      setSaved(false);
                      setQuietHoursDraft((current) => ({
                        ...current,
                        start: event.target.value,
                      }));
                    }}
                  />
                </label>
                <label>
                  {tr('settings:end')}
                  <input
                    ref={quietEndInput}
                    type="time"
                    value={quietHoursDraft.end}
                    disabled={save.isPending}
                    onChange={(event) => {
                      setSaved(false);
                      setQuietHoursDraft((current) => ({
                        ...current,
                        end: event.target.value,
                      }));
                    }}
                  />
                </label>
                <p className="muted">
                  {tr('notifications:timezone')} {draft.timezone}
                </p>
              </div>
            )}
          </section>
          <Button
            className="wide"
            disabled={
              save.isPending ||
              (quietHoursEnabled &&
                quietHoursDraft.start === quietHoursDraft.end)
            }
            onClick={() => void submit()}
          >
            {save.isPending
              ? tr('common:saving')
              : tr('notifications:savePreferences')}
          </Button>
        </Card>
      )}
    </>
  );
}
