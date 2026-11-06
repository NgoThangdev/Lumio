import { useState } from 'react';
import { localizedError, tr } from '@/shared/i18n';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import { ControlIcon } from '@/shared/ui/ControlIcon';

export function SignOutSection({
  onSignOut,
}: {
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    setError('');
    setBusy(true);
    try {
      await onSignOut();
    } catch (cause) {
      setError(localizedError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="settings-signout">
      <h2>{tr('common:account')}</h2>
      {error && <Notice kind="error">{error}</Notice>}
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => void signOut()}
      >
        <ControlIcon name="logout" />
        {busy ? tr('common:updating') : tr('common:signOut')}
      </Button>
    </Card>
  );
}
