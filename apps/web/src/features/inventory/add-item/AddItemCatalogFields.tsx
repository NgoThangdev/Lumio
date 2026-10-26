import type {
  CatalogOption,
  CategoryOption,
  Household,
} from '@/shared/api/types';
import { Notice } from '@/shared/ui/primitives';
import { localizedError, tr } from '@/shared/i18n';
import { CatalogOptionCreator } from './CatalogOptionCreator';

type CatalogQuery<T> = {
  data?: T[];
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

export function AddItemCatalogFields({
  household,
  categories,
  locations,
  tags,
  categoryId,
  onCategoryChange,
  locationId,
  onLocationChange,
  tagIds,
  onTagIdsChange,
}: {
  household: Household;
  categories: CatalogQuery<CategoryOption>;
  locations: CatalogQuery<CatalogOption>;
  tags: CatalogQuery<CatalogOption>;
  categoryId: string;
  onCategoryChange: (id: string) => void;
  locationId: string;
  onLocationChange: (id: string) => void;
  tagIds: string[];
  onTagIdsChange: (update: (current: string[]) => string[]) => void;
}) {
  return (
    <>
      <label>
        {tr('common:category')}
        <select
          value={categoryId}
          onChange={(event) => onCategoryChange(event.target.value)}
          required
          disabled={categories.isPending || categories.isError}
        >
          <option value="">{tr('inventory:chooseCategory')}</option>
          {categories.data?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      {categories.isPending && (
        <p className="muted">{tr('common:loadingCategories')}</p>
      )}
      {categories.isError && (
        <Notice kind="error">
          {tr('common:categoriesLoaded')} {localizedError(categories.error)}
        </Notice>
      )}
      {categories.data?.length === 0 && household.role === 'MEMBER' && (
        <p className="muted">{tr('inventory:householdAdminNeeds')}</p>
      )}
      {household.role === 'ADMIN' &&
        (categories.data?.length === 0 ? (
          <CatalogOptionCreator
            householdId={household.id}
            kind="categories"
            onCreated={onCategoryChange}
          />
        ) : (
          <details className="catalog-disclosure">
            <summary>{tr('inventory:addCategory')}</summary>
            <CatalogOptionCreator
              householdId={household.id}
              kind="categories"
              onCreated={onCategoryChange}
            />
          </details>
        ))}

      <label>
        {tr('common:location')}
        <select
          value={locationId}
          onChange={(event) => onLocationChange(event.target.value)}
          required
          disabled={locations.isPending || locations.isError}
        >
          <option value="">{tr('common:chooseLocation')}</option>
          {locations.data?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      {locations.isPending && (
        <p className="muted">{tr('common:loadingLocations2')}</p>
      )}
      {locations.isError && (
        <Notice kind="error">
          {tr('common:locationsLoaded')} {localizedError(locations.error)}
        </Notice>
      )}
      {locations.data?.length === 0 && household.role === 'MEMBER' && (
        <p className="muted">{tr('inventory:householdAdminNeeds2')}</p>
      )}
      {household.role === 'ADMIN' &&
        (locations.data?.length === 0 ? (
          <CatalogOptionCreator
            householdId={household.id}
            kind="locations"
            onCreated={onLocationChange}
          />
        ) : (
          <details className="catalog-disclosure">
            <summary>{tr('inventory:addLocation')}</summary>
            <CatalogOptionCreator
              householdId={household.id}
              kind="locations"
              onCreated={onLocationChange}
            />
          </details>
        ))}

      <details className="catalog-disclosure">
        <summary>
          {tr('common:tags')} <em>{tr('common:optional2')}</em>
          {tagIds.length > 0 ? ` · ${tagIds.length} selected` : ''}
        </summary>
        {tags.isPending ? (
          <p className="muted">{tr('inventory:loadingTags')}</p>
        ) : tags.isError ? (
          <Notice kind="error">
            {tr('inventory:tagsLoaded')} {localizedError(tags.error)}
          </Notice>
        ) : tags.data?.length === 0 ? (
          <p className="muted">{tr('common:tagsYet')}</p>
        ) : (
          tags.data?.map((option) => (
            <label className="check-label" key={option.id}>
              <input
                type="checkbox"
                checked={tagIds.includes(option.id)}
                onChange={(event) =>
                  onTagIdsChange((current) =>
                    event.target.checked
                      ? [...current, option.id]
                      : current.filter((id) => id !== option.id),
                  )
                }
              />
              {option.name}
            </label>
          ))
        )}
        {household.role === 'ADMIN' && (
          <CatalogOptionCreator
            householdId={household.id}
            kind="tags"
            onCreated={(id) => onTagIdsChange((current) => [...current, id])}
          />
        )}
      </details>
    </>
  );
}
