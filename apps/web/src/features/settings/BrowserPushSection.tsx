import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ApiError,
  api,
  MutationOutcomeUnknownError,
} from '@/shared/api/client';
import type { User } from '@/shared/api/types';
import { localizedError, localizedEnum, tr } from '@/shared/i18n';
import { Button, Card, Notice } from '@/shared/ui/primitives';

type PushPublicKey = {
  available: boolean;
  publicKey: string | null;
  reason?: string | null;
};
type PushSubscriptionStatus = { registered: boolean };
type PushRegistrationStatus =
  'checking' | 'registered' | 'unregistered' | 'error';
type PushMessage = { kind: 'success' | 'error'; text: string } | null;

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

function decodePublicKey(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = atob(padded);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

export function BrowserPushSection({ user }: { user: User }) {
  const [permission, setPermission] = useState(permissionState);
  const [browserSubscription, setBrowserSubscription] =
    useState<PushSubscription | null>(null);
  const [registrationStatus, setRegistrationStatus] =
    useState<PushRegistrationStatus>('checking');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<PushMessage>(null);
  const publicKeyQuery = useQuery({
    queryKey: ['user', user.id, 'push-public-key'],
    queryFn: () => api<PushPublicKey>('/me/push-public-key'),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    const update = () => setPermission(permissionState());
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
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
                : tr('notifications:pushSetupCompleted', { reason });
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

  return (
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
  );
}
