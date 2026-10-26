import type { CatalogOption } from '@/shared/api/types';
import { localizedError, tr } from '@/shared/i18n';
import { Notice } from '@/shared/ui/primitives';
import type { Trip } from './shoppingTypes';

export function ShoppingFinishPanel({
  trip,
  purchasedCount,
  movedCount,
  unsavedPurchase,
  busy,
  requiredLocationItemId,
  retryLocationId,
  onRetryLocationChange,
  locationsError,
  locationsErrorValue,
  locationsPending,
  locationOptions,
  purchasedQuantityCount,
  purchasedBackupCount,
  onFinish,
  onConfirmLocation,
}: {
  trip: Trip;
  purchasedCount: number;
  movedCount: number;
  unsavedPurchase: boolean;
  busy: boolean;
  requiredLocationItemId: string;
  retryLocationId: string;
  onRetryLocationChange: (value: string) => void;
  locationsError: boolean;
  locationsErrorValue: Error | null;
  locationsPending: boolean;
  locationOptions?: CatalogOption[];
  purchasedQuantityCount: number;
  purchasedBackupCount: number;
  onFinish: () => void;
  onConfirmLocation: () => void;
}) {
  return (
    <>
      {trip.status === 'SHOPPING' && (
        <section className="card finish-panel">
          <div>
            <h2>{tr('common:finishShopping')}</h2>
            <p className="muted">
              {tr('common:only')} {purchasedCount} {tr('common:purchased2')}{' '}
              {purchasedCount === 1 ? tr('common:item') : tr('common:items')}{' '}
              {tr('shopping:savedActualAmounts')}
              {movedCount > 0 &&
                ` ${movedCount} ${tr(movedCount === 1 ? 'shopping:movedItemCarried' : 'shopping:movedItemsCarried')}`}
              {unsavedPurchase && ` ${tr('shopping:saveEditedPurchases')}`}
            </p>
          </div>
          <button
            className="primary"
            disabled={busy || unsavedPurchase}
            onClick={() => onFinish()}
          >
            {tr('common:finishShopping')}
          </button>
          {requiredLocationItemId && (
            <div className="location-retry-panel">
              <Notice kind="error">
                {tr('shopping:apiRequiresLocation')} {requiredLocationItemId}
                {tr('shopping:tripStockCommitted')}
              </Notice>
              {locationsError && (
                <Notice kind="error">
                  {tr('common:householdLocationsLoaded')}{' '}
                  {localizedError(locationsErrorValue)}
                </Notice>
              )}
              <label>
                {tr('shopping:locationItem')} {requiredLocationItemId}
                <select
                  value={retryLocationId}
                  onChange={(event) =>
                    onRetryLocationChange(event.target.value)
                  }
                  disabled={busy || locationsPending || locationsError}
                >
                  <option value="">{tr('common:chooseLocation')}</option>
                  {locationOptions?.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary"
                disabled={busy || !retryLocationId || locationsError}
                onClick={() => onConfirmLocation()}
              >
                {tr('common:confirmLocationRetry')}
              </button>
            </div>
          )}
        </section>
      )}
      {trip.status === 'RESTOCKED' && (
        <div className="message success" role="status">
          {tr('shopping:finished2')}{' '}
          {purchasedQuantityCount > 0 &&
            `${tr('shopping:quantityPurchasesAdded')} `}
          {purchasedBackupCount > 0 &&
            `${tr('shopping:backupPurchasesIncreased')} `}
          {purchasedCount === 0 && `${tr('shopping:stockAdded')} `}
          {tr('shopping:skippedMovedItems')}
        </div>
      )}
    </>
  );
}
