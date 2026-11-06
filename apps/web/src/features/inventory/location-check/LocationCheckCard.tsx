import type { LocationCheckItem, LocationStockCheck } from '@/shared/api/types';
import { Card, Notice } from '@/shared/ui/primitives';
import { tr } from '@/shared/i18n';
import { LocationCheckCorrectionForm } from './LocationCheckCorrectionForm';
import { LocationCheckDecisionActions } from './LocationCheckDecisionActions';
import { LocationCheckStockSummary } from './LocationCheckStockSummary';
import { useLocationCheckDecision } from './useLocationCheckDecision';

type RefetchLocationCheck = () => Promise<{
  data: LocationStockCheck | undefined;
}>;

export function LocationCheckCard({
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
  const actions = useLocationCheckDecision({
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
  });

  return (
    <Card
      id={`location-correction-${item.itemId}`}
      tabIndex={-1}
      className={`location-check-item status-${item.status.toLowerCase()}`}
    >
      <LocationCheckStockSummary
        item={item}
        initiallyCorrecting={initiallyCorrecting}
      />
      {actions.error && <Notice kind="error">{actions.error}</Notice>}
      {(actions.freshDecisionRequired || item.status === 'STALE') && (
        <p className="muted" role="status">
          {tr('common:reviewLatestStock')}
        </p>
      )}
      {actions.batchDataUnavailable && (
        <p className="muted">{tr('location-check:checklistReturnCurrent')}</p>
      )}
      <LocationCheckDecisionActions
        isPending={actions.isPending}
        correcting={actions.correcting}
        onConfirm={actions.confirm}
        onToggleCorrection={actions.toggleCorrection}
      />
      {actions.correcting && (
        <LocationCheckCorrectionForm
          item={item}
          isPending={actions.isPending}
          batchEditing={actions.batchEditing}
          quantity={actions.quantity}
          onQuantityChange={actions.setQuantity}
          batches={actions.orderedPositiveBatches}
          batchCounts={actions.batchCounts}
          onBatchCountChange={actions.changeBatchCount}
          extraQuantity={actions.extraQuantity}
          onExtraQuantityChange={actions.setExtraQuantity}
          extraExpiry={actions.extraExpiry}
          onExtraExpiryChange={actions.setExtraExpiry}
          level={actions.level}
          onLevelChange={actions.setLevel}
          presence={actions.presence}
          onPresenceChange={actions.setPresence}
          backups={actions.backups}
          onBackupsChange={actions.setBackups}
          onSubmit={actions.saveCorrection}
        />
      )}
    </Card>
  );
}
