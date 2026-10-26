import type { CatalogOption, Item } from '@/shared/api/types';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import { localizedError, tr } from '@/shared/i18n';
import type { useQuantityStockActions } from './useQuantityStockActions';

type QuantityActions = ReturnType<typeof useQuantityStockActions>;

export function QuantityStockActions({
  item,
  actions,
  locations,
}: {
  item: Item;
  actions: QuantityActions;
  locations: {
    data?: CatalogOption[];
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
}) {
  const {
    undoCandidate,
    undoAction,
    useAction,
    restockAction,
    restockLocationId,
    busy,
  } = actions;

  return (
    <>
      {undoCandidate && (
        <Card className="action-card plain-action-card undo-action">
          <p className="eyebrow">{tr('item-detail:recentAction')}</p>
          <p className="muted">{tr('item-detail:serverSaysAction')}</p>
          {undoAction.isError && (
            <Notice kind="error">{localizedError(undoAction.error)}</Notice>
          )}
          {undoAction.isPending && (
            <p className="muted" role="status">
              {tr('item-detail:undoingAction')}
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={undoAction.isPending}
            onClick={() => undoAction.undo(undoCandidate)}
          >
            {tr('common:undo')}
          </Button>
        </Card>
      )}
      <Card className="action-card use-action">
        <details>
          <summary className="action-summary">
            <span aria-hidden="true">−</span> {tr('common:use')}{' '}
            <span className="disclosure-arrow" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="action-body">
            <h2>{tr('common:useStock')}</h2>
            <p className="muted">
              {item.openedTrackingEnabled
                ? tr('item-detail:eligibleOpenedStock')
                : tr('common:earliestEligibleExpiry')}
            </p>
            {useAction.isError && (
              <Notice kind="error">{localizedError(useAction.error)}</Notice>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void actions.recordUse().catch(() => undefined);
              }}
            >
              <label>
                {tr('common:quantityUsed')}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.000001"
                  step="0.000001"
                  value={actions.use}
                  onChange={(event) => actions.setUse(event.target.value)}
                  required
                />
              </label>
              <Button className="wide" disabled={busy}>
                {tr('common:recordUse')}
              </Button>
            </form>
          </div>
        </details>
      </Card>
      <Card className="action-card restock-action">
        <details>
          <summary className="action-summary">
            <span aria-hidden="true">+</span> {tr('common:restock')}{' '}
            <span className="disclosure-arrow" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="action-body">
            <h2>{tr('item-detail:addLittle')}</h2>
            {restockAction.isError && (
              <Notice kind="error">
                {localizedError(restockAction.error)}
              </Notice>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void actions.addStock().catch(() => undefined);
              }}
            >
              <label>
                {tr('common:actualQuantity')}
                <input
                  type="number"
                  inputMode={item.openedTrackingEnabled ? 'numeric' : 'decimal'}
                  min={item.openedTrackingEnabled ? '1' : '0.000001'}
                  step={item.openedTrackingEnabled ? '1' : '0.000001'}
                  value={actions.restock}
                  onChange={(event) => actions.setRestock(event.target.value)}
                  required
                />
              </label>
              {item.openedTrackingEnabled && (
                <p className="muted">{tr('item-detail:enterWholeUnopened')}</p>
              )}
              <label>
                {tr('common:expiryDate')} <em>{tr('common:optional2')}</em>
                <input
                  type="date"
                  value={actions.expiry}
                  onChange={(event) => actions.setExpiry(event.target.value)}
                />
              </label>
              {locations.isError && (
                <Notice kind="error">
                  {tr('common:householdLocationsLoaded')}{' '}
                  {localizedError(locations.error)}
                </Notice>
              )}
              <label>
                {tr('common:stockLocation')}
                <select
                  value={restockLocationId}
                  onChange={(event) =>
                    actions.setRestockLocation(event.target.value)
                  }
                  disabled={locations.isPending || locations.isError || busy}
                >
                  <option value="">{tr('common:chooseLocation')}</option>
                  {locations.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.id === item.preferredRestockLocation?.id
                        ? ` · ${tr('common:preferred')}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              {actions.needsRestockLocation ? (
                <>
                  <Notice kind="error">
                    {tr('item-detail:chooseLocationItem')}
                  </Notice>
                  <Button
                    type="button"
                    variant="secondary"
                    className="wide"
                    disabled={busy || !restockLocationId || locations.isError}
                    onClick={() =>
                      void actions
                        .addStock(restockLocationId)
                        .catch(() => undefined)
                    }
                  >
                    {tr('item-detail:confirmLocationRetry2')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  className="wide"
                  disabled={busy || locations.isPending || locations.isError}
                >
                  {tr('common:addStock')}
                </Button>
              )}
            </form>
          </div>
        </details>
      </Card>
    </>
  );
}
