import { Link } from 'react-router';
import type { Item } from '@/shared/api/types';
import { formatDateOnly, tr } from '@/shared/i18n';
import { StockCheckPanel } from './StockCheckPanel';
import type { Trip } from './shoppingTypes';

export function ShoppingTripHeader({
  trip,
  routeBase,
  purchasedCount,
  onAllTrips,
}: {
  trip: Trip;
  routeBase: string;
  purchasedCount: number;
  onAllTrips: () => void;
}) {
  return (
    <div className="trip-header">
      <button className="link" onClick={onAllTrips}>
        {tr('common:allTrips')}
      </button>
      <div>
        <p className="eyebrow">
          {trip.status === 'DRAFT'
            ? tr('common:plan')
            : trip.status === 'SHOPPING'
              ? tr('common:shoppingMode')
              : tr('common:finished')}
        </p>
        <h1>{trip.store}</h1>
        <div className="trip-header-meta">
          <p>
            {formatDateOnly(trip.plannedDate)} · {purchasedCount} /{' '}
            {trip.entries.length} {tr('common:purchased2')}
          </p>
          <Link
            className="secondary trip-quick-purchase"
            to={`${routeBase}/quick-purchase`}
          >
            {tr('shopping:quickPurchase')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ShoppingDraftTools({
  householdId,
  trip,
  suggestionsAlreadyImported,
  busy,
  onImport,
  onStart,
}: {
  householdId: string;
  trip: Trip;
  suggestionsAlreadyImported: boolean;
  busy: boolean;
  onImport: () => void;
  onStart: () => void;
}) {
  if (trip.status !== 'DRAFT') return null;
  return (
    <>
      {suggestionsAlreadyImported ? (
        <p className="muted stock-check-imported-note" role="status">
          {tr('shopping:draftAlreadyHas')}
        </p>
      ) : (
        <>
          <StockCheckPanel householdId={householdId} tripId={trip.id} />
          <div className="trip-tools">
            <button className="secondary" disabled={busy} onClick={onImport}>
              {busy
                ? tr('shopping:importing')
                : tr('shopping:importSuggestionsCurrent')}
            </button>
          </div>
        </>
      )}
      <button className="primary" disabled={busy} onClick={onStart}>
        {tr('common:startShopping')}
      </button>
    </>
  );
}

export function ShoppingManualAdd({
  trip,
  available,
  manualItemId,
  validManualSelection,
  busy,
  onManualItemChange,
  onAddManual,
}: {
  trip: Trip;
  available: Item[];
  manualItemId: string;
  validManualSelection: boolean;
  busy: boolean;
  onManualItemChange: (value: string) => void;
  onAddManual: () => void;
}) {
  if (trip.status === 'RESTOCKED' || available.length === 0) return null;
  return (
    <form
      className="card manual-add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validManualSelection) return;
        onAddManual();
      }}
    >
      <div>
        <p className="eyebrow">{tr('common:addExistingItem')}</p>
      </div>
      <select
        aria-label={tr('shopping:existingItem')}
        value={manualItemId}
        onChange={(event) => onManualItemChange(event.target.value)}
        required
      >
        <option value="">{tr('common:chooseItem')}</option>
        {available.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} ·{' '}
            {item.trackingMode === 'QUANTITY'
              ? item.primaryUnit
              : tr('shopping:backupUnits')}
          </option>
        ))}
      </select>
      <button className="secondary" disabled={busy || !validManualSelection}>
        {tr('common:add')}
      </button>
    </form>
  );
}
