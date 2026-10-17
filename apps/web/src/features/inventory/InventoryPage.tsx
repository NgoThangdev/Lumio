import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useHousehold } from '../../app/useHousehold';
import { api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  Assessment,
  CatalogOption,
  Intelligence,
  InventoryGroupEntry,
  InventoryRead,
  Item,
} from '../../shared/api/types';
import {
  Card,
  ItemVisual,
  Notice,
  StockBadge,
} from '../../shared/ui/primitives';
import { Doodle } from '../../shared/ui/Doodle';
import { AddItemForm, type QuickPurchaseSeed } from './AddItemForm';

function locationLabel(item: Item, locations?: CatalogOption[]) {
  if (item.trackingMode === 'QUANTITY') {
    const names = [
      ...new Set(
        item.batches
          .map(
            (batch) =>
              locations?.find((location) => location.id === batch.locationId)
                ?.name,
          )
          .filter(Boolean),
      ),
    ];
    return names.length
      ? names.join(', ')
      : item.batches.some((batch) => batch.locationId)
        ? 'See batch locations in detail'
        : 'Location not set';
  }
  if (item.currentLocation?.name)
    return `Current: ${item.currentLocation.name}`;
  if (item.backupLocation?.name) return `Backups: ${item.backupLocation.name}`;
  return 'Location not set';
}

