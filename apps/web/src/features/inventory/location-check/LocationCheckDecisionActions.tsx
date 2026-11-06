import { Button } from '@/shared/ui/primitives';
import { tr } from '@/shared/i18n';

export function LocationCheckDecisionActions({
  isPending,
  correcting,
  onConfirm,
  onToggleCorrection,
}: {
  isPending: boolean;
  correcting: boolean;
  onConfirm: () => void;
  onToggleCorrection: () => void;
}) {
  return (
    <div className="location-check-actions">
      <Button type="button" disabled={isPending} onClick={onConfirm}>
        {isPending
          ? tr('common:saving')
          : tr('location-check:confirmStockHere')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={isPending}
        onClick={onToggleCorrection}
      >
        {correcting
          ? tr('common:closeCorrection')
          : tr('location-check:correctStock')}
      </Button>
    </div>
  );
}
