import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type {
  CatalogOption,
  CategoryOption,
  Household,
  Item,
  StockLevel,
  TrackingMode,
} from '@/shared/api/types';
import { tr } from '@/shared/i18n';

export type QuickPurchaseSeed = { name: string; quantity: string };

export function useAddItemForm({
  household,
  quickPurchaseSeed,
}: {
  household: Household;
  quickPurchaseSeed?: QuickPurchaseSeed;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(quickPurchaseSeed?.name ?? '');
  const [manualUnit, setManualUnit] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState<TrackingMode | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(quickPurchaseSeed?.quantity ?? '');
  const [expiry, setExpiry] = useState('');
  const [level, setLevel] = useState<StockLevel | ''>('');
  const [present, setPresent] = useState('');
  const [backupCount, setBackupCount] = useState(quickPurchaseSeed ? '' : '0');
  const base = `/households/${household.id}`;
  const categories = useQuery({
    queryKey: keys.catalog(household.id, 'categories'),
    queryFn: () => api<CategoryOption[]>(`${base}/categories`),
  });
  const selectedCategory = categories.data?.find(
    (entry) => entry.id === categoryId,
  );
  const mode: TrackingMode =
    manualMode ?? selectedCategory?.defaultTrackingMode ?? 'QUANTITY';
  const unit = manualUnit ?? selectedCategory?.defaultPrimaryUnit ?? '';
  const locations = useQuery({
    queryKey: keys.catalog(household.id, 'locations'),
    queryFn: () => api<CatalogOption[]>(`${base}/locations`),
  });
  const tags = useQuery({
    queryKey: keys.catalog(household.id, 'tags'),
    queryFn: () => api<CatalogOption[]>(`${base}/tags`),
  });
  const create = useMutation({
    mutationFn: () => {
      const initialStock =
        mode === 'QUANTITY'
          ? {
              quantity,
              ...(expiry && quantity !== '0' ? { expiryDate: expiry } : {}),
            }
          : mode === 'FIVE_LEVEL'
            ? { level, backupCount: Number(backupCount) }
            : { present: present === 'true', backupCount: Number(backupCount) };
      return api<Item>(`${base}/items`, 'POST', {
        name,
        primaryUnit: unit,
        trackingMode: mode,
        categoryId,
        locationId,
        ...(tagIds.length ? { tagIds } : {}),
        initialStock,
      });
    },
    onSuccess: async (created) => {
      const refreshes = await Promise.allSettled([
        queryClient.invalidateQueries(
          { queryKey: keys.items(household.id), refetchType: 'all' },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          {
            queryKey: keys.intelligencePrefix(household.id),
            refetchType: 'all',
          },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: keys.needsAttention(household.id), refetchType: 'all' },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: keys.recentActivity(household.id), refetchType: 'all' },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          {
            queryKey: keys.catalog(household.id, 'categories'),
            refetchType: 'all',
          },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          {
            queryKey: keys.catalog(household.id, 'locations'),
            refetchType: 'all',
          },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: keys.catalog(household.id, 'tags'), refetchType: 'all' },
          { throwOnError: true },
        ),
      ]);
      const refreshWarning = refreshes.some(
        (result) => result.status === 'rejected',
      )
        ? tr('inventory:itemCreatedRefreshWarning')
        : '';
      void navigate(`${base}/inventory/${created.id}`, {
        state: { notice: `Item created.${refreshWarning}` },
      });
    },
  });
  const quickQuantityValid =
    !quickPurchaseSeed ||
    mode !== 'QUANTITY' ||
    (/^\d+(?:\.\d{1,6})?$/.test(quantity) && Number(quantity) > 0);
  const canSubmit =
    !!categoryId &&
    !!locationId &&
    !categories.isPending &&
    !locations.isPending &&
    !categories.isError &&
    !locations.isError &&
    !create.isPending &&
    quickQuantityValid;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) create.mutate();
  }

  return {
    name,
    setName,
    manualMode,
    setManualMode,
    mode,
    unit,
    setManualUnit,
    categoryId,
    setCategoryId,
    locationId,
    setLocationId,
    tagIds,
    setTagIds,
    quantity,
    setQuantity,
    expiry,
    setExpiry,
    level,
    setLevel,
    present,
    setPresent,
    backupCount,
    setBackupCount,
    categories,
    locations,
    tags,
    create,
    canSubmit,
    submit,
    quickPurchaseSeed,
  };
}
