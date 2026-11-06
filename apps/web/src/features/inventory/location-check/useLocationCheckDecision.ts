import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type {
  LocationCheckItem,
  LocationStockCheck,
  StockLevel,
} from '@/shared/api/types';
import { tr } from '@/shared/i18n';
import { localizedLocationCheckError } from './locationStockCheckPresentation';

type RefetchLocationCheck = () => Promise<{
  data: LocationStockCheck | undefined;
}>;

export function useLocationCheckDecision({
  item,
  householdId,
  locationId,
  initiallyCorrecting,
  onDecisionStart,
  onSaved,
  onConflict,
  onRefreshWarning,
  refresh,
  refetch,
}: {
  item: LocationCheckItem;
  householdId: string;
  locationId: string;
  initiallyCorrecting: boolean;
  onDecisionStart: () => void;
  onSaved: (text: string, revision: number) => void;
  onConflict: () => void;
  onRefreshWarning: () => void;
  refresh: (item: LocationCheckItem) => Promise<void>;
  refetch: RefetchLocationCheck;
}) {
  const [correcting, setCorrecting] = useState(initiallyCorrecting);
  const [batchEditing, setBatchEditing] = useState(false);
  const [quantity, setQuantity] = useState(item.stock.quantity ?? '');
  const [batchCounts, setBatchCounts] = useState<Record<string, string>>({});
  const [extraQuantity, setExtraQuantity] = useState('0');
  const [extraExpiry, setExtraExpiry] = useState('');
  const [level, setLevel] = useState<StockLevel | ''>(
    item.stock.currentLevel ?? '',
  );
  const [presence, setPresence] = useState(
    item.stock.isPresent === true
      ? 'true'
      : item.stock.isPresent === false
        ? 'false'
        : '',
  );
  const [backups, setBackups] = useState(String(item.stock.backupCount ?? 0));
  const [error, setError] = useState('');
  const [freshDecisionRequired, setFreshDecisionRequired] = useState(false);
  const [batchDataUnavailable, setBatchDataUnavailable] = useState(false);
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ item: LocationCheckItem; changed: boolean }>(
        `/households/${householdId}/locations/${locationId}/stock-check/${item.itemId}`,
        'PUT',
        body,
      ),
  });

  const run = async (body: Record<string, unknown>, successText: string) => {
    setError('');
    onDecisionStart();
    setFreshDecisionRequired(false);
    setBatchDataUnavailable(false);
    try {
      const result = await mutation.mutateAsync({
        expectedRevision: item.stockRevision,
        ...body,
      });
      onSaved(successText, result.item.stockRevision);
      setCorrecting(false);
      setBatchEditing(false);
      try {
        await refresh(result.item);
      } catch {
        onRefreshWarning();
      }
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : null;
      if (code === 'BATCH_DETAIL_REQUIRED') {
        const reloaded = await refetch();
        const observedItem = reloaded.data?.items.find(
          (entry) => entry.itemId === item.itemId,
        );
        const observedBatches = observedItem?.stock.batches ?? [];
        const positive = observedBatches.filter(
          (batch) => Number(batch.quantity) > 0,
        );
        if (positive.length) {
          setBatchCounts(
            Object.fromEntries(
              positive.map((batch) => [batch.id, batch.quantity]),
            ),
          );
          setBatchEditing(true);
          setCorrecting(true);
        } else {
          setBatchDataUnavailable(true);
        }
        setError(tr('location-check:batchCountsRequired'));
      } else if (code === 'STOCK_CHANGED') {
        setFreshDecisionRequired(true);
        setError(tr('location-check:stockChangedReviewAgain'));
        onConflict();
        await refetch();
      } else {
        setError(
          cause instanceof Error
            ? localizedLocationCheckError(cause)
            : tr('location-check:locationCheckSaveFailed'),
        );
      }
    }
  };

  const orderedPositiveBatches = (item.stock.batches ?? []).filter(
    (batch) => Number(batch.quantity) > 0,
  );

  function confirm() {
    void run(
      { decision: 'CONFIRM' },
      tr('location-check:locationStockConfirmed'),
    );
  }

  function saveCorrection() {
    if (item.trackingMode === 'QUANTITY') {
      if (batchEditing) {
        void run(
          {
            decision: 'CORRECT',
            quantity,
            batches: orderedPositiveBatches.map((batch) => ({
              batchId: batch.id,
              quantity: batchCounts[batch.id] ?? batch.quantity,
            })),
            extraUnopenedQuantity: extraQuantity || '0',
            ...(Number(extraQuantity) > 0 && extraExpiry
              ? { extraExpiryDate: extraExpiry }
              : {}),
          },
          tr('location-check:locationStockCorrectionSaved'),
        );
      } else {
        void run(
          { decision: 'CORRECT', quantity },
          tr('location-check:locationStockCorrectionSaved'),
        );
      }
      return;
    }

    const observation: Record<string, unknown> = { decision: 'CORRECT' };
    if (Object.hasOwn(item.stock, 'currentLevel') && level)
      observation.currentLevel = level;
    if (Object.hasOwn(item.stock, 'isPresent') && presence !== '')
      observation.isPresent = presence === 'true';
    if (Object.hasOwn(item.stock, 'backupCount'))
      observation.backupCount = Number(backups);
    void run(observation, tr('location-check:locationStateCorrectionSaved'));
  }

  function toggleCorrection() {
    setError('');
    setBatchEditing(false);
    setCorrecting((current) => !current);
  }

  function changeBatchCount(batchId: string, value: string) {
    setBatchCounts((current) => ({ ...current, [batchId]: value }));
  }

  return {
    correcting,
    batchEditing,
    quantity,
    setQuantity,
    batchCounts,
    changeBatchCount,
    extraQuantity,
    setExtraQuantity,
    extraExpiry,
    setExtraExpiry,
    level,
    setLevel,
    presence,
    setPresence,
    backups,
    setBackups,
    error,
    freshDecisionRequired,
    batchDataUnavailable,
    isPending: mutation.isPending,
    orderedPositiveBatches,
    confirm,
    saveCorrection,
    toggleCorrection,
  };
}
