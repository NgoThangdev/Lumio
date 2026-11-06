import type { LocationCheckItem } from '@/shared/api/types';
import { formatDateOnly, tr } from '@/shared/i18n';

type LocationCheckBatch = NonNullable<
  LocationCheckItem['stock']['batches']
>[number];

export function LocationCheckBatchEditor({
  item,
  batches,
  batchCounts,
  onBatchCountChange,
  extraQuantity,
  onExtraQuantityChange,
  extraExpiry,
  onExtraExpiryChange,
}: {
  item: LocationCheckItem;
  batches: LocationCheckBatch[];
  batchCounts: Record<string, string>;
  onBatchCountChange: (batchId: string, quantity: string) => void;
  extraQuantity: string;
  onExtraQuantityChange: (quantity: string) => void;
  extraExpiry: string;
  onExtraExpiryChange: (date: string) => void;
}) {
  return (
    <>
      {batches.map((batch) => (
        <label className="batch-observation" key={batch.id}>
          {tr('common:batch')} {batch.id.slice(0, 8)} ·{' '}
          {batch.openedAt ? tr('common:opened') : tr('common:unopened')} ·{' '}
          {batch.expiryDate
            ? tr('location-check:expiresOn', {
                date: formatDateOnly(batch.expiryDate),
              })
            : tr('common:expiry2')}
          <input
            type="number"
            min="0"
            step={
              item.openedTrackingEnabled && !batch.openedAt ? '1' : '0.000001'
            }
            inputMode="decimal"
            value={batchCounts[batch.id] ?? batch.quantity}
            onChange={(event) =>
              onBatchCountChange(batch.id, event.target.value)
            }
            required
          />
        </label>
      ))}
      <label>
        {tr('location-check:additionalUnopenedQuantity')}
        <input
          type="number"
          min="0"
          step={item.openedTrackingEnabled ? '1' : '0.000001'}
          inputMode={item.openedTrackingEnabled ? 'numeric' : 'decimal'}
          value={extraQuantity}
          onChange={(event) => onExtraQuantityChange(event.target.value)}
        />
      </label>
      {Number(extraQuantity) > 0 && (
        <label>
          {tr('location-check:expiryAdditionalQuantity')}{' '}
          <em>{tr('common:optional2')}</em>
          <input
            type="date"
            value={extraExpiry}
            onChange={(event) => onExtraExpiryChange(event.target.value)}
          />
        </label>
      )}
      <p className="muted">{tr('location-check:batchIdsExpiry')}</p>
    </>
  );
}
