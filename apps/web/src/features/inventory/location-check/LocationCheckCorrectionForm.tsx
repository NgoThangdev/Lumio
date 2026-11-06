import {
  STOCK_LEVELS,
  type LocationCheckItem,
  type StockLevel,
} from '@/shared/api/types';
import { Button } from '@/shared/ui/primitives';
import { localizedEnum, tr } from '@/shared/i18n';
import { LocationCheckBatchEditor } from './LocationCheckBatchEditor';

type LocationCheckBatch = NonNullable<
  LocationCheckItem['stock']['batches']
>[number];

export function LocationCheckCorrectionForm({
  item,
  isPending,
  batchEditing,
  quantity,
  onQuantityChange,
  batches,
  batchCounts,
  onBatchCountChange,
  extraQuantity,
  onExtraQuantityChange,
  extraExpiry,
  onExtraExpiryChange,
  level,
  onLevelChange,
  presence,
  onPresenceChange,
  backups,
  onBackupsChange,
  onSubmit,
}: {
  item: LocationCheckItem;
  isPending: boolean;
  batchEditing: boolean;
  quantity: string;
  onQuantityChange: (value: string) => void;
  batches: LocationCheckBatch[];
  batchCounts: Record<string, string>;
  onBatchCountChange: (batchId: string, quantity: string) => void;
  extraQuantity: string;
  onExtraQuantityChange: (value: string) => void;
  extraExpiry: string;
  onExtraExpiryChange: (value: string) => void;
  level: StockLevel | '';
  onLevelChange: (value: StockLevel | '') => void;
  presence: string;
  onPresenceChange: (value: string) => void;
  backups: string;
  onBackupsChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="location-check-correction"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {item.trackingMode === 'QUANTITY' ? (
        <>
          <label>
            {tr('location-check:totalQuantity')}{' '}
            {tr('location-check:thisLocation')}
            <input
              type="number"
              min="0"
              step="0.000001"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => onQuantityChange(event.target.value)}
              required
            />
          </label>
          {!batchEditing ? (
            <p className="muted">{tr('location-check:changesOnlyStock')}</p>
          ) : (
            <LocationCheckBatchEditor
              item={item}
              batches={batches}
              batchCounts={batchCounts}
              onBatchCountChange={onBatchCountChange}
              extraQuantity={extraQuantity}
              onExtraQuantityChange={onExtraQuantityChange}
              extraExpiry={extraExpiry}
              onExtraExpiryChange={onExtraExpiryChange}
            />
          )}
        </>
      ) : (
        <>
          {Object.hasOwn(item.stock, 'currentLevel') && (
            <label>
              {tr('common:currentLevel')}
              <select
                value={level}
                onChange={(event) =>
                  onLevelChange(event.target.value as StockLevel | '')
                }
                required
              >
                <option value="">
                  {tr('location-check:chooseObservedLevel')}
                </option>
                {STOCK_LEVELS.map((entry) => (
                  <option key={entry} value={entry}>
                    {localizedEnum(entry)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {Object.hasOwn(item.stock, 'isPresent') && (
            <label>
              {tr('common:currentItem')}
              <select
                value={presence}
                onChange={(event) => onPresenceChange(event.target.value)}
                required
              >
                <option value="">
                  {tr('location-check:chooseObservedState')}
                </option>
                <option value="true">{tr('common:present')}</option>
                <option value="false">{tr('common:absent')}</option>
              </select>
            </label>
          )}
          {Object.hasOwn(item.stock, 'backupCount') && (
            <label>
              {tr('location-check:backupsLocation')}
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={backups}
                onChange={(event) => onBackupsChange(event.target.value)}
                required
              />
            </label>
          )}
        </>
      )}
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending
          ? tr('common:saving')
          : batchEditing
            ? tr('location-check:saveBatchObservations')
            : tr('common:saveCorrection')}
      </Button>
    </form>
  );
}
