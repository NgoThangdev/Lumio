import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { User } from '@/shared/api/types';
import { Button, Notice } from '@/shared/ui/primitives';
import { localizedError, tr } from '@/shared/i18n';
import { AppRoutes } from './AppRoutes';
import { setSession } from './sessionCache';

type RecoveryStage = 'waking' | 'checking' | 'retrying';
type RecoveryFailure = 'unconfigured' | 'paused' | 'timed-out';

class SessionRecoveryError extends Error {
  readonly reason: RecoveryFailure;

  constructor(reason: RecoveryFailure) {
    super(reason);
    this.name = 'SessionRecoveryError';
    this.reason = reason;
  }
}

const readinessDelays = [1_000, 2_000, 4_000, 8_000, 12_000, 15_000];
const readinessLimitMs = 3 * 60_000;
const strictModeOverlapMs = 1_000;
let recentWakeRequest: { url: string; startedAt: number } | null = null;

function renderWakeUrl() {
  const configured = import.meta.env.VITE_RENDER_WAKE_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function pausedReason() {
  if (!navigator.onLine || document.visibilityState === 'hidden')
    return new SessionRecoveryError('paused');
  return null;
}

function reasonForAbort(signal: AbortSignal): Error {
  if (signal.reason instanceof SessionRecoveryError) return signal.reason;
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Session recovery was cancelled.', 'AbortError');
}

function createRecoverySignal(parent: AbortSignal) {
  const controller = new AbortController();
  const stopForEnvironment = () => {
    const reason = pausedReason();
    if (reason) controller.abort(reason);
  };
  const stopForParent = () =>
    controller.abort(
      parent.reason ??
        new DOMException('Session check was cancelled.', 'AbortError'),
    );

  if (parent.aborted) stopForParent();
  else parent.addEventListener('abort', stopForParent, { once: true });
  window.addEventListener('offline', stopForEnvironment);
  document.addEventListener('visibilitychange', stopForEnvironment);
  stopForEnvironment();

  return {
    signal: controller.signal,
    dispose() {
      parent.removeEventListener('abort', stopForParent);
      window.removeEventListener('offline', stopForEnvironment);
      document.removeEventListener('visibilitychange', stopForEnvironment);
    },
  };
}

async function withTimeout<T>(
  parent: AbortSignal,
  timeoutMs: number,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(parent.reason);
  if (parent.aborted) forwardAbort();
  else parent.addEventListener('abort', forwardAbort, { once: true });
  const timeout = window.setTimeout(
    () =>
      controller.abort(new DOMException('Request timed out.', 'TimeoutError')),
    timeoutMs,
  );

  try {
    return await action(controller.signal);
  } finally {
    window.clearTimeout(timeout);
    parent.removeEventListener('abort', forwardAbort);
  }
}

function waitFor(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(reasonForAbort(signal));
      return;
    }
    const timeout = window.setTimeout(finish, delayMs);
    function finish() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(reasonForAbort(signal));
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function checkSession(signal: AbortSignal) {
  try {
    return await api<User>('/auth/me', 'GET', undefined, { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

async function probeReadiness(signal: AbortSignal, timeoutMs: number) {
  await withTimeout(signal, timeoutMs, (requestSignal) =>
    api<{ status: 'ok' }>('/ready', 'GET', undefined, {
      signal: requestSignal,
    }),
  );
}

function isRenderHibernateLimit(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 429) return false;
  const routing = error.responseHeaders['x-render-routing'];
  return routing === 'hibernate-rate-limited';
}

async function recoverSession(
  parentSignal: AbortSignal,
  setStage: (stage: RecoveryStage | null) => void,
) {
  const wakeUrl = renderWakeUrl();
  if (!wakeUrl) throw new SessionRecoveryError('unconfigured');

  const recovery = createRecoverySignal(parentSignal);
  const { signal } = recovery;
  if (signal.aborted) {
    recovery.dispose();
    throw reasonForAbort(signal);
  }
  const initialPause = pausedReason();
  if (initialPause) {
    recovery.dispose();
    throw initialPause;
  }

  let wakeStartedAt: number | null = null;
  try {
    const now = Date.now();
    const wakeAlreadySent =
      recentWakeRequest?.url === wakeUrl &&
      now - recentWakeRequest.startedAt < strictModeOverlapMs;
    if (!wakeAlreadySent) {
      if (signal.aborted) throw reasonForAbort(signal);
      recentWakeRequest = { url: wakeUrl, startedAt: now };
      wakeStartedAt = now;
      setStage('waking');
      try {
        await withTimeout(signal, 10_000, (requestSignal) =>
          fetch(wakeUrl, {
            method: 'GET',
            mode: 'no-cors',
            credentials: 'omit',
            cache: 'no-store',
            signal: requestSignal,
          }),
        );
        // no-cors returns an opaque response; resolution does not establish readiness.
      } catch {
        if (signal.aborted) throw reasonForAbort(signal);
        // Continue with readiness checks; this recovery attempt never repeats the wake request.
      }
    }

    setStage('checking');
    const deadline = Date.now() + readinessLimitMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      if (signal.aborted) throw reasonForAbort(signal);
      const remaining = deadline - Date.now();
      let ready = false;
      try {
        await probeReadiness(signal, Math.min(10_000, remaining));
        ready = true;
      } catch {
        if (signal.aborted) throw reasonForAbort(signal);
      }

      if (ready) {
        if (signal.aborted) throw reasonForAbort(signal);
        setStage('retrying');
        return await checkSession(signal);
      }

      const delayMs =
        readinessDelays[Math.min(attempt, readinessDelays.length - 1)];
      attempt += 1;
      if (Date.now() + delayMs >= deadline) break;
      await waitFor(delayMs, signal);
    }

    throw new SessionRecoveryError('timed-out');
  } finally {
    // Retain the short overlap guard only when StrictMode cancelled a query.
    // A completed or failed attempt must allow Retry to send a fresh wake.
    if (
      !signal.aborted &&
      recentWakeRequest?.url === wakeUrl &&
      recentWakeRequest.startedAt === wakeStartedAt
    )
      recentWakeRequest = null;
    recovery.dispose();
  }
}

function recoveryMessage(error: unknown) {
  if (!(error instanceof SessionRecoveryError)) return localizedError(error);
  switch (error.reason) {
    case 'unconfigured':
      return tr('common:sessionRecoveryUnavailable');
    case 'paused':
      return tr('common:sessionRecoveryPaused');
    case 'timed-out':
      return tr('common:sessionRecoveryTimedOut');
  }
}

export function SessionBoundary() {
  const queryClient = useQueryClient();
  const [recoveryStage, setRecoveryStage] = useState<RecoveryStage | null>(
    null,
  );
  const session = useQuery({
    queryKey: keys.session,
    queryFn: async ({ signal }) => {
      setRecoveryStage(null);
      try {
        return await checkSession(signal);
      } catch (error) {
        if (!isRenderHibernateLimit(error)) throw error;
        try {
          const user = await recoverSession(signal, setRecoveryStage);
          setRecoveryStage(null);
          return user;
        } catch (recoveryError) {
          if (
            recoveryError instanceof ApiError &&
            recoveryError.status === 401
          ) {
            setRecoveryStage(null);
            return null;
          }
          if (!signal.aborted) setRecoveryStage(null);
          throw recoveryError;
        }
      }
    },
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    const expire = () => {
      setSession(queryClient, null);
    };
    window.addEventListener('lumio:session-expired', expire);
    return () => window.removeEventListener('lumio:session-expired', expire);
  }, [queryClient]);

  if (session.isPending || recoveryStage)
    return (
      <main className="loading">
        <p role="status" aria-live="polite">
          {recoveryStage === 'waking'
            ? tr('common:sessionServiceWaking')
            : recoveryStage === 'checking'
              ? tr('common:sessionServiceChecking')
              : recoveryStage === 'retrying'
                ? tr('common:sessionCheckRetrying')
                : tr('common:checkingSession')}
        </p>
      </main>
    );
  if (session.isError)
    return (
      <main className="loading">
        <Notice kind="error">{recoveryMessage(session.error)}</Notice>
        <Button
          disabled={session.isFetching}
          onClick={() => void session.refetch()}
        >
          {tr('common:retrySessionCheck')}
        </Button>
      </main>
    );

  return (
    <AppRoutes
      user={session.data}
      onSessionChange={(user) => setSession(queryClient, user)}
    />
  );
}
