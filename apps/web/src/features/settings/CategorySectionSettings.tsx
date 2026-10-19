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
        `${saved.name} now appears under ${shoppingSections.find((section) => section.code === (saved.shoppingSection ?? 'OTHER'))?.label ?? 'Other'}.`,
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
        setError(
          'The mapping was saved, but category or trip details could not refresh. Reload to check the current sections.',
        );
      }
    } catch (cause) {
      setError(
        cause instanceof OfflineBeforeSendError
          ? cause.message
          : isMutationOutcomeUnknown(cause)
            ? 'The mapping result is uncertain. Reload the category list before choosing to retry.'
            : cause instanceof ApiError
              ? `Mapping was not saved: ${cause.message}`
              : cause instanceof Error
                ? cause.message
                : 'Mapping could not be saved.',
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <Card>
      <h2>Shopping sections for {household.name}</h2>
      <p className="muted">
        Sections organize trip checklists. Existing purchase amounts and saved
        suggestions stay the same.
      </p>
      {categories.isPending && <p role="status">Loading categories…</p>}
      {categories.isError && (
        <>
          <Notice kind="error">
            Categories could not be loaded: {categories.error.message}
          </Notice>
          <Button variant="secondary" onClick={() => void categories.refetch()}>
            Retry categories
          </Button>
        </>
      )}
      {categories.data?.length === 0 && (
        <p className="muted">No categories yet.</p>
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
                <option value="">Other (no mapping)</option>
                {shoppingSections
                  .filter((section) => section.code !== 'OTHER')
                  .map((section) => (
                    <option key={section.code} value={section.code}>
                      {section.label}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <p>
              <strong>{category.name}</strong> ·{' '}
              {shoppingSections.find(
                (section) =>
                  section.code === (category.shoppingSection ?? 'OTHER'),
              )?.label ?? 'Other'}
            </p>
          )}
        </div>
      ))}
      {household.role !== 'ADMIN' && categories.data?.length ? (
        <p className="muted">
          Only a household Admin can change category sections.
        </p>
      ) : null}
    </Card>
  );
}
