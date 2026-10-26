import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { Household } from '@/shared/api/types';
import { localizedError, tr } from '@/shared/i18n';
import { Button, Notice } from '@/shared/ui/primitives';
import { CatalogManagement } from './CatalogManagement';
import { CategoryInventoryDefaults } from './CategoryInventoryDefaults';
import { CategorySectionSettings } from './CategorySectionSettings';
import { HouseholdShoppingDefaults } from './HouseholdShoppingDefaults';

export function HouseholdSettingsSection() {
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
    <section id="household-settings" className="settings-scope">
      <div className="settings-scope-heading">
        <p className="eyebrow">{tr('settings:householdSpecific')}</p>
        <h2>{tr('settings:householdSettings')}</h2>
      </div>
      <div className="household-shopping-settings">
        {households.isPending && (
          <p role="status">{tr('common:loadingHouseholds')}</p>
        )}
        {households.isError && (
          <>
            <Notice kind="error">
              {tr('settings:householdsLoaded')}{' '}
              {localizedError(households.error)}
            </Notice>
            <Button
              variant="secondary"
              onClick={() => void households.refetch()}
            >
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
                <HouseholdShoppingDefaults
                  key={selected.id}
                  household={selected}
                />
                <details className="settings-disclosure">
                  <summary>{tr('settings:manageCatalogCategory')}</summary>
                  <div className="settings-disclosure-content">
                    <p className="muted">
                      {tr('settings:renameRemoveCatalog')}
                    </p>
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
      </div>
    </section>
  );
}
