import { useEffect, useState } from 'react';
import { tr } from '@/shared/i18n';
import { Card } from '@/shared/ui/primitives';

type OfflineShellState = 'checking' | 'ready' | 'unsupported' | 'unavailable';

export function OfflineAppSection() {
  const [offlineShellError, setOfflineShellError] = useState('');
  const [offlineShell, setOfflineShell] = useState<OfflineShellState>(
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? 'checking'
      : 'unsupported',
  );

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

  return (
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
  );
}
