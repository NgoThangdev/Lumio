import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type {
  CatalogOption,
  Intelligence,
  InventoryRead,
  Item,
} from '@/shared/api/types';
import { tr } from '@/shared/i18n';

export function useInventoryQueries({
  householdId,
  query,
  groupBy,
  shoppingDate,
}: {
  householdId: string;
  query: string;
  groupBy: string;
  shoppingDate: string;
}) {
  const base = `/households/${householdId}`;
  const inventory = useQuery({
    queryKey: keys.inventoryRead(householdId, query),
    queryFn: async () => {
      const result = await api<InventoryRead | Item[]>(
        `${base}/items?${query}`,
      );
      if (
        Array.isArray(result) ||
        !result ||
        !Array.isArray(result.items) ||
        (groupBy !== 'none' && !Array.isArray(result.groups))
      ) {
        throw new Error(tr('inventory:inventoryResponseMissing'));
      }
      return result;
    },
  });
  const categories = useQuery({
    queryKey: keys.catalog(householdId, 'categories'),
    queryFn: () => api<CatalogOption[]>(`${base}/categories`),
  });
  const locations = useQuery({
    queryKey: keys.catalog(householdId, 'locations'),
    queryFn: () => api<CatalogOption[]>(`${base}/locations`),
  });
  const tags = useQuery({
    queryKey: keys.catalog(householdId, 'tags'),
    queryFn: () => api<CatalogOption[]>(`${base}/tags`),
  });
  const intelligence = useQuery({
    queryKey: keys.intelligence(householdId, shoppingDate),
    queryFn: () =>
      api<Intelligence>(
        `${base}/stock-intelligence${shoppingDate ? `?shoppingDate=${shoppingDate}` : ''}`,
      ),
  });

  return { inventory, categories, locations, tags, intelligence };
}