function ItemRow({
  item,
  assessment,
  base,
  place,
  stock,
  locations,
}: {
  item: Item;
  assessment: Assessment;
  base: string;
  place?: string;
  stock?: InventoryGroupEntry;
  locations?: CatalogOption[];
}) {
  const amount =
    item.trackingMode === 'QUANTITY'
      ? `${stock ? (stock.quantity ?? '—') : (assessment.eligibleStock ?? '—')} ${item.primaryUnit}`
      : item.trackingMode === 'FIVE_LEVEL'
        ? `${stock ? (stock.currentLevel?.replaceAll('_', ' ').toLowerCase() ?? 'No current item here') : (item.currentLevel?.replaceAll('_', ' ').toLowerCase() ?? '—')} · ${stock?.backupCount ?? item.backupCount} backups`
        : `${stock ? (stock.isPresent === null ? 'No current item here' : stock.isPresent ? 'Present' : 'Absent') : item.isPresent ? 'Present' : 'Absent'} · ${stock?.backupCount ?? item.backupCount} backups`;
  return (
    <Link className="row inventory-row" to={`${base}/inventory/${item.id}`}>
      <ItemVisual name={item.name} />
      <span className="item-identity">
        <strong>{item.name}</strong>
        <small className="inventory-amount">{amount}</small>
        {(place ?? (stock ? '' : locationLabel(item, locations))) && (
          <small className="location-note">
            {place ?? locationLabel(item, locations)}
          </small>
        )}
      </span>
      <span className="item-status">
        <StockBadge status={stock?.lowStockRisk ?? assessment.lowStockRisk} />
        {(stock?.expiryRisk ?? assessment.expiryRisk) === 'USE_SOON' && (
          <StockBadge status="USE_SOON" />
        )}
      </span>
      <span className="row-arrow" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

export function InventoryPage() {
  const household = useHousehold();
  const location = useLocation();
  const routeState = location.state as {
    quickPurchaseDraft?: Partial<QuickPurchaseSeed>;
  } | null;
  const seed = routeState?.quickPurchaseDraft;
  const quickPurchaseSeed =
    seed && typeof seed.name === 'string' && typeof seed.quantity === 'string'
      ? (seed as QuickPurchaseSeed)
      : undefined;
  const [urlParams] = useSearchParams();
  const [shoppingDate, setShoppingDate] = useState('');
  const [search, setSearch] = useState(() => urlParams.get('q') ?? '');
  const [status, setStatus] = useState('ALL');
  const [groupBy, setGroupBy] = useState('location');
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [tagId, setTagId] = useState('');
  const params = new URLSearchParams({ groupBy, status });
  if (search.trim()) params.set('q', search.trim());
  if (categoryId) params.set('categoryId', categoryId);
  if (locationId) params.set('locationId', locationId);
  if (tagId) params.set('tagId', tagId);
  const query = params.toString();
  const hasFilters =
    !!search.trim() ||
    status !== 'ALL' ||
    !!categoryId ||
    !!locationId ||
    !!tagId;
  const inventory = useQuery({
    queryKey: keys.inventoryRead(household.id, query),
    queryFn: async () => {
      const result = await api<InventoryRead | Item[]>(
        `/households/${household.id}/items?${query}`,
      );
      if (
        Array.isArray(result) ||
        !result ||
        !Array.isArray(result.items) ||
        (groupBy !== 'none' && !Array.isArray(result.groups))
      ) {
        throw new Error(
          'The API did not return the queried Inventory response.',
        );
      }
      return result;
    },
  });
  const categories = useQuery({
    queryKey: keys.catalog(household.id, 'categories'),
    queryFn: () =>
      api<CatalogOption[]>(`/households/${household.id}/categories`),
  });
  const locations = useQuery({
    queryKey: keys.catalog(household.id, 'locations'),
    queryFn: () =>
      api<CatalogOption[]>(`/households/${household.id}/locations`),
  });
  const tags = useQuery({
    queryKey: keys.catalog(household.id, 'tags'),
    queryFn: () => api<CatalogOption[]>(`/households/${household.id}/tags`),
  });
  const intelligence = useQuery({
    queryKey: keys.intelligence(household.id, shoppingDate),
    queryFn: () =>
      api<Intelligence>(
        `/households/${household.id}/stock-intelligence${shoppingDate ? `?shoppingDate=${shoppingDate}` : ''}`,
      ),
  });
  const base = `/households/${household.id}`;
  // These values are accepted by the queried Inventory endpoint, including OPENED.
  const quickFilters = [
    { value: 'ALL', label: 'All' },
    { value: 'LOW', label: 'Low' },
    { value: 'EXPIRING', label: 'Expiring' },
    { value: 'OPENED', label: 'Opened' },
  ];
  const hasAdvancedFilters =
    !quickFilters.some((filter) => filter.value === status) ||
    !!categoryId ||
    !!locationId ||
    !!tagId ||
    groupBy !== 'location';

  return (
    <div className="inventory-page">
      <div className="grid inventory-grid">
        <section className="inventory-list" aria-label="Household items">
          {locations.data?.length ? (
            <Card className="location-check-launch">
              <div>
                <p className="eyebrow">Quick stock check</p>
                <h2>Check by location</h2>
                <p className="muted">
                  Walk through one place at a time, independently of Shopping
                  Trips.
                </p>
              </div>
              <div className="location-check-links">
                {locations.data.map((entry) => (
                  <Link
                    className="secondary"
                    key={entry.id}
                    to={`${base}/locations/${entry.id}/check`}
                  >
                    Check {entry.name} <span aria-hidden="true">›</span>
                  </Link>
                ))}
              </div>
            </Card>
          ) : locations.isPending ? (
            <p className="muted" role="status">
              Loading locations…
            </p>
          ) : locations.isError ? (
            <Notice kind="error">
              Locations for stock checks could not be loaded:{' '}
              {locations.error.message}
            </Notice>
          ) : null}
          <label className="inventory-search">
            <span className="sr-only">Search items</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search items, e.g. milk, rice, eggs…"
            />
          </label>
          <div
            className="inventory-quick-filters"
            role="group"
            aria-label="Quick stock filters"
          >
            {quickFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`inventory-filter-pill inventory-filter-${filter.value.toLowerCase()}${status === filter.value ? ' selected' : ''}`}
                aria-pressed={status === filter.value}
                onClick={() => setStatus(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <details className="inventory-filter-details">
            <summary>
              More filters{hasAdvancedFilters ? ' · active' : ''}
            </summary>
            <div className="inventory-controls">
              <label>
                Status
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="ALL">All</option>
                  <option value="LOW">Low or needs buying</option>
                  <option value="BUY">Buy</option>
                  <option value="OUT">Out</option>
                  <option value="OK">OK</option>
                  <option value="EXPIRING">Expiring</option>
                  <option value="OPENED">Opened</option>
                </select>
              </label>
              <label>
                Group by
                <select
                  value={groupBy}
                  onChange={(event) => setGroupBy(event.target.value)}
                >
                  <option value="location">Location</option>
                  <option value="category">Category</option>
                  <option value="none">No grouping</option>
                </select>
              </label>
              <label>
                Category
                <select
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  disabled={categories.isPending || categories.isError}
                >
                  <option value="">All categories</option>
                  {categories.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Location
                <select
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  disabled={locations.isPending || locations.isError}
                >
                  <option value="">All locations</option>
                  {locations.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tag
                <select
                  value={tagId}
                  onChange={(event) => setTagId(event.target.value)}
                  disabled={tags.isPending || tags.isError}
                >
                  <option value="">All tags</option>
                  {tags.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          {(categories.isPending || locations.isPending || tags.isPending) && (
            <p className="muted" role="status">
              Loading filter options…
            </p>
          )}
          {[categories, locations, tags]
            .filter((result) => result.isError)
            .map((result, index) => (
              <Notice kind="error" key={index}>
                A catalog filter could not load: {result.error?.message}
              </Notice>
            ))}
          {inventory.isPending ? (
            <p className="muted" role="status">
              Loading inventory…
            </p>
          ) : inventory.isError ? (
            <Notice kind="error">{inventory.error.message}</Notice>
          ) : inventory.data.items.length === 0 ? (
            <div className="empty">
              <ItemVisual name="Inventory" large />
              <h3>{hasFilters ? 'No matching items' : 'No items yet'}</h3>
              <p>
                {hasFilters
                  ? 'Try a different search or filter.'
                  : 'Add an item with its starting stock or state.'}
              </p>
              <a className="link" href="#add-item">
                Add an item
              </a>
            </div>
          ) : groupBy === 'none' ? (
            <div className="inventory-ungrouped">
              {inventory.data.items.map(({ item, assessment }) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  assessment={assessment}
                  base={base}
                  locations={locations.data}
                />
              ))}
            </div>
          ) : (
            inventory.data.groups?.map((group) => (
              <details
                className="inventory-group"
                key={group.id ?? 'unlocated'}
                open
              >
                <summary className="inventory-group-heading">
                  <Doodle kind="inventory" />
                  <span className="inventory-group-title">{group.name}</span>
                  <span className="inventory-group-count">
                    {group.entries.length}{' '}
                    {group.entries.length === 1 ? 'item' : 'items'}
                  </span>
                  <span className="inventory-group-chevron" aria-hidden="true">
                    ⌃
                  </span>
                </summary>
                {group.entries.map((entry) => {
                  const match = inventory.data.items.find(
                    ({ item }) => item.id === entry.itemId,
                  );
                  return (
                    match && (
                      <ItemRow
                        key={entry.itemId}
                        item={match.item}
                        assessment={match.assessment}
                        base={base}
                        place={
                          groupBy === 'location'
                            ? undefined
                            : locationLabel(match.item, locations.data)
                        }
                        stock={groupBy === 'location' ? entry : undefined}
                      />
                    )
                  );
                })}
              </details>
            ))
          )}
          <a className="primary inventory-add-button" href="#add-item">
            <span aria-hidden="true">＋</span> Add item
          </a>
        </section>
        <AddItemForm
          household={household}
          quickPurchaseSeed={quickPurchaseSeed}
        />
      </div>
      <div className="insight-strip">
        {intelligence.data && intelligence.data.useSoon.length > 0 && (
          <Card className="use-soon">
            <p className="eyebrow">Use Soon</p>
            <h2>
              {intelligence.data.useSoon.length}{' '}
              {intelligence.data.useSoon.length === 1 ? 'item' : 'items'} to
              check
            </h2>
            {intelligence.data.useSoon.slice(0, 4).map((entry) => (
              <Link
                className="insight-row"
                key={entry.itemId}
                to={`${base}/inventory/${entry.itemId}`}
              >
                <strong>{entry.name}</strong>
                <span>{entry.expiryReason}</span>
              </Link>
            ))}
          </Card>
        )}
        <Card className="suggestions">
          <div className="suggestion-heading">
            <div>
              <p className="eyebrow">Shopping suggestions</p>
              <h2>
                {intelligence.data?.suggestions.length ?? '—'} items suggested
              </h2>
            </div>
            <label>
              Shopping date
              <input
                type="date"
                value={shoppingDate || intelligence.data?.shoppingDate || ''}
                onChange={(event) => setShoppingDate(event.target.value)}
              />
            </label>
          </div>
          {intelligence.isPending ? (
            <p className="muted">Loading stock assessment…</p>
          ) : intelligence.isError ? (
            <Notice kind="error">{intelligence.error.message}</Notice>
          ) : intelligence.data.suggestions.length === 0 ? (
            <p className="muted">
              Nothing to buy based on current stock and item rules.
            </p>
          ) : (
            intelligence.data.suggestions.map((entry) => (
              <div className="suggestion-row" key={entry.itemId}>
                <div>
                  <strong>
                    {entry.name}{' '}
                    <span className="priority">
                      {entry.suggestion?.priority === 'MUST_BUY'
                        ? 'Must buy'
                        : 'Should buy'}
                    </span>
                  </strong>
                  <small>{entry.suggestion?.reason}</small>
                </div>
                <span>
                  {entry.suggestion?.quantity} {entry.primaryUnit}
                </span>
              </div>
            ))
          )}
          <p className="muted">
            Suggestions are a starting quantity. Enter actual purchases in a
            Shopping Trip.
          </p>
        </Card>
      </div>
    </div>
  );
}
