import { useEffect, useState } from 'react';
import { tr } from '@/shared/i18n';

export function NetworkStatus() {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online ? null : (
    <div className="offline-banner" role="status">
      {tr('common:reOfflineLive')}
    </div>
  );
}
