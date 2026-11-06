import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { INVENTORY_QUICK_FILTERS } from './inventoryFilterOptions';

export function useInventoryFilters() {
  const [urlParams, setUrlParams] = useSearchParams();
  const [search, setSearch] = useState(() => urlParams.get('q') ?? '');
  const [status, setStatus] = useState(() => urlParams.get('status') ?? 'ALL');
  const [groupBy, setGroupBy] = useState(
    () => urlParams.get('groupBy') ?? 'location',
  );
  const [categoryId, setCategoryId] = useState(
    () => urlParams.get('categoryId') ?? '',
  );
  const [tagId, setTagId] = useState(() => urlParams.get('tagId') ?? '');
  const locationId = urlParams.get('locationId') ?? '';

  function setInventoryParam(name: string, value: string, fallback: string) {
    setUrlParams((current) => {
      const next = new URLSearchParams(current);
      if (value && value !== fallback) next.set(name, value);
      else next.delete(name);
      return next;
    });
  }

  function setLocationId(nextId: string) {
    setUrlParams((current) => {
      const next = new URLSearchParams(current);
      if (nextId) next.set('locationId', nextId);
      else next.delete('locationId');
      return next;
    });
  }

  const params = new URLSearchParams({ groupBy, status });
  if (search.trim()) params.set('q', search.trim());
  if (categoryId) params.set('categoryId', categoryId);
  if (locationId) params.set('locationId', locationId);
  if (tagId) params.set('tagId', tagId);

  const hasFilters =
    !!search.trim() ||
    status !== 'ALL' ||
    !!categoryId ||
    !!locationId ||
    !!tagId;
  const hasAdvancedFilters =
    !INVENTORY_QUICK_FILTERS.some((filter) => filter.value === status) ||
    !!categoryId ||
    !!locationId ||
    !!tagId ||
    groupBy !== 'location';

  return {
    search,
    setSearch,
    status,
    setStatus,
    groupBy,
    setGroupBy,
    categoryId,
    setCategoryId,
    locationId,
    setLocationId,
    tagId,
    setTagId,
    setInventoryParam,
    query: params.toString(),
    hasFilters,
    hasAdvancedFilters,
  };
}
