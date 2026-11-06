import { useQueryClient } from '@tanstack/react-query';
import { keys } from '@/shared/api/keys';
import { tr } from '@/shared/i18n';
import type { Trip } from './shoppingTypes';

export function useShoppingFinishActions({
  householdId,
  base,
  trip,
  requiredLocationItemId,
  retryLocationId,
  setRequiredLocationItemId,
  setRetryLocationId,
  run,
  updateTrip,
  setNotice,
}: {
  householdId: string;
  base: string;
  trip: Trip | null;
  requiredLocationItemId: string;
  retryLocationId: string;
  setRequiredLocationItemId: (value: string) => void;
  setRetryLocationId: (value: string) => void;
  run: (work: () => Promise<void>) => Promise<void>;
  updateTrip: (path: string, method: string, body?: object) => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();

  function finish() {
    if (!trip) return;
    void run(async () => {
      await updateTrip(`${base}/${trip.id}/finish`, 'POST');
      setNotice(tr('shopping:shoppingFinishedNotice'));
      await queryClient.invalidateQueries({
        queryKey: keys.household(householdId),
        refetchType: 'all',
      });
    });
  }

  function confirmLocation() {
    if (!trip) return;
    void run(async () => {
      const entry = trip.entries.find(
        (candidate) => candidate.item.id === requiredLocationItemId,
      );
      if (!entry) throw new Error(tr('shopping:tripItemUnavailable'));
      if (entry.status !== 'PURCHASED' || !entry.actualQuantity) {
        throw new Error(tr('shopping:purchaseDetailsChanged'));
      }
      await updateTrip(`${base}/${trip.id}/entries/${entry.id}`, 'PATCH', {
        status: 'PURCHASED',
        actualQuantity: entry.actualQuantity,
        expiryDate: entry.expiryDate?.slice(0, 10) ?? null,
        locationId: retryLocationId,
      });
      await updateTrip(`${base}/${trip.id}/finish`, 'POST');
      setRequiredLocationItemId('');
      setRetryLocationId('');
      setNotice(tr('shopping:shoppingFinishedNotice'));
      await queryClient.invalidateQueries({
        queryKey: keys.household(householdId),
        refetchType: 'all',
      });
    });
  }

  return { finish, confirmLocation };
}
