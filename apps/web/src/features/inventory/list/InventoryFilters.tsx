import { Link } from 'react-router';
import type { CatalogOption } from '@/shared/api/types';
import { Notice } from '@/shared/ui/primitives';
import { ControlIcon } from '@/shared/ui/ControlIcon';
import { tr } from '@/shared/i18n';
import { localizedError } from '@/shared/i18n';
import { INVENTORY_QUICK_FILTERS } from './inventoryFilterOptions';

export function InventoryFilters({
  base,
  search,
  onSearchChange,
  status,
  onStatusChange,
  groupBy,
  onGroupByChange,
  categoryId,
  onCategoryChange,
  locationId,
  onLocationChange,
  tagId,
  onTagChange,
  hasAdvancedFilters,
  categories,
  locations,
  tags,
}: {
  base: string;
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  groupBy: string;
  onGroupByChange: (value: string) => void;
  categoryId: string;
  onCategoryChange: (value: string) => void;
  locationId: string;
  onLocationChange: (value: string) => void;
  tagId: string;
  onTagChange: (value: string) => void;
  hasAdvancedFilters: boolean;
  categories: {
    data?: CatalogOption[];
    isPending: boolean;
    isError: boolean;
    error: Error | null;
  };
  locations: {
    data?: CatalogOption[];
    isPending: boolean;
    isError: boolean;
    error: Error | null;
  };
  tags: {
    data?: CatalogOption[];
    isPending: boolean;
    isError: boolean;
    error: Error | null;
  };
}) {
  return (
    <>
      <label className="inventory-search">
        <span className="sr-only">{tr('inventory:searchItems')}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={tr('inventory:searchItemsPrompt')}
        />
        <ControlIcon name="search" className="inventory-search-icon" />
      </label>
      <div
        className="inventory-quick-filters"
        role="group"
        aria-label={tr('inventory:quickStockFilters')}
      >
        {INVENTORY_QUICK_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={`inventory-filter-pill inventory-filter-${filter.value.toLowerCase()}${status === filter.value ? ' selected' : ''}`}
            aria-pressed={status === filter.value}
            onClick={() => onStatusChange(filter.value)}
          >
            {tr(filter.label)}
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
              onChange={(event) => onStatusChange(event.target.value)}
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
              onChange={(event) => onGroupByChange(event.target.value)}
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
              onChange={(event) => onCategoryChange(event.target.value)}
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
              onChange={(event) => onLocationChange(event.target.value)}
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
              onChange={(event) => onTagChange(event.target.value)}
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
        <section
          className="inventory-filter-stock-check"
          aria-labelledby="inventory-check-location-heading"
        >
          <h3 id="inventory-check-location-heading">
            {tr('inventory:checkLocation')}
          </h3>
          <p className="muted">{tr('inventory:checkLocationHint')}</p>
          {locations.data?.length ? (
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
          ) : locations.isPending ? (
            <p className="muted" role="status">
              {tr('common:loadingLocations')}
            </p>
          ) : locations.isError ? (
            <Notice kind="error">
              {tr('inventory:locationsStockChecks')}{' '}
              {localizedError(locations.error)}
            </Notice>
          ) : (
            <p className="muted">{tr('inventory:noCheckLocations')}</p>
          )}
        </section>
      </details>
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
    </>
  );
}
