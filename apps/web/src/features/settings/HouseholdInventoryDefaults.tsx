import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { Household, TrackingMode } from '@/shared/api/types';
import { localizedEnum, localizedError, tr } from '@/shared/i18n';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import {
  InventoryDefaultNumberFields,
  type InventoryDefaultNumbers,
} from './InventoryDefaultNumberFields';

type Defaults = InventoryDefaultNumbers & {
  defaultTrackingMode: TrackingMode | null;
  defaultPrimaryUnit: string | null;
};

export function HouseholdInventoryDefaults({
  household,
}: {
  household: Household;
}) {
  const queryClient = useQueryClient();
  const key = ['household-inventory-defaults', household.id] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api<Defaults>(`/households/${household.id}/inventory-defaults`),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(change: Partial<Defaults>) {
    if (busy || household.role !== 'ADMIN') return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await api<Defaults>(
        `/households/${household.id}/inventory-defaults`,
        'PATCH',
        change,
      );
      queryClient.setQueryData(key, updated);
      setNotice(tr('settings:inventoryDefaultsSaved'));
      void queryClient.invalidateQueries({ queryKey: key });
    } catch (cause) {
      setError(localizedError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <h2>{tr('settings:householdInventoryDefaults')}</h2>
      <p className="muted">{tr('settings:inventoryDefaultsHint')}</p>
      {query.isPending && <p role="status">{tr('common:loadingHousehold')}</p>}
      {query.isError && (
        <Notice kind="error">{localizedError(query.error)}</Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {query.data && (
        <>
          {household.role === 'ADMIN' ? (
            <>
              <label>
                {tr('settings:defaultTrackingMode')}
                <select
                  value={query.data.defaultTrackingMode ?? ''}
                  disabled={busy}
                  onChange={(event) =>
                    void save({
                      defaultTrackingMode: (event.target.value ||
                        null) as TrackingMode | null,
                    })
                  }
                >
                  <option value="">{tr('settings:noModeDefault')}</option>
                  {(['QUANTITY', 'FIVE_LEVEL', 'PRESENCE_BACKUP'] as const).map(
                    (mode) => (
                      <option key={mode} value={mode}>
                        {localizedEnum(mode)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = (
                    event.currentTarget.elements.namedItem(
                      'unit',
                    ) as HTMLInputElement
                  ).value.trim();
                  void save({ defaultPrimaryUnit: value || null });
                }}
              >
                <label>
                  {tr('settings:defaultPrimaryUnit')}
                  <input
                    name="unit"
                    defaultValue={query.data.defaultPrimaryUnit ?? ''}
                    maxLength={40}
                    disabled={busy}
                  />
                </label>
                <Button type="submit" variant="secondary" disabled={busy}>
                  {tr('settings:saveUnitDefault')}
                </Button>
              </form>
            </>
          ) : (
            <p>
              {tr('settings:defaultTrackingMode')}:{' '}
              {query.data.defaultTrackingMode
                ? localizedEnum(query.data.defaultTrackingMode)
                : tr('settings:noneSet')}{' '}
              · {tr('settings:defaultPrimaryUnit')}:{' '}
              {query.data.defaultPrimaryUnit ?? tr('settings:noneSet')}
            </p>
          )}
          <InventoryDefaultNumberFields
            key={JSON.stringify(query.data)}
            values={query.data}
            canEdit={household.role === 'ADMIN'}
            busy={busy}
            household
            onSave={(values) => void save(values)}
          />
        </>
      )}
    </Card>
  );
}
