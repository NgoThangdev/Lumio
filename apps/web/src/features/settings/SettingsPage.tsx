import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  api,
  ApiError,
  OfflineBeforeSendError,
  MutationOutcomeUnknownError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { NotificationPreferences, User } from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';
import { ControlIcon } from '../../shared/ui/ControlIcon';
import {
  applyAppearance,
  readAppearanceChoice,
  saveAppearanceChoice,
  type AppearanceChoice,
} from '../../shared/ui/appearance';
import { HouseholdShoppingSettings } from './HouseholdShoppingSettings';
import i18n, {
  saveLanguageChoice,
  type AppLanguage,
  tr,
} from '../../shared/i18n';

import { localizedError, localizedEnum } from '../../shared/i18n';
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
type PushPublicKey = {
  available: boolean;
  publicKey: string | null;
  reason?: string | null;
};
type PushSubscriptionStatus = { registered: boolean };

function supportedPush() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function permissionState() {
  return supportedPush() ? Notification.permission : 'unsupported';
}

export function SettingsPage({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [appearance, setAppearance] = useState(readAppearanceChoice);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [appearanceNotice, setAppearanceNotice] = useState('');
  const preferenceKey = keys.notificationPreferences(user.id);
  const preferences = useQuery({
    queryKey: preferenceKey,
    queryFn: () => api<NotificationPreferences>('/me/notification-preferences'),
  });
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursDraft, setQuietHoursDraft] = useState({
    start: '22:00',
    end: '07:00',
  });
  const quietStartInput = useRef<HTMLInputElement>(null);
  const quietEndInput = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState('');
  const [permission, setPermission] = useState(permissionState);
  const [offlineShellError, setOfflineShellError] = useState('');
  const [browserSubscription, setBrowserSubscription] =
    useState<PushSubscription | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<
    'checking' | 'registered' | 'unregistered' | 'error'
  >('checking');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const publicKeyQuery = useQuery({
    queryKey: ['user', user.id, 'push-public-key'],
    queryFn: () => api<PushPublicKey>('/me/push-public-key'),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [offlineShell, setOfflineShell] = useState<
    'checking' | 'ready' | 'unsupported' | 'unavailable'
  >(
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? 'checking'
      : 'unsupported',
  );
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
      setQuietHoursDraft(result.quietHours ?? { start: '22:00', end: '07:00' });
      setSaved(true);
    },
  });

  useEffect(() => {
    if (!preferences.data) return;
    setDraft(preferences.data);
    setQuietHoursEnabled(preferences.data.quietHours !== null);
    setQuietHoursDraft(
      preferences.data.quietHours ?? { start: '22:00', end: '07:00' },
    );
  }, [preferences.data]);
  useEffect(() => {
    const update = () => setPermission(permissionState());
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
      if (readAppearanceChoice() === 'system') applyAppearance('system');
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    let active = true;
    setBrowserSubscription(null);
    setRegistrationStatus('checking');
    setPushMessage(null);
    if (!supportedPush()) {
      setRegistrationStatus('unregistered');
      return;
    }
    void navigator.serviceWorker
      .getRegistration('/')
      .then(async (registration) => {
        if (!registration) {
          if (active) setRegistrationStatus('unregistered');
          return;
        }
        const subscription = await registration.pushManager.getSubscription();
        if (!active) return;
        setBrowserSubscription(subscription);
        if (!subscription) {
          setRegistrationStatus('unregistered');
          return;
        }
        try {
          const status = await api<PushSubscriptionStatus>(
            '/me/push-subscription/status',
            'POST',
            { endpoint: subscription.endpoint },
          );
          if (active)
            setRegistrationStatus(
              status.registered ? 'registered' : 'unregistered',
            );
        } catch {
          if (active) setRegistrationStatus('error');
        }
      })
      .catch(() => {
        if (active) setRegistrationStatus('error');
      });
    return () => {
      active = false;
    };
  }, [user.id]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let active = true;
    const ready = () => {
      if (!active) return;
      setOfflineShell('ready');
      setOfflineShellError('');
    };
    const unavailable = (event: Event) => {
      if (!active) return;
      setOfflineShell('unavailable');
      const detail = (event as CustomEvent<unknown>).detail;
      setOfflineShellError(
        detail instanceof Error
          ? detail.message
          : tr('notifications:serviceWorkerActivationFailed'),
      );
    };
    navigator.serviceWorker
      .getRegistration('/')
      .then((registration) => {
        if (!active) return;
        if (registration?.active) ready();
        else if (!registration) {
          setOfflineShell('unavailable');
          setOfflineShellError(tr('notifications:serviceWorkerNotRegistered'));
        } else {
          setOfflineShell('unavailable');
          setOfflineShellError(tr('notifications:serviceWorkerInstalling'));
        }
      })
      .catch(unavailable);
    window.addEventListener('lumio:service-worker-ready', ready);
    window.addEventListener('lumio:service-worker-error', unavailable);
    return () => {
      active = false;
      window.removeEventListener('lumio:service-worker-ready', ready);
      window.removeEventListener('lumio:service-worker-error', unavailable);
    };
  }, []);

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
      const refresh = await queryClient
        .invalidateQueries(
          { queryKey: preferenceKey, exact: true, refetchType: 'active' },
          { throwOnError: true },
        )
        .then(() => true)
        .catch(() => false);
      if (!refresh)
        setRefreshWarning(tr('notifications:preferencesSavedRefreshWarning'));
      else setDraft(result);
    } catch {
      // The mutation error below distinguishes rejection, pre-send offline, and uncertain outcome.
    }
  }

  function chooseAppearance(choice: AppearanceChoice) {
    const persisted = saveAppearanceChoice(choice);
    setAppearance(choice);
    setAppearanceNotice(
      persisted
        ? choice === 'system'
          ? tr('notifications:appearanceFollowingDevice')
          : choice === 'dark'
            ? tr('notifications:darkModeSaved')
            : tr('notifications:lightModeSaved')
        : tr('notifications:appearanceSaveFailed'),
    );
  }

  const pushSupported = permission !== 'unsupported';
  const pushKey = publicKeyQuery.data;
  const pushStatus = !pushSupported
    ? tr('notifications:pushUnsupported')
    : permission === 'denied'
      ? tr('notifications:pushPermissionDenied')
      : permission === 'granted'
        ? registrationStatus === 'registered'
          ? tr('notifications:pushRegistered')
          : registrationStatus === 'checking'
            ? tr('notifications:pushCheckingRegistration')
            : registrationStatus === 'error'
              ? tr('notifications:pushRegistrationUnconfirmed')
              : tr('notifications:pushNotRegistered')
        : tr('notifications:pushPermissionNotRequested');

  function decodePublicKey(value: string) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = atob(padded);
    return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
  }

  async function enablePush() {
    if (pushBusy || !pushKey?.available || !pushKey.publicKey || !pushSupported)
      return;
    setPushBusy(true);
    setPushMessage(null);
    let browserCreatedSubscription = false;
    let serverAcceptedRegistration = false;
    try {
      let registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration)
        registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
      if (!registration.active) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          registration = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () =>
                  reject(
                    new Error(
                      tr('notifications:pushServiceWorkerActivationFailed'),
                    ),
                  ),
                10000,
              );
            }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      }
      let currentPermission = Notification.permission;
      if (currentPermission === 'default')
        currentPermission = await Notification.requestPermission();
      setPermission(currentPermission);
      if (currentPermission !== 'granted') {
        setPushMessage({
          kind: 'error',
          text:
            currentPermission === 'denied'
              ? tr('notifications:pushPermissionDeniedEnable')
              : tr('notifications:pushPermissionNotGranted'),
        });
        return;
      }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodePublicKey(pushKey.publicKey),
        });
        browserCreatedSubscription = true;
      }
      setBrowserSubscription(subscription);
      const serialized = subscription.toJSON();
      if (
        !serialized.endpoint ||
        !serialized.keys?.p256dh ||
        !serialized.keys.auth
      )
        throw new Error(tr('notifications:pushSubscriptionFieldsMissing'));
      const result = await api<PushSubscriptionStatus>(
        '/me/push-subscription',
        'PUT',
        {
          endpoint: serialized.endpoint,
          keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
        },
      );
      serverAcceptedRegistration = result.registered;
      if (!result.registered) {
        setRegistrationStatus('unregistered');
        setPushMessage({
          kind: 'error',
          text: tr('notifications:pushServerDidNotConfirm'),
        });
        return;
      }
      const status = await api<PushSubscriptionStatus>(
        '/me/push-subscription/status',
        'POST',
        { endpoint: serialized.endpoint },
      );
      setRegistrationStatus(status.registered ? 'registered' : 'unregistered');
      setPushMessage(
        status.registered
          ? {
              kind: 'success',
              text: tr('notifications:pushRegisteredCurrentSession'),
            }
          : {
              kind: 'error',
              text: tr('notifications:pushStatusNotConfirmed'),
            },
      );
    } catch (error) {
      setRegistrationStatus('error');
      const reason = localizedError(error);
      const text =
        error instanceof MutationOutcomeUnknownError
          ? tr('notifications:pushRegistrationResult')
          : serverAcceptedRegistration
            ? tr('notifications:serverAcceptedPush', { reason })
            : error instanceof ApiError
              ? tr('notifications:serverRejectedPush', {
                  status: error.status,
                  reason,
                })
              : browserCreatedSubscription
                ? tr('notifications:browserSubscriptionCreated', { reason })
                : tr('notifications:pushSetupCompleted', {
                    reason,
                  });
      setPushMessage({ kind: 'error', text });
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    if (pushBusy) return;
    setPushBusy(true);
    setPushMessage(null);
    let serverResult: { removed: boolean } | null = null;
    let serverError = '';
    let serverOutcomeUnknown = false;
    let browserError = '';
    let browserIsInactive = false;
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;
      const candidate = subscription ?? browserSubscription;
      if (candidate) {
        setBrowserSubscription(candidate);
        try {
          serverResult = await api<{ removed: boolean }>(
            '/me/push-subscription',
            'DELETE',
            { endpoint: candidate.endpoint },
          );
        } catch (error) {
          serverOutcomeUnknown = error instanceof MutationOutcomeUnknownError;
          serverError = localizedError(error);
        }
        try {
          const unsubscribed = await candidate.unsubscribe();
          browserIsInactive =
            unsubscribed ||
            (!!registration &&
              !(await registration.pushManager.getSubscription()));
        } catch (error) {
          browserError = localizedError(error);
        }
      } else {
        browserIsInactive = true;
      }
      if (!serverError && !browserError && browserIsInactive) {
        setBrowserSubscription(null);
        setRegistrationStatus('unregistered');
        setPushMessage({
          kind: 'success',
          text:
            serverResult && !serverResult.removed
              ? tr('notifications:pushUnsubscribedNoRegistration')
              : tr('notifications:pushDisabled'),
        });
      } else {
        setRegistrationStatus('error');
        const serverSummary = serverOutcomeUnknown
          ? tr('notifications:pushRemovalUncertain')
          : serverError
            ? `Server removal failed: ${serverError}. `
            : serverResult?.removed
              ? tr('notifications:pushServerRegistrationRemoved')
              : tr('notifications:pushNoServerRegistration');
        const browserSummary = browserError
          ? `Browser unsubscribe failed: ${browserError}.`
          : browserIsInactive
            ? tr('notifications:browserSubscriptionInactive')
            : tr('notifications:browserSubscriptionMayBeActive');
        setPushMessage({
          kind: 'error',
          text: `Push disable was only partially completed. ${serverSummary}${browserSummary}`,
        });
      }
    } catch (error) {
      setRegistrationStatus('error');
      setPushMessage({
        kind: 'error',
        text: tr('notifications:pushDisableCompleted', {
          error: localizedError(error),
        }),
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function signOut() {
    setSignOutError('');
    setSignOutBusy(true);
    try {
      await onSignOut();
    } catch (error) {
      setSignOutError(localizedError(error));
    } finally {
      setSignOutBusy(false);
    }
  }

  return (
    <section className="settings-page narrow">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">{tr('common:account')}</p>
          <h1>{tr('common:settings')}</h1>
          <p className="muted">{tr('settings:manageHouseholdShopping')}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          {tr('common:back')}
        </Button>
      </div>
      <nav
        className="settings-jump-links"
        aria-label={tr('settings:settingsSections')}
      >
        <a href="#appearance-settings">{tr('settings:appearance')}</a>
        <a href="#household-settings">{tr('common:household')}</a>
        <a href="#notification-settings">{tr('notifications:notifications')}</a>
        <a href="#push-settings">{tr('notifications:browserPush')}</a>
        <a href="#offline-settings">{tr('settings:offlineApp')}</a>
      </nav>
      <Card id="appearance-settings" className="appearance-settings">
        <p className="eyebrow">{tr('notifications:browser')}</p>
        <h2>{tr('settings:appearance')}</h2>
        <p className="muted">{tr('settings:chooseDarkMode')}</p>
        <label className="preference-row appearance-switch">
          <span>
            <strong>{tr('settings:darkMode')}</strong>
            <small>
              {appearance === 'system'
                ? tr('settings:followingDeviceAppearance', {
                    mode: tr(systemDark ? 'common:dark' : 'settings:light'),
                  })
                : tr('notifications:modeSelectedBrowser', {
                    mode: tr(
                      appearance === 'dark' ? 'common:dark' : 'settings:light',
                    ),
                  })}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={
              appearance === 'system' ? systemDark : appearance === 'dark'
            }
            onChange={(event) =>
              chooseAppearance(event.target.checked ? 'dark' : 'light')
            }
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={appearance === 'system'}
          onClick={() => chooseAppearance('system')}
        >
          {tr('settings:useDeviceSetting')}
        </Button>
        {appearanceNotice && (
          <p className="muted" role="status">
            {tr(appearanceNotice as Parameters<typeof tr>[0])}
          </p>
        )}
        <label>
          {tr('settings:language')}
          <select
            value={i18n.resolvedLanguage === 'vi' ? 'vi' : 'en'}
            onChange={(event) =>
              saveLanguageChoice(event.target.value as AppLanguage)
            }
          >
            <option value="en">{tr('settings:english')}</option>
            <option value="vi">{tr('settings:vietnamese')}</option>
          </select>
        </label>
      </Card>
      <section id="household-settings" className="settings-scope">
        <div className="settings-scope-heading">
          <p className="eyebrow">{tr('settings:householdSpecific')}</p>
          <h2>{tr('settings:householdSettings')}</h2>
        </div>
        <HouseholdShoppingSettings />
      </section>
      <Card id="offline-settings">
        <h2>{tr('settings:offlineAppShell')}</h2>
        <p>
          {offlineShell === 'ready'
            ? tr('notifications:serviceWorkerActive')
            : offlineShell === 'unsupported'
              ? tr('notifications:browserSupportOffline')
              : offlineShell === 'unavailable'
                ? tr('settings:offlineShellSetup')
                : tr('notifications:checkingOfflineSupport')}
        </p>
        {offlineShellError && <p className="muted">{offlineShellError}</p>}
      </Card>
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
                    setQuietHoursDraft(
                      draft.quietHours ?? { start: '22:00', end: '07:00' },
                    );
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
      <Card id="push-settings">
        <p className="eyebrow">{tr('notifications:browser')}</p>
        <h2>{tr('notifications:pushNotifications')}</h2>
        <p>{pushStatus}</p>
        {publicKeyQuery.isPending && (
          <p className="muted" role="status">
            {tr('notifications:checkingPushAvailability')}
          </p>
        )}
        {publicKeyQuery.isError && (
          <Notice kind="error">
            {tr('notifications:pushAvailabilityChecked')}{' '}
            {localizedError(publicKeyQuery.error)}
          </Notice>
        )}
        {pushKey && !pushKey.available && (
          <p className="muted">
            {tr('notifications:pushRegistrationUnavailable')}
            {localizedEnum(pushKey.reason ?? 'WEB_PUSH_UNAVAILABLE')}
            {tr('notifications:notificationPermissionRequested')}
          </p>
        )}
        {pushKey?.available &&
          pushKey.publicKey &&
          permission !== 'denied' &&
          registrationStatus !== 'registered' && (
            <Button disabled={pushBusy} onClick={() => void enablePush()}>
              {pushBusy
                ? tr('notifications:enabling')
                : tr('notifications:enablePushBrowser')}
            </Button>
          )}
        {browserSubscription && (
          <Button
            variant="secondary"
            disabled={pushBusy}
            onClick={() => void disablePush()}
          >
            {pushBusy
              ? tr('common:updating')
              : tr('notifications:disablePushBrowser')}
          </Button>
        )}
        {pushMessage && (
          <Notice kind={pushMessage.kind}>{pushMessage.text}</Notice>
        )}
        <p className="muted">{tr('notifications:permissionRequestedOnly')}</p>
      </Card>
      <Card className="settings-signout">
        <h2>{tr('common:account')}</h2>
        {signOutError && <Notice kind="error">{signOutError}</Notice>}
        <Button
          type="button"
          variant="secondary"
          disabled={signOutBusy}
          onClick={() => void signOut()}
        >
          <ControlIcon name="logout" />
          {signOutBusy ? tr('common:updating') : tr('common:signOut')}
        </Button>
      </Card>
    </section>
  );
}
