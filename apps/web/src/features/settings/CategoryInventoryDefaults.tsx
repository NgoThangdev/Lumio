import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  CategoryOption,
  Household,
  TrackingMode,
} from '../../shared/api/types';
import { localizedEnum, localizedError, tr } from '../../shared/i18n';
import { Button, Card, Notice } from '../../shared/ui/primitives';

type DefaultChange =
  | { defaultTrackingMode: TrackingMode | null }
  | { defaultPrimaryUnit: string | null };

function DefaultRow({
  category,
  canEdit,
  busy,
  onSave,
}: {
  category: CategoryOption;
  canEdit: boolean;
  busy: boolean;
  onSave: (change: DefaultChange) => void;
}) {
  const [unit, setUnit] = useState(category.defaultPrimaryUnit ?? '');

  function saveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unit.trim() && unit.trim() !== category.defaultPrimaryUnit) {
      onSave({ defaultPrimaryUnit: unit.trim() });
    }
  }

  return (
    <div className="category-section-row field-stack">
      <h3>{category.name}</h3>
      {canEdit ? (
        <>
          <label>
            {tr('settings:defaultTrackingMode')}
            <select
              value={category.defaultTrackingMode ?? ''}
              disabled={busy}
              onChange={(event) =>
                onSave({
                  defaultTrackingMode: (event.target.value ||
                    null) as TrackingMode | null,
                })
              }
            >
              <option value="">{tr('settings:noModeDefault')}</option>
              <option value="QUANTITY">{localizedEnum('QUANTITY')}</option>
              <option value="FIVE_LEVEL">{localizedEnum('FIVE_LEVEL')}</option>
              <option value="PRESENCE_BACKUP">
                {localizedEnum('PRESENCE_BACKUP')}
              </option>
            </select>
          </label>
          <form className="field-stack" onSubmit={saveUnit}>
            <label>
              {tr('settings:defaultPrimaryUnit')}
              <input
                value={unit}
                maxLength={40}
                disabled={busy}
                onChange={(event) => setUnit(event.target.value)}
                placeholder={tr('settings:noUnitDefault')}
              />
            </label>
            <div className="form-actions">
              <Button
                type="submit"
                variant="secondary"
                disabled={
                  busy ||
                  !unit.trim() ||
                  unit.trim() === category.defaultPrimaryUnit
                }
              >
                {tr('settings:saveUnitDefault')}
              </Button>
              {category.defaultPrimaryUnit !== null && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onSave({ defaultPrimaryUnit: null })}
                >
                  {tr('settings:clearUnitDefault')}
                </Button>
              )}
            </div>
          </form>
        </>
      ) : (
        <p className="muted">
          {tr('settings:defaultTrackingMode')}:{' '}
          {category.defaultTrackingMode
            ? localizedEnum(category.defaultTrackingMode)
            : tr('settings:noneSet')}
          <br />
          {tr('settings:defaultPrimaryUnit')}:{' '}
          {category.defaultPrimaryUnit ?? tr('settings:noneSet')}
        </p>
      )}
    </div>
  );
}

export function CategoryInventoryDefaults({
  household,
}: {
  household: Household;
}) {
  const queryClient = useQueryClient();
  const catalogKey = keys.catalog(household.id, 'categories');
  const categories = useQuery({
    queryKey: catalogKey,
    queryFn: () =>
      api<CategoryOption[]>(`/households/${household.id}/categories`),
  });
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function save(category: CategoryOption, change: DefaultChange) {
    if (busyId || household.role !== 'ADMIN') return;
    setBusyId(category.id);
    setNotice('');
    setError('');
    try {
      const saved = await api<CategoryOption>(
        `/households/${household.id}/categories/${category.id}/inventory-defaults`,
        'PATCH',
        change,
      );
      queryClient.setQueryData<CategoryOption[]>(catalogKey, (current) =>
        current?.map((entry) => (entry.id === saved.id ? saved : entry)),
      );
      setNotice(tr('settings:inventoryDefaultSaved', { name: saved.name }));
      try {
        await queryClient.invalidateQueries(
          { queryKey: catalogKey, exact: true, refetchType: 'all' },
          { throwOnError: true },
        );
      } catch {
        setError(tr('settings:catalogSavedRefreshWarning'));
      }
    } catch (cause) {
      setError(
        cause instanceof OfflineBeforeSendError
          ? localizedError(cause)
          : isMutationOutcomeUnknown(cause)
            ? tr('settings:catalogChangeResult')
            : tr('settings:inventoryDefaultRejected', {
                name: category.name,
                error: localizedError(cause),
              }),
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <Card>
      <h2>{tr('settings:inventoryDefaults')}</h2>
      <p className="muted">{tr('settings:inventoryDefaultsHint')}</p>
      {categories.isPending && (
        <p role="status">{tr('common:loadingCategories')}</p>
      )}
      {categories.isError && (
        <>
          <Notice kind="error">{localizedError(categories.error)}</Notice>
          <Button variant="secondary" onClick={() => void categories.refetch()}>
            {tr('settings:retryCategories')}
          </Button>
        </>
      )}
      {categories.data?.length === 0 && (
        <p className="muted">{tr('settings:categoriesYet')}</p>
      )}
      {notice && <Notice kind="success">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {categories.data?.map((category) => (
        <DefaultRow
          key={`${category.id}-${category.defaultPrimaryUnit ?? ''}`}
          category={category}
          canEdit={household.role === 'ADMIN'}
          busy={!!busyId}
          onSave={(change) => void save(category, change)}
        />
      ))}
    </Card>
  );
}
