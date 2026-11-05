import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, MutationOutcomeUnknownError } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { Household } from '@/shared/api/types';
import { localizedError, tr } from '@/shared/i18n';
import { Button, Notice } from '@/shared/ui/primitives';

export function HouseholdNameEditor({ household }: { household: Household }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(household.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save() {
    const next = name.trim();
    if (busy || !next || next.length > 120 || next === household.name) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const renamed = await api<{ id: string; name: string }>(
        `/households/${household.id}`,
        'PATCH',
        { name: next },
      );
      queryClient.setQueryData<Household[]>(keys.households, (current) =>
        current?.map((entry) =>
          entry.id === renamed.id ? { ...entry, name: renamed.name } : entry,
        ),
      );
      setName(renamed.name);
      setMessage(tr('settings:householdNameSaved'));
      void queryClient.invalidateQueries({ queryKey: keys.households });
    } catch (cause) {
      setError(
        cause instanceof MutationOutcomeUnknownError
          ? tr('settings:householdNameUncertain')
          : localizedError(cause),
      );
      if (cause instanceof MutationOutcomeUnknownError)
        void queryClient.invalidateQueries({ queryKey: keys.households });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-stack">
      <label>
        {tr('common:householdName')}
        <input
          value={name}
          maxLength={120}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            setMessage('');
          }}
        />
      </label>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <Button
        disabled={busy || !name.trim() || name.trim() === household.name}
        onClick={() => void save()}
      >
        {busy ? tr('common:saving') : tr('settings:saveHouseholdName')}
      </Button>
    </div>
  );
}
