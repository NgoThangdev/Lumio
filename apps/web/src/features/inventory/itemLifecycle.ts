import type { QueryClient } from '@tanstack/react-query';
import { keys } from '../../shared/api/keys';

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
        queryKey: ['household', householdId, 'archived-items'],
        refetchType: 'all',
      },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      {
        queryKey: ['household', householdId, 'intelligence'],
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
      { queryKey: ['household', householdId, 'trip'], refetchType: 'all' },
      { throwOnError: true },
    ),
    queryClient.invalidateQueries(
      {
        queryKey: ['household', householdId, 'location-stock-check'],
        refetchType: 'all',
      },
      { throwOnError: true },
    ),
  ]);
  return results.every((result) => result.status === 'fulfilled');
}
