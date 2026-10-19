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
import {
  applyAppearance,
  readAppearanceChoice,
  saveAppearanceChoice,
  type AppearanceChoice,
} from '../../shared/ui/appearance';
import { HouseholdShoppingSettings } from './HouseholdShoppingSettings';

const categories = [
  ['expiryAlertsEnabled', 'Expiry alerts', 'When stock is close to expiring.'],
  [
    'lowStockAlertsEnabled',
    'Low stock alerts',
    'When the backend marks stock as low or out.',
  ],
  [
    'shoppingRemindersEnabled',
    'Shopping reminders',
    'Shopping reminders, when available.',
  ],
  [
    'dailyDigestEnabled',
    'Daily digest',
    'A daily summary, when delivery is available.',
  ],
  [
    'householdEventsEnabled',
    'Household events',
    'Optional household event alerts, when available.',
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

export function SettingsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
          : 'The browser did not activate the service worker.',
      );
    };
    navigator.serviceWorker
      .getRegistration('/')
      .then((registration) => {
        if (!active) return;
        if (registration?.active) ready();
        else if (!registration) {
          setOfflineShell('unavailable');
          setOfflineShellError(
            'The app service worker is not registered in this build.',
          );
        } else {
          setOfflineShell('unavailable');
          setOfflineShellError(
            'The app service worker is still installing. Reload after it becomes active.',
          );
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
        setRefreshWarning(
          'Your preferences were saved, but readback could not refresh. Reopen Settings to verify them.',
        );
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
          ? 'Lumio is following this device’s appearance setting.'
          : `${choice === 'dark' ? 'Dark' : 'Light'} Mode is saved in this browser.`
        : 'Appearance changed for this page, but this browser could not save the choice. It may reset after reload.',
    );
  }

  const pushSupported = permission !== 'unsupported';
  const pushKey = publicKeyQuery.data;
  const pushStatus = !pushSupported
    ? 'This browser does not support Web Push.'
    : permission === 'denied'
      ? 'Browser permission is denied. Change it in browser settings if you want to allow notifications later.'
      : permission === 'granted'
        ? registrationStatus === 'registered'
          ? 'Registered for this signed-in session on this browser.'
          : registrationStatus === 'checking'
            ? 'Checking this browser’s registration for your account…'
            : registrationStatus === 'error'
              ? 'Registration status could not be confirmed for this session.'
              : 'This browser is not registered for this signed-in session.'
        : 'Browser permission has not been requested.';

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
                      'The Lumio service worker did not activate. Reload and try again.',
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
              ? 'Browser permission was denied. Change it in browser settings before enabling Push.'
              : 'Push permission was not granted, so this browser was not registered.',
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
        throw new Error(
          'The browser did not provide the required subscription fields.',
        );
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
          text: 'The server did not confirm registration for this session.',
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
              text: 'This browser is registered for your current session.',
            }
          : {
              kind: 'error',
              text: 'The server accepted the request, but current-session status did not confirm registration.',
            },
      );
    } catch (error) {
      setRegistrationStatus('error');
      const reason = error instanceof Error ? error.message : 'Unknown error';
      const text =
        error instanceof MutationOutcomeUnknownError
          ? `The registration request outcome is uncertain. Reload Settings to check this session’s status before choosing whether to retry.`
          : serverAcceptedRegistration
            ? `The server accepted registration, but this session’s status could not be confirmed: ${reason}. Reload Settings to check before choosing whether to retry.`
            : error instanceof ApiError
              ? `The server rejected Push registration (${error.status}): ${reason}`
              : browserCreatedSubscription
                ? `The browser subscription was created, but server registration was not confirmed: ${reason}. Check this browser’s status before choosing whether to try again.`
                : `Push setup could not be completed: ${reason}`;
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
          serverError =
            error instanceof Error ? error.message : 'Server removal failed.';
        }
        try {
          const unsubscribed = await candidate.unsubscribe();
          browserIsInactive =
            unsubscribed ||
            (!!registration &&
              !(await registration.pushManager.getSubscription()));
        } catch (error) {
          browserError =
            error instanceof Error
              ? error.message
              : 'Browser unsubscribe failed.';
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
              ? 'This browser was unsubscribed. The current session had no server registration to remove.'
              : 'Push was disabled for this browser and session.',
        });
      } else {
        setRegistrationStatus('error');
        const serverSummary = serverOutcomeUnknown
          ? 'Server removal outcome is uncertain; check registration status after reload. '
          : serverError
            ? `Server removal failed: ${serverError}. `
            : serverResult?.removed
              ? 'Server registration was removed. '
              : 'The current session had no server registration to remove. ';
        const browserSummary = browserError
          ? `Browser unsubscribe failed: ${browserError}.`
          : browserIsInactive
            ? 'The browser subscription is inactive.'
            : 'The browser subscription may still be active.';
        setPushMessage({
          kind: 'error',
          text: `Push disable was only partially completed. ${serverSummary}${browserSummary}`,
        });
      }
    } catch (error) {
      setRegistrationStatus('error');
      setPushMessage({
        kind: 'error',
        text: `Push disable could not be completed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <section className="settings-page narrow">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Settings</h1>
          <p className="muted">
            Manage household shopping defaults and your own notification
            choices.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
      <nav className="settings-jump-links" aria-label="Settings sections">
        <a href="#appearance-settings">Appearance</a>
        <a href="#household-settings">Household</a>
        <a href="#notification-settings">Notifications</a>
        <a href="#push-settings">Browser Push</a>
        <a href="#offline-settings">Offline app</a>
      </nav>
      <Card id="appearance-settings" className="appearance-settings">
        <p className="eyebrow">This browser</p>
        <h2>Appearance</h2>
        <p className="muted">
          Choose Dark Mode, keep Light Mode, or return to your device setting.
        </p>
        <label className="preference-row appearance-switch">
          <span>
            <strong>Dark Mode</strong>
            <small>
              {appearance === 'system'
                ? `Following device appearance (${systemDark ? 'Dark' : 'Light'}).`
                : `${appearance === 'dark' ? 'Dark' : 'Light'} Mode is selected in this browser.`}
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
          Use device setting
        </Button>
        {appearanceNotice && (
          <p className="muted" role="status">
            {appearanceNotice}
          </p>
        )}
      </Card>
      <section id="household-settings" className="settings-scope">
        <div className="settings-scope-heading">
          <p className="eyebrow">Household-specific</p>
          <h2>Household settings</h2>
        </div>
        <HouseholdShoppingSettings />
      </section>
      <Card id="offline-settings">
        <h2>Offline app shell</h2>
        <p>
          {offlineShell === 'ready'
            ? 'The service worker is active on this browser.'
            : offlineShell === 'unsupported'
              ? 'This browser does not support offline app shells.'
              : offlineShell === 'unavailable'
                ? 'Offline shell setup could not be confirmed. Keep a connection available to use Lumio.'
                : 'Checking offline support…'}
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
          Loading your notification preferences…
        </p>
      )}
      {preferences.isError && (
        <>
          <Notice kind="error">
            Notification preferences could not be loaded:{' '}
            {preferences.error.message}
          </Notice>
          <Button
            variant="secondary"
            onClick={() => void preferences.refetch()}
          >
            Retry preferences
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
          <p className="muted">
            All alert categories are currently off according to your saved
            preferences.
          </p>
        )}
      {saved && <Notice kind="success">Notification preferences saved.</Notice>}
      {refreshWarning && <Notice kind="error">{refreshWarning}</Notice>}
      {save.isError && (
        <Notice kind="error">
          {save.error instanceof OfflineBeforeSendError
            ? save.error.message
            : save.error instanceof MutationOutcomeUnknownError
              ? 'The save result is uncertain because the connection failed. Reload Settings and check the saved values before choosing to retry.'
              : save.error instanceof ApiError &&
                  save.error.status === 400 &&
                  save.error.code === 'INVALID_DIGEST_TIME'
                ? `Digest time was not saved: ${save.error.message}. Choose a time in 24-hour HH:mm format.`
                : `Preferences were not saved: ${save.error.message}`}
        </Notice>
      )}
      {draft && (
        <Card>
          <p className="eyebrow">Your account · across households</p>
          <h2>Notifications</h2>
          <p className="muted">
            These preferences are saved to your account. Automatic notification
            delivery depends on server setup.
          </p>
          {categories.map(([key, title, help]) => (
            <label className="preference-row" key={key}>
              <span>
                <strong>{title}</strong>
                <small>{help}</small>
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
              Daily digest time
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
              <small className="muted">Timezone: {draft.timezone}</small>
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
              Quiet hours
            </label>
            {quietHoursEnabled && (
              <div className="quiet-hours-times">
                <label>
                  Start
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
                  End
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
                <p className="muted">Timezone: {draft.timezone}</p>
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
            {save.isPending ? 'Saving…' : 'Save preferences'}
          </Button>
        </Card>
      )}
      <Card id="push-settings">
        <p className="eyebrow">This browser</p>
        <h2>Push notifications</h2>
        <p>{pushStatus}</p>
        {publicKeyQuery.isPending && (
          <p className="muted" role="status">
            Checking Push availability…
          </p>
        )}
        {publicKeyQuery.isError && (
          <Notice kind="error">
            Push availability could not be checked:{' '}
            {publicKeyQuery.error.message}
          </Notice>
        )}
        {pushKey && !pushKey.available && (
          <p className="muted">
            Push registration is unavailable (
            {pushKey.reason ?? 'WEB_PUSH_UNAVAILABLE'}). Notification permission
            will not be requested.
          </p>
        )}
        {pushKey?.available &&
          pushKey.publicKey &&
          permission !== 'denied' &&
          registrationStatus !== 'registered' && (
            <Button disabled={pushBusy} onClick={() => void enablePush()}>
              {pushBusy ? 'Enabling…' : 'Enable Push on this browser'}
            </Button>
          )}
        {browserSubscription && (
          <Button
            variant="secondary"
            disabled={pushBusy}
            onClick={() => void disablePush()}
          >
            {pushBusy ? 'Updating…' : 'Disable Push on this browser'}
          </Button>
        )}
        {pushMessage && (
          <Notice kind={pushMessage.kind}>{pushMessage.text}</Notice>
        )}
        <p className="muted">
          Permission is requested only after you choose Enable. Notification
          delivery is not active in this local setup.
        </p>
      </Card>
    </section>
  );
}
