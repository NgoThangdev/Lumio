import type { QueryClient } from '@tanstack/react-query';
import { keys } from '@/shared/api/keys';

export async function refreshItemLifecycle(
  queryClient: QueryClient,
  householdId: string,
  itemId: string,
) {
  const results = await Promise.allSettled([
    queryClient.invalidateQueries(
      { queryKey: keys.item(householdId, itemId), refetchType: 'all' },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      { queryKey: keys.items(householdId), refetchType: 'all' },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      {
        queryKey: keys.archivedItems(householdId),
        refetchType: 'all',
      },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      {
        queryKey: keys.intelligencePrefix(householdId),
        refetchType: 'all',
      },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      { queryKey: keys.needsAttention(householdId), refetchType: 'all' },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      { queryKey: keys.recentActivity(householdId), refetchType: 'all' },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      { queryKey: keys.trips(householdId), refetchType: 'all' },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      { queryKey: keys.tripDetailsPrefix(householdId), refetchType: 'all' },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      {
        queryKey: keys.locationStockCheckPrefix(householdId),
        refetchType: 'all',
      },
      { throwOnError: true },
    ),
  ]);
  return results.every((result) => result.status === 'fulfilled');
}
