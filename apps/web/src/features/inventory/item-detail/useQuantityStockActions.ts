import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type { Item, UndoCandidate, UndoEligibility } from '@/shared/api/types';
import { tr } from '@/shared/i18n';
import { useItemUndoAction } from './useItemUndoAction';

export function useQuantityStockActions({
  householdId,
  itemId,
  item,
  onRefresh,
  onNotice,
}: {
  householdId: string;
  itemId: string;
  item?: Item;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [restock, setRestock] = useState('');
  const [expiry, setExpiry] = useState('');
  const [restockLocation, setRestockLocation] = useState<string | null>(null);
  const [use, setUse] = useState('');
  const [undoCandidate, setUndoCandidate] = useState<UndoCandidate | null>(
    null,
  );

  const restockAction = useMutation({
    mutationFn: (input: {
      quantity: string;
      expiryDate: string | null;
      locationId?: string;
    }) =>
      api(`/households/${householdId}/items/${itemId}/restock`, 'POST', {
        ...input,
      }),
    onSuccess: onRefresh,
  });
  const useAction = useMutation({
    mutationFn: () =>
      api<{ id: string; undoEligibility?: UndoEligibility }>(
        `/households/${householdId}/items/${itemId}/use`,
        'POST',
        { quantity: use },
      ),
    onSuccess: async (result) => {
      await onRefresh();
      setUndoCandidate(
        item?.trackingMode === 'QUANTITY' &&
          item.openedTrackingEnabled === false &&
          result.undoEligibility?.eligible === true
          ? { actionId: result.id, actionKind: 'INVENTORY' }
          : null,
      );
    },
  });
  const undoAction = useItemUndoAction({
    householdId,
    itemId,
    onRefresh,
    onUndoStarted: () => setUndoCandidate(null),
    onUndoComplete: (result) =>
      onNotice(
        result.alreadyUndone
          ? tr('item-detail:actionAlreadyUndone')
          : tr('item-detail:actionUndone'),
      ),
    onConflict: () => setUndoCandidate(null),
  });

  const preferredLocationId = item?.preferredRestockLocation?.id ?? '';
  const restockLocationId = restockLocation ?? preferredLocationId;

  async function recordUse() {
    onNotice('');
    await useAction.mutateAsync();
    setUse('');
    onNotice('Use recorded.');
  }

  async function addStock(locationId?: string) {
    onNotice('');
    await restockAction.mutateAsync({
      quantity: restock,
      expiryDate: expiry || null,
      locationId: locationId ?? (restockLocationId || undefined),
    });
    setRestock('');
    setExpiry('');
    setRestockLocation(null);
    onNotice('Stock added.');
  }

  const needsRestockLocation =
    restockAction.error instanceof ApiError &&
    restockAction.error.code === 'LOCATION_REQUIRED' &&
    restockAction.error.itemId === itemId;

  return {
    restock,
    setRestock,
    expiry,
    setExpiry,
    restockLocationId,
    setRestockLocation,
    use,
    setUse,
    undoCandidate,
    undoAction,
    restockAction,
    useAction,
    needsRestockLocation,
    busy:
      restockAction.isPending || useAction.isPending || undoAction.isPending,
    recordUse,
    addStock,
  };
}
