import type { QueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { Household } from '@/shared/api/types';
import type { PendingHouseholdDeletion } from './householdDeletionTypes';

export async function refreshHouseholdLists(
  queryClient: QueryClient,
  userId: string,
) {
  const [households, pending] = await Promise.allSettled([
    api<Household[]>('/households'),
    api<PendingHouseholdDeletion[]>('/households/pending-deletions'),
  ]);
  if (households.status === 'fulfilled')
    queryClient.setQueryData(keys.households, households.value);
  if (pending.status === 'fulfilled')
    queryClient.setQueryData(keys.pendingDeletions(userId), pending.value);
  return {
    households: households.status === 'fulfilled' ? households.value : null,
    pending: pending.status === 'fulfilled' ? pending.value : null,
    refreshed:
      households.status === 'fulfilled' && pending.status === 'fulfilled',
  };
}

export async function refreshAfterHouseholdDeletion(
  queryClient: QueryClient,
  householdId: string,
  userId: string,
) {
  queryClient.removeQueries({ queryKey: keys.household(householdId) });
  const lists = await refreshHouseholdLists(queryClient, userId);
  let attentionRefreshed = true;
  try {
    await queryClient.invalidateQueries(
      {
        queryKey: keys.attention(userId),
        refetchType: 'active',
      },
      { throwOnError: true },
    );
  } catch {
    attentionRefreshed = false;
  }
  return lists.refreshed && attentionRefreshed;
}
