import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  api,
  ApiError,
  MutationOutcomeUnknownError,
  OfflineBeforeSendError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  Household,
  HouseholdShoppingSettings as ShoppingSettings,
} from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';
import { CategorySectionSettings } from './CategorySectionSettings';
import { CatalogManagement } from './CatalogManagement';

function SettingsForHousehold({ household }: { household: Household }) {
  const queryClient = useQueryClient();
  const settingsKey = keys.shoppingSettings(household.id);
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () =>
      api<ShoppingSettings>(`/households/${household.id}/shopping-settings`),
  });

  return (
    <Card>
      <h2>Shopping defaults for {household.name}</h2>
      <p className="muted">
        These apply to this household's new trips. Existing trips and imported
        suggestions keep their saved values.
      </p>
      {settings.isPending && <p role="status">Loading shopping defaults…</p>}
      {settings.isError && (
        <>
          <Notice kind="error">
            Shopping defaults could not be loaded: {settings.error.message}
          </Notice>
          <Button variant="secondary" onClick={() => void settings.refetch()}>
            Retry defaults
          </Button>
        </>
      )}
      {settings.data &&
        (household.role === 'ADMIN' ? (
          <ShoppingSettingsEditor
            household={household}
            initial={settings.data}
            onSaved={async (result) => {
              queryClient.setQueryData(settingsKey, result);
              const results = await Promise.allSettled([
                queryClient.invalidateQueries(
                  { queryKey: settingsKey, exact: true, refetchType: 'active' },
                  { throwOnError: true },
                ),
                queryClient.invalidateQueries(
                  { queryKey: ['household', household.id, 'intelligence'] },
                  { throwOnError: true },
                ),
              ]);
              return results.every((entry) => entry.status === 'fulfilled');
            }}
          />
        ) : (
          <>
            <p>
              Shopping cycle: every {settings.data.defaultShoppingCycleDays}{' '}
              days
            </p>
            <p>Default store: {settings.data.defaultStore ?? 'None set'}</p>
            <p className="muted">
              Only a household Admin can change these defaults.
            </p>
          </>
        ))}
    </Card>
  );
}

function ShoppingSettingsEditor({
  household,
  initial,
  onSaved,
}: {
  household: Household;
  initial: ShoppingSettings;
  onSaved: (result: ShoppingSettings) => Promise<boolean>;
}) {
  const [cycle, setCycle] = useState(String(initial.defaultShoppingCycleDays));
  const [store, setStore] = useState(initial.defaultStore ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');

  async function save() {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    setError('');
    setRefreshWarning('');
    try {
      const result = await api<ShoppingSettings>(
        `/households/${household.id}/shopping-settings`,
        'PATCH',
        {
          defaultShoppingCycleDays: Number(cycle),
          defaultStore: store.trim() || null,
        },
      );
      setCycle(String(result.defaultShoppingCycleDays));
      setStore(result.defaultStore ?? '');
      setSaved(true);
      try {
        if (await onSaved(result)) return;
      } catch {
        // The PATCH succeeded; a failed readback does not undo the saved values.
      }
      setRefreshWarning(
        'Defaults were saved, but current assessments could not refresh. Reload to check them.',
      );
    } catch (cause) {
      setError(
        cause instanceof OfflineBeforeSendError
          ? cause.message
          : cause instanceof MutationOutcomeUnknownError
            ? 'The save result is uncertain. Reload these defaults before choosing to retry.'
            : cause instanceof ApiError
              ? `Defaults were not saved: ${cause.message}`
              : cause instanceof Error
                ? cause.message
                : 'Defaults could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-stack">
      {saved && <Notice kind="success">Shopping defaults saved.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {refreshWarning && <Notice kind="error">{refreshWarning}</Notice>}
      <label>
        Days until the next shopping trip
        <input
          type="number"
          min="1"
          max="30"
          step="1"
          value={cycle}
          disabled={busy}
          onChange={(event) => {
            setSaved(false);
            setCycle(event.target.value);
          }}
        />
      </label>
      <label>
        Default store
        <input
          value={store}
          maxLength={120}
          placeholder="No default store"
          disabled={busy}
          onChange={(event) => {
            setSaved(false);
            setStore(event.target.value);
          }}
        />
      </label>
      <p className="muted">
        Clear the store field and save to remove its default.
      </p>
      <Button disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save shopping defaults'}
      </Button>
    </div>
  );
}

export function HouseholdShoppingSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const households = useQuery({
    queryKey: keys.households,
    queryFn: () => api<Household[]>('/households'),
  });
  const requestedId = searchParams.get('householdId');
  const selected = households.data?.find((entry) => entry.id === requestedId);

  function chooseHousehold(householdId: string) {
    const next = new URLSearchParams(searchParams);
    if (householdId) next.set('householdId', householdId);
    else next.delete('householdId');
    setSearchParams(next, { replace: true });
  }

  return (
    <section className="household-shopping-settings">
      {households.isPending && <p role="status">Loading households…</p>}
      {households.isError && (
        <>
          <Notice kind="error">
            Households could not be loaded: {households.error.message}
          </Notice>
          <Button variant="secondary" onClick={() => void households.refetch()}>
            Retry households
          </Button>
        </>
      )}
      {households.data?.length === 0 && (
        <p className="muted">
          Join or create a household to see shopping defaults.
        </p>
      )}
      {households.data && households.data.length > 0 && (
        <>
          <label>
            Household for shopping settings
            <select
              value={selected?.id ?? ''}
              onChange={(event) => chooseHousehold(event.target.value)}
            >
              <option value="">Choose a household</option>
              {households.data.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          {requestedId && !selected && (
            <Notice kind="error">
              This household is not available to your account. Choose a
              household you belong to before editing its settings.
            </Notice>
          )}
          {!requestedId && (
            <p className="muted">
              Choose a household to view its shopping defaults and catalog.
            </p>
          )}
          {selected && (
            <>
              <p>
                <strong>Household settings for {selected.name}</strong> ·{' '}
                {selected.role === 'ADMIN' ? 'Admin' : 'Member, view only'}
              </p>
              <SettingsForHousehold key={selected.id} household={selected} />
              <details className="settings-disclosure">
                <summary>Manage catalog and category sections</summary>
                <div className="settings-disclosure-content">
                  <p className="muted">
                    Rename or remove catalog entries and choose how categories
                    are grouped in Shopping.
                  </p>
                  <CatalogManagement
                    key={`${selected.id}-catalog`}
                    household={selected}
                  />
                  <CategorySectionSettings
                    key={`${selected.id}-sections`}
                    household={selected}
                  />
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
