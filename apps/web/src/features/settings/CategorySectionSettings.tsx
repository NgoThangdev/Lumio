import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { Household } from '../../shared/api/types';
import {
  shoppingSections,
  type CategoryShoppingSection,
} from '../../shared/shoppingSections';
import { Button, Card, Notice } from '../../shared/ui/primitives';

import { tr } from '../../shared/i18n';
import { localizedError, localizedEnum } from '../../shared/i18n';
type Category = {
  id: string;
  name: string;
  shoppingSection: CategoryShoppingSection | null;
};

export function CategorySectionSettings({
  household,
}: {
  household: Household;
}) {
  const queryClient = useQueryClient();
  const categoryKey = keys.catalog(household.id, 'categories');
  const categories = useQuery({
    queryKey: categoryKey,
    queryFn: () => api<Category[]>(`/households/${household.id}/categories`),
  });
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function save(
    category: Category,
    shoppingSection: CategoryShoppingSection | null,
  ) {
    if (busyId || category.shoppingSection === shoppingSection) return;
    setBusyId(category.id);
    setError('');
    setNotice('');
    try {
      const saved = await api<Category>(
        `/households/${household.id}/categories/${category.id}`,
        'PATCH',
        { shoppingSection },
      );
      queryClient.setQueryData<Category[]>(categoryKey, (current) =>
        current?.map((entry) => (entry.id === saved.id ? saved : entry)),
      );
      setNotice(
        tr('settings:nowAppearsUnder', {
          name: saved.name,
          section: localizedEnum(saved.shoppingSection ?? 'OTHER'),
        }),
      );
      const refreshes = await Promise.allSettled([
        queryClient.invalidateQueries(
          { queryKey: categoryKey, exact: true, refetchType: 'all' },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: ['household', household.id, 'trip'], refetchType: 'all' },
          { throwOnError: true },
        ),
      ]);
      if (refreshes.some((result) => result.status === 'rejected')) {
        setError(tr('settings:sectionSavedRefreshWarning'));
      }
    } catch (cause) {
      setError(
        cause instanceof OfflineBeforeSendError
          ? localizedError(cause)
          : isMutationOutcomeUnknown(cause)
            ? tr('settings:sectionSaveUncertain')
            : cause instanceof ApiError
              ? `Mapping was not saved: ${localizedError(cause)}`
              : cause instanceof Error
                ? localizedError(cause)
                : tr('settings:mappingSaveFailed'),
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <Card>
      <h2>
        {tr('settings:shoppingSections')} {household.name}
      </h2>
      <p className="muted">{tr('settings:sectionsOrganizeTrip')}</p>
      {categories.isPending && (
        <p role="status">{tr('common:loadingCategories')}</p>
      )}
      {categories.isError && (
        <>
          <Notice kind="error">
            {tr('common:categoriesLoaded')} {localizedError(categories.error)}
          </Notice>
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
        <div className="category-section-row" key={category.id}>
          {household.role === 'ADMIN' ? (
            <label>
              {category.name}
              <select
                value={category.shoppingSection ?? ''}
                disabled={!!busyId}
                onChange={(event) =>
                  void save(
                    category,
                    (event.target.value ||
                      null) as CategoryShoppingSection | null,
                  )
                }
              >
                <option value="">{tr('settings:otherMapping')}</option>
                {shoppingSections
                  .filter((section) => section.code !== 'OTHER')
                  .map((section) => (
                    <option key={section.code} value={section.code}>
                      {localizedEnum(section.code)}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <p>
              <strong>{category.name}</strong> ·{' '}
              {localizedEnum(category.shoppingSection ?? 'OTHER')}
            </p>
          )}
        </div>
      ))}
      {household.role !== 'ADMIN' && categories.data?.length ? (
        <p className="muted">{tr('common:onlyHouseholdAdmin')}</p>
      ) : null}
    </Card>
  );
}
