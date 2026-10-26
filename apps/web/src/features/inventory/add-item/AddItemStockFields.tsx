import {
  STOCK_LEVELS,
  type StockLevel,
  type TrackingMode,
} from '@/shared/api/types';
import { tr } from '@/shared/i18n';

export function AddItemStockFields({
  mode,
  quickPurchaseSeed,
  quantity,
  onQuantityChange,
  expiry,
  onExpiryChange,
  level,
  onLevelChange,
  present,
  onPresentChange,
  backupCount,
  onBackupCountChange,
}: {
  mode: TrackingMode;
  quickPurchaseSeed: boolean;
  quantity: string;
  onQuantityChange: (value: string) => void;
  expiry: string;
  onExpiryChange: (value: string) => void;
  level: StockLevel | '';
  onLevelChange: (value: StockLevel | '') => void;
  present: string;
  onPresentChange: (value: string) => void;
  backupCount: string;
  onBackupCountChange: (value: string) => void;
}) {
  if (mode === 'QUANTITY')
    return (
      <>
        <label>
          {tr('inventory:startingQuantity')}
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => onQuantityChange(event.target.value)}
            placeholder="0 or 2.5"
            required
          />
        </label>
        <p className="muted">
          {quickPurchaseSeed
            ? tr('inventory:amountBoughtSaved')
            : tr('inventory:haveNoneHome')}
        </p>
        {quantity !== '0' && (
          <details className="catalog-disclosure">
            <summary>
              {tr('common:expiryDate')} <em>{tr('common:optional2')}</em>
            </summary>
            <label>
              {tr('common:expiryDate')}
              <input
                type="date"
                value={expiry}
                onChange={(event) => onExpiryChange(event.target.value)}
              />
            </label>
          </details>
        )}
      </>
    );

  return (
    <>
      {mode === 'FIVE_LEVEL' ? (
        <label>
          {tr('common:currentLevel')}
          <select
            value={level}
            onChange={(event) =>
              onLevelChange(event.target.value as StockLevel)
            }
            required
          >
            <option value="">{tr('common:chooseLevel')}</option>
            {STOCK_LEVELS.map((stockLevel) => (
              <option key={stockLevel} value={stockLevel}>
                {stockLevel === 'FULL'
                  ? tr('common:full2')
                  : stockLevel === 'THREE_QUARTERS'
                    ? '¾'
                    : stockLevel === 'HALF'
                      ? '½'
                      : stockLevel === 'QUARTER'
                        ? '¼'
                        : tr('common:empty2')}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          {tr('common:currentItem')}
          <select
            value={present}
            onChange={(event) => onPresentChange(event.target.value)}
            required
          >
            <option value="">{tr('common:chooseState')}</option>
            <option value="true">{tr('common:present')}</option>
            <option value="false">{tr('common:absent')}</option>
          </select>
        </label>
      )}
      <label>
        {tr('common:backupCount')}
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          value={backupCount}
          onChange={(event) => onBackupCountChange(event.target.value)}
          required
        />
      </label>
    </>
  );
}
