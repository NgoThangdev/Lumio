import { useEffect, useRef, useState } from 'react';
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
import { ArchivedItems } from './ArchivedItems';

import { tr } from '../../shared/i18n';
import {
  localizedError,
  localizedEnum,
  formatNumber,
  formatDateOnly,
} from '../../shared/i18n';
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
        ? tr('inventory:seeBatchLocations')
        : tr('common:locationSet');
  }
  if (item.currentLocation?.name)
    return `${tr('common:current')} ${item.currentLocation.name}`;
  if (item.backupLocation?.name)
    return `${tr('common:backups')} ${item.backupLocation.name}`;
  return tr('common:locationSet');
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
      ? `${formatNumber(stock ? (stock.quantity ?? '—') : (assessment.eligibleStock ?? '—'))} ${item.primaryUnit}`
      : item.trackingMode === 'FIVE_LEVEL'
        ? `${stock ? (stock.currentLevel ? localizedEnum(stock.currentLevel) : tr('inventory:currentItemHere')) : item.currentLevel ? localizedEnum(item.currentLevel) : '—'} · ${formatNumber(stock?.backupCount ?? item.backupCount)} ${tr('common:backups2')}`
        : `${stock ? (stock.isPresent === null ? tr('inventory:currentItemHere') : tr(stock.isPresent ? 'common:present' : 'common:absent')) : tr(item.isPresent ? 'common:present' : 'common:absent')} · ${formatNumber(stock?.backupCount ?? item.backupCount)} ${tr('common:backups2')}`;
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
  const initialAddItemScrollHandled = useRef(false);
  const routeState = location.state as {
    quickPurchaseDraft?: Partial<QuickPurchaseSeed>;
  } | null;
  const seed = routeState?.quickPurchaseDraft;
  const quickPurchaseSeed =
    seed && typeof seed.name === 'string' && typeof seed.quantity === 'string'
      ? (seed as QuickPurchaseSeed)
      : undefined;
  const [urlParams, setUrlParams] = useSearchParams();
  const [shoppingDate, setShoppingDate] = useState('');
  const [search, setSearch] = useState(() => urlParams.get('q') ?? '');
  const [status, setStatus] = useState(() => urlParams.get('status') ?? 'ALL');
  const [groupBy, setGroupBy] = useState(
    () => urlParams.get('groupBy') ?? 'location',
  );
  const [categoryId, setCategoryId] = useState(
    () => urlParams.get('categoryId') ?? '',
  );
  const locationId = urlParams.get('locationId') ?? '';
  const setLocationId = (nextId: string) => {
    setUrlParams((current) => {
      const next = new URLSearchParams(current);
      if (nextId) next.set('locationId', nextId);
      else next.delete('locationId');
      return next;
    });
  };
  const [tagId, setTagId] = useState(() => urlParams.get('tagId') ?? '');
  const setInventoryParam = (name: string, value: string, fallback: string) => {
    setUrlParams((current) => {
      const next = new URLSearchParams(current);
      if (value && value !== fallback) next.set(name, value);
      else next.delete(name);
      return next;
    });
  };
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
        throw new Error(tr('inventory:inventoryResponseMissing'));
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
  const inventoryPageReady =
    !inventory.isPending &&
    !categories.isPending &&
    !locations.isPending &&
    !tags.isPending;
  useEffect(() => {
    if (initialAddItemScrollHandled.current || !inventoryPageReady) return;
    initialAddItemScrollHandled.current = true;
    if (window.location.hash !== '#add-item') return;
    const target = document.getElementById('add-item');
    if (!target) return;
    window.requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }, [inventoryPageReady, location.hash]);
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
        <section
          className="inventory-list"
          aria-label={tr('inventory:householdItems')}
        >
          <label className="inventory-search">
            <span className="sr-only">{tr('inventory:searchItems')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setInventoryParam('q', event.target.value.trim(), '');
              }}
              placeholder={tr('inventory:searchItemsPrompt')}
            />
          </label>
          <div
            className="inventory-quick-filters"
            role="group"
            aria-label={tr('inventory:quickStockFilters')}
          >
            {quickFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`inventory-filter-pill inventory-filter-${filter.value.toLowerCase()}${status === filter.value ? ' selected' : ''}`}
                aria-pressed={status === filter.value}
                onClick={() => {
                  setStatus(filter.value);
                  setInventoryParam('status', filter.value, 'ALL');
                }}
              >
                {tr(filter.label as Parameters<typeof tr>[0])}
              </button>
            ))}
          </div>
          <details className="inventory-filter-details">
            <summary>
              {tr('inventory:filters')}
              {hasAdvancedFilters ? ` · ${tr('inventory:activeFilter')}` : ''}
            </summary>
            <div className="inventory-controls">
              <label>
                {tr('common:status')}
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setInventoryParam('status', event.target.value, 'ALL');
                  }}
                >
                  <option value="ALL">{tr('common:all')}</option>
                  <option value="LOW">{tr('inventory:lowNeedsBuying')}</option>
                  <option value="BUY">{tr('inventory:buy2')}</option>
                  <option value="OUT">{tr('inventory:out2')}</option>
                  <option value="OK">{tr('common:ok')}</option>
                  <option value="EXPIRING">{tr('inventory:expiring2')}</option>
                  <option value="OPENED">{tr('common:opened')}</option>
                </select>
              </label>
              <label>
                {tr('inventory:group')}
                <select
                  value={groupBy}
                  onChange={(event) => {
                    setGroupBy(event.target.value);
                    setInventoryParam(
                      'groupBy',
                      event.target.value,
                      'location',
                    );
                  }}
                >
                  <option value="location">{tr('common:location')}</option>
                  <option value="category">{tr('common:category')}</option>
                  <option value="none">{tr('inventory:grouping')}</option>
                </select>
              </label>
              <label>
                {tr('common:category')}
                <select
                  value={categoryId}
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    setInventoryParam('categoryId', event.target.value, '');
                  }}
                  disabled={categories.isPending || categories.isError}
                >
                  <option value="">{tr('inventory:allCategories')}</option>
                  {categories.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr('common:location')}
                <select
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                  disabled={locations.isPending || locations.isError}
                >
                  <option value="">{tr('inventory:allLocations')}</option>
                  {locations.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr('common:tag')}
                <select
                  value={tagId}
                  onChange={(event) => {
                    setTagId(event.target.value);
                    setInventoryParam('tagId', event.target.value, '');
                  }}
                  disabled={tags.isPending || tags.isError}
                >
                  <option value="">{tr('inventory:allTags')}</option>
                  {tags.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          {locations.data?.length ? (
            <details className="location-check-launch">
              <summary>{tr('inventory:checkLocation')}</summary>
              <div className="location-check-links">
                {locations.data.map((entry) => (
                  <Link
                    className="secondary"
                    key={entry.id}
                    to={`${base}/locations/${entry.id}/check`}
                  >
                    {tr('common:check')} {entry.name}
                  </Link>
                ))}
              </div>
            </details>
          ) : locations.isPending ? (
            <p className="muted" role="status">
              {tr('common:loadingLocations')}
            </p>
          ) : locations.isError ? (
            <Notice kind="error">
              {tr('inventory:locationsStockChecks')}{' '}
              {localizedError(locations.error)}
            </Notice>
          ) : null}
          {locationId && (
            <div className="inventory-active-location">
              <span>
                {tr('inventory:showing')}{' '}
                {locations.data?.find((entry) => entry.id === locationId)
                  ?.name ?? tr('inventory:selectedLocation')}
              </span>
              <button type="button" onClick={() => setLocationId('')}>
                {tr('inventory:clearLocation')}
              </button>
            </div>
          )}
          {(categories.isPending || locations.isPending || tags.isPending) && (
            <p className="muted" role="status">
              {tr('inventory:loadingFilterOptions')}
            </p>
          )}
          {[categories, locations, tags]
            .filter((result) => result.isError)
            .map((result, index) => (
              <Notice kind="error" key={index}>
                {tr('inventory:catalogFilterLoad')} {result.error?.message}
              </Notice>
            ))}
          {inventory.isPending ? (
            <p className="muted" role="status">
              {tr('common:loadingInventory')}
            </p>
          ) : inventory.isError ? (
            <Notice kind="error">{localizedError(inventory.error)}</Notice>
          ) : inventory.data.items.length === 0 ? (
            <div className="empty">
              <ItemVisual name="Inventory" large />
              <h3>
                {hasFilters
                  ? tr('inventory:matchingItems')
                  : tr('common:itemsYet')}
              </h3>
              <p>
                {hasFilters
                  ? tr('inventory:tryDifferentSearch')
                  : tr('inventory:addItemStarting')}
              </p>
              <a className="link" href="#add-item">
                {tr('inventory:addItem')}
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
                    {tr(
                      group.entries.length === 1
                        ? 'common:item'
                        : 'common:items',
                    )}
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
            <span aria-hidden="true">＋</span> {tr('inventory:addItem2')}
          </a>
        </section>
        <AddItemForm
          household={household}
          quickPurchaseSeed={quickPurchaseSeed}
        />
      </div>
      {household.role === 'ADMIN' && (
        <ArchivedItems householdId={household.id} />
      )}
      <div className="insight-strip">
        {intelligence.data && intelligence.data.useSoon.length > 0 && (
          <Card className="use-soon">
            <p className="eyebrow">{tr('common:useSoon2')}</p>
            <h2>
              {intelligence.data.useSoon.length}{' '}
              {tr(
                intelligence.data.useSoon.length === 1
                  ? 'common:item'
                  : 'common:items',
              )}{' '}
              {tr('common:check2')}
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
              <p className="eyebrow">{tr('common:shoppingSuggestions')}</p>
              <h2>
                {intelligence.data
                  ? `${intelligence.data.suggestions.length} ${tr(intelligence.data.suggestions.length === 1 ? 'common:item' : 'common:items')} suggested`
                  : '—'}
              </h2>
            </div>
            <label>
              {tr('common:shoppingDate')}
              <input
                type="date"
                value={shoppingDate || intelligence.data?.shoppingDate || ''}
                onChange={(event) => setShoppingDate(event.target.value)}
              />
            </label>
          </div>
          {intelligence.data && (
            <p className="muted">
              {tr('inventory:assessmentDate')}{' '}
              {formatDateOnly(intelligence.data.shoppingDate)}{' '}
              {tr('inventory:lumioSStock')}
            </p>
          )}
          {intelligence.isPending ? (
            <p className="muted">{tr('common:loadingStockAssessment')}</p>
          ) : intelligence.isError ? (
            <Notice kind="error">{localizedError(intelligence.error)}</Notice>
          ) : intelligence.data.suggestions.length === 0 ? (
            <p className="muted">{tr('common:nothingBuyBased')}</p>
          ) : (
            intelligence.data.suggestions.map((entry) => (
              <div className="suggestion-row" key={entry.itemId}>
                <div>
                  <strong>
                    {entry.name}{' '}
                    <span className="priority">
                      {entry.suggestion?.priority === 'MUST_BUY'
                        ? tr('common:buy3')
                        : tr('common:buy4')}
                    </span>
                  </strong>
                  <small>{localizedEnum(entry.suggestion?.reason)}</small>
                </div>
                <span>
                  {formatNumber(entry.suggestion?.quantity ?? 0)}{' '}
                  {entry.primaryUnit}
                </span>
              </div>
            ))
          )}
          <p className="muted">{tr('inventory:suggestionsStartingQuantity')}</p>
        </Card>
      </div>
    </div>
  );
}
