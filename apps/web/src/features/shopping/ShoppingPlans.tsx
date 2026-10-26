import type { UseQueryResult } from '@tanstack/react-query';
import type { HouseholdShoppingSettings } from '@/shared/api/types';
import {
  formatDateOnly,
  formatNumber,
  localizedEnum,
  localizedError,
  tr,
} from '@/shared/i18n';
import { ItemVisual, Notice } from '@/shared/ui/primitives';
import type { TripSummary } from './shoppingTypes';

export function ShoppingPlans({
  trips,
  shoppingSettings,
  store,
  plannedDate,
  busy,
  onOpen,
  onCreate,
  onStoreChange,
  onPlannedDateChange,
}: {
  trips: UseQueryResult<TripSummary[]>;
  shoppingSettings: UseQueryResult<HouseholdShoppingSettings>;
  store: string;
  plannedDate: string;
  busy: boolean;
  onOpen: (entry: TripSummary) => void;
  onCreate: () => void;
  onStoreChange: (value: string) => void;
  onPlannedDateChange: (value: string) => void;
}) {
  return (
    <div className="grid">
      <section className="card">
        <p className="eyebrow">{tr('common:shoppingTrips')}</p>
        <h2>{tr('common:plans')}</h2>
        {trips.isPending ? (
          <p className="muted">{tr('common:loadingTrips')}</p>
        ) : trips.isError ? (
          <Notice kind="error">{localizedError(trips.error)}</Notice>
        ) : trips.data.length === 0 ? (
          <p className="muted">{tr('common:tripsYetCreate')}</p>
        ) : (
          trips.data.map((entry) => (
            <button
              className="row"
              key={entry.id}
              disabled={busy}
              onClick={() => onOpen(entry)}
            >
              <ItemVisual name={entry.store} illustrationKey="basket" />
              <span className="item-identity">
                <strong>{entry.store}</strong>
                <small>
                  {formatDateOnly(entry.plannedDate)} ·{' '}
                  {formatNumber(entry._count?.entries ?? 0)}{' '}
                  {tr('common:items')}
                </small>
              </span>
              <span className="pill">{localizedEnum(entry.status)}</span>
            </button>
          ))
        )}
      </section>
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <p className="eyebrow">{tr('common:plan')}</p>
        <h2>{tr('common:createTrip')}</h2>
        {shoppingSettings.isPending && (
          <p className="muted" role="status">
            {tr('shopping:loadingHouseholdShopping')}
          </p>
        )}
        {shoppingSettings.isError && (
          <Notice kind="error">
            {tr('common:shoppingDefaultsLoaded')}{' '}
            {localizedError(shoppingSettings.error)}
            {tr('shopping:enterStoreDate')}{' '}
            <button
              type="button"
              className="link"
              onClick={() => void shoppingSettings.refetch()}
            >
              {tr('shopping:retryDefaults2')}
            </button>
            .
          </Notice>
        )}
        <label>
          {tr('common:primaryStore')}
          <input
            value={store}
            onChange={(event) => onStoreChange(event.target.value)}
            placeholder={tr('shopping:storeExample')}
            required
          />
        </label>
        <label>
          {tr('common:plannedDate')}
          <input
            type="date"
            value={plannedDate}
            onChange={(event) => onPlannedDateChange(event.target.value)}
            required
          />
        </label>
        {shoppingSettings.data && (
          <p className="muted">
            {tr('shopping:suggestedHouseholdS')}{' '}
            {`${formatNumber(shoppingSettings.data.defaultShoppingCycleDays)}-day`}{' '}
            {tr('shopping:cycleAsiaHo')}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {tr('common:createTrip2')}
        </button>
      </form>
    </div>
  );
}
