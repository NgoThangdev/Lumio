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
import { CategoryInventoryDefaults } from './CategoryInventoryDefaults';

import { tr } from '../../shared/i18n';
import { localizedError } from '../../shared/i18n';
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
      <h2>
        {tr('common:shoppingDefaults')} {household.name}
      </h2>
      <p className="muted">{tr('settings:applyHouseholdS')}</p>
      {settings.isPending && (
        <p role="status">{tr('settings:loadingShoppingDefaults')}</p>
      )}
      {settings.isError && (
        <>
          <Notice kind="error">
            {tr('common:shoppingDefaultsLoaded')}{' '}
            {localizedError(settings.error)}
          </Notice>
          <Button variant="secondary" onClick={() => void settings.refetch()}>
            {tr('common:retryDefaults')}
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
              {tr('settings:shoppingCycleEvery')}{' '}
              {settings.data.defaultShoppingCycleDays} {tr('settings:days')}
            </p>
            <p>
              {tr('settings:defaultStore2')}{' '}
              {settings.data.defaultStore ?? tr('settings:noneSet')}
            </p>
            <p className="muted">{tr('settings:onlyHouseholdAdmin2')}</p>
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
      setRefreshWarning(tr('settings:shoppingDefaultsRefreshWarning'));
    } catch (cause) {
      setError(
        cause instanceof OfflineBeforeSendError
          ? localizedError(cause)
          : cause instanceof MutationOutcomeUnknownError
            ? tr('settings:shoppingDefaultsSaveUncertain')
            : cause instanceof ApiError
              ? `Defaults were not saved: ${localizedError(cause)}`
              : cause instanceof Error
                ? localizedError(cause)
                : tr('settings:shoppingDefaultsSaveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-stack">
      {saved && (
        <Notice kind="success">{tr('settings:shoppingDefaultsSaved')}</Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {refreshWarning && <Notice kind="error">{refreshWarning}</Notice>}
      <label>
        {tr('settings:daysUntilNext')}
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
        {tr('settings:defaultStore')}
        <input
          value={store}
          maxLength={120}
          placeholder={tr('settings:noDefaultStore')}
          disabled={busy}
          onChange={(event) => {
            setSaved(false);
            setStore(event.target.value);
          }}
        />
      </label>
      <p className="muted">{tr('settings:clearStoreField')}</p>
      <Button disabled={busy} onClick={() => void save()}>
        {busy ? tr('common:saving') : tr('settings:saveShoppingDefaults')}
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
      {households.isPending && (
        <p role="status">{tr('common:loadingHouseholds')}</p>
      )}
      {households.isError && (
        <>
          <Notice kind="error">
            {tr('settings:householdsLoaded')} {localizedError(households.error)}
          </Notice>
          <Button variant="secondary" onClick={() => void households.refetch()}>
            {tr('settings:retryHouseholds')}
          </Button>
        </>
      )}
      {households.data?.length === 0 && (
        <p className="muted">{tr('settings:joinCreateHousehold')}</p>
      )}
      {households.data && households.data.length > 0 && (
        <>
          <label>
            {tr('settings:householdShoppingSettings')}
            <select
              value={selected?.id ?? ''}
              onChange={(event) => chooseHousehold(event.target.value)}
            >
              <option value="">{tr('common:chooseHousehold')}</option>
              {households.data.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          {requestedId && !selected && (
            <Notice kind="error">
              {tr('settings:householdAvailableAccount')}
            </Notice>
          )}
          {!requestedId && (
            <p className="muted">{tr('settings:chooseHouseholdView')}</p>
          )}
          {selected && (
            <>
              <p>
                <strong>
                  {tr('settings:householdSettings2')} {selected.name}
                </strong>{' '}
                ·{' '}
                {selected.role === 'ADMIN'
                  ? tr('common:admin')
                  : tr('settings:memberViewOnly')}
              </p>
              <SettingsForHousehold key={selected.id} household={selected} />
              <details className="settings-disclosure">
                <summary>{tr('settings:manageCatalogCategory')}</summary>
                <div className="settings-disclosure-content">
                  <p className="muted">{tr('settings:renameRemoveCatalog')}</p>
                  <CatalogManagement
                    key={`${selected.id}-catalog`}
                    household={selected}
                  />
                  <CategorySectionSettings
                    key={`${selected.id}-sections`}
                    household={selected}
                  />
                  <CategoryInventoryDefaults household={selected} />
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
