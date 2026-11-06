import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { Trip, TripSummary } from './shoppingTypes';

export function useShoppingTripMutations({
  householdId,
  base,
  onTripUpdated,
}: {
  householdId: string;
  base: string;
  onTripUpdated: (trip: Trip) => void;
}) {
  const queryClient = useQueryClient();
  const createTrip = useMutation({
    mutationFn: (input: { store: string; plannedDate: string }) =>
      api<TripSummary>(base, 'POST', input),
  });
  const changeTrip = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body?: object;
    }) => api<Trip>(path, method, body),
    onSuccess: async (next) => {
      queryClient.setQueryData(keys.trip(householdId, next.id), next);
      await queryClient.invalidateQueries({
        queryKey: keys.trips(householdId),
      });
    },
  });

  async function updateTrip(path: string, method: string, body?: object) {
    onTripUpdated(await changeTrip.mutateAsync({ path, method, body }));
  }

  return { createTrip, updateTrip };
}
