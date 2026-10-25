import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  api,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  CatalogOption,
  CategoryOption,
  Household,
  Item,
  StockLevel,
  TrackingMode,
} from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';

import { tr } from '../../shared/i18n';
import { localizedError } from '../../shared/i18n';
type CatalogKind = 'categories' | 'locations' | 'tags';

export type QuickPurchaseSeed = { name: string; quantity: string };

function CatalogCreate({
  householdId,
  kind,
  onCreated,
}: {
  householdId: string;
  kind: CatalogKind;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const singular =
    kind === 'categories'
      ? 'category'
      : kind === 'locations'
        ? 'location'
        : 'tag';
  const create = useMutation({
    mutationFn: () =>
      api<CatalogOption>(`/households/${householdId}/${kind}`, 'POST', {
        name,
      }),
    onSuccess: async (option) => {
      await queryClient.invalidateQueries({
        queryKey: keys.catalog(householdId, kind),
      });
      onCreated(option.id);
      setName('');
    },
  });
  return (
    <div className="catalog-create">
      {create.isError && (
        <Notice kind="error">{localizedError(create.error)}</Notice>
      )}
      <label>
        {tr('common:new')} {singular} {tr('common:name2')}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (name.trim() && !create.isPending) create.mutate();
            }
          }}
          maxLength={80}
          placeholder={`e.g. ${kind === 'categories' ? 'Food' : kind === 'locations' ? tr('common:pantry') : 'Everyday'}`}
        />
      </label>
      <Button
        type="button"
        variant="secondary"
        disabled={create.isPending || !name.trim()}
        onClick={() => create.mutate()}
      >
        {create.isPending ? tr('inventory:adding') : `Add ${singular}`}
      </Button>
    </div>
  );
}

export function AddItemForm({
  household,
  quickPurchaseSeed,
}: {
  household: Household;
  quickPurchaseSeed?: QuickPurchaseSeed;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(quickPurchaseSeed?.name ?? '');
  const [manualUnit, setManualUnit] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState<TrackingMode | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(quickPurchaseSeed?.quantity ?? '');
  const [expiry, setExpiry] = useState('');
  const [level, setLevel] = useState<StockLevel | ''>('');
  const [present, setPresent] = useState('');
  const [backupCount, setBackupCount] = useState(quickPurchaseSeed ? '' : '0');
  const base = `/households/${household.id}`;
  const categories = useQuery({
    queryKey: keys.catalog(household.id, 'categories'),
    queryFn: () => api<CategoryOption[]>(`${base}/categories`),
  });
  const selectedCategory = categories.data?.find(
    (entry) => entry.id === categoryId,
  );
  const mode =
    manualMode ?? selectedCategory?.defaultTrackingMode ?? 'QUANTITY';
  const unit = manualUnit ?? selectedCategory?.defaultPrimaryUnit ?? '';
  const locations = useQuery({
    queryKey: keys.catalog(household.id, 'locations'),
    queryFn: () => api<CatalogOption[]>(`${base}/locations`),
  });
  const tags = useQuery({
    queryKey: keys.catalog(household.id, 'tags'),
    queryFn: () => api<CatalogOption[]>(`${base}/tags`),
  });
  const create = useMutation({
    mutationFn: () => {
      const initialStock =
        mode === 'QUANTITY'
          ? {
              quantity,
              ...(expiry && quantity !== '0' ? { expiryDate: expiry } : {}),
            }
          : mode === 'FIVE_LEVEL'
            ? { level, backupCount: Number(backupCount) }
            : { present: present === 'true', backupCount: Number(backupCount) };
      return api<Item>(`${base}/items`, 'POST', {
        name,
        primaryUnit: unit,
        trackingMode: mode,
        categoryId,
        locationId,
        ...(tagIds.length ? { tagIds } : {}),
        initialStock,
      });
    },
    onSuccess: async (created) => {
      const refreshes = await Promise.allSettled([
        queryClient.invalidateQueries(
          { queryKey: keys.items(household.id), refetchType: 'all' },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          {
            queryKey: ['household', household.id, 'intelligence'],
            refetchType: 'all',
          },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: keys.needsAttention(household.id), refetchType: 'all' },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: keys.recentActivity(household.id), refetchType: 'all' },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          {
            queryKey: keys.catalog(household.id, 'categories'),
            refetchType: 'all',
          },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          {
            queryKey: keys.catalog(household.id, 'locations'),
            refetchType: 'all',
          },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: keys.catalog(household.id, 'tags'), refetchType: 'all' },
          { throwOnError: true },
        ),
      ]);
      const refreshWarning = refreshes.some(
        (result) => result.status === 'rejected',
      )
        ? tr('inventory:itemCreatedRefreshWarning')
        : '';
      void navigate(`${base}/inventory/${created.id}`, {
        state: { notice: `Item created.${refreshWarning}` },
      });
    },
  });
  const quickQuantityValid =
    !quickPurchaseSeed ||
    mode !== 'QUANTITY' ||
    (/^\d+(?:\.\d{1,6})?$/.test(quantity) && Number(quantity) > 0);
  const canSubmit =
    !!categoryId &&
    !!locationId &&
    !categories.isPending &&
    !locations.isPending &&
    !categories.isError &&
    !locations.isError &&
    !create.isPending &&
    quickQuantityValid;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) create.mutate();
  };

  return (
    <Card className="create-card" id="add-item">
      <p className="eyebrow">{tr('inventory:makeLittleRoom')}</p>
      <h2 id="add-item-heading">{tr('inventory:addSomethingHome')}</h2>
      <p className="muted">{tr('inventory:choosePlaceStarting')}</p>
      {create.isError && (
        <Notice kind="error">
          {create.error instanceof OfflineBeforeSendError
            ? localizedError(create.error)
            : isMutationOutcomeUnknown(create.error)
              ? `The item request outcome is unknown. It may already have been saved. Check Inventory or Item Detail activity before choosing to retry. ${localizedError(create.error)}`
              : `Item creation was rejected. The form is still available. ${localizedError(create.error)}`}
        </Notice>
      )}
      <form onSubmit={submit}>
        <label>
          {tr('common:itemName')}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={tr('inventory:riceExample')}
            required
          />
        </label>
        <label>
          {tr('inventory:trackingMode')}
          <select
            value={mode}
            onChange={(event) =>
              setManualMode(event.target.value as TrackingMode)
            }
          >
            <option value="QUANTITY">{tr('common:quantity')}</option>
            <option value="FIVE_LEVEL">{tr('inventory:fiveLevels')}</option>
            <option value="PRESENCE_BACKUP">
              {tr('inventory:presentBackups')}
            </option>
          </select>
        </label>
        <label>
          {tr('common:primaryUnit')}
          <input
            value={unit}
            onChange={(event) => setManualUnit(event.target.value)}
            placeholder={
              mode === 'QUANTITY'
                ? tr('inventory:unitExample')
                : 'e.g. bottle, pack'
            }
            required
          />
        </label>
        <label>
          {tr('common:category')}
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
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
            <CatalogCreate
              householdId={household.id}
              kind="categories"
              onCreated={setCategoryId}
            />
          ) : (
            <details className="catalog-disclosure">
              <summary>{tr('inventory:addCategory')}</summary>
              <CatalogCreate
                householdId={household.id}
                kind="categories"
                onCreated={setCategoryId}
              />
            </details>
          ))}
        <label>
          {tr('common:location')}
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
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
            <CatalogCreate
              householdId={household.id}
              kind="locations"
              onCreated={setLocationId}
            />
          ) : (
            <details className="catalog-disclosure">
              <summary>{tr('inventory:addLocation')}</summary>
              <CatalogCreate
                householdId={household.id}
                kind="locations"
                onCreated={setLocationId}
              />
            </details>
          ))}

        {mode === 'QUANTITY' ? (
          <>
            <label>
              {tr('inventory:startingQuantity')}
              <input
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
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
                    onChange={(event) => setExpiry(event.target.value)}
                  />
                </label>
              </details>
            )}
          </>
        ) : (
          <>
            {mode === 'FIVE_LEVEL' ? (
              <label>
                {tr('common:currentLevel')}
                <select
                  value={level}
                  onChange={(event) =>
                    setLevel(event.target.value as StockLevel)
                  }
                  required
                >
                  <option value="">{tr('common:chooseLevel')}</option>
                  <option value="FULL">{tr('common:full2')}</option>
                  <option value="THREE_QUARTERS">¾</option>
                  <option value="HALF">½</option>
                  <option value="QUARTER">¼</option>
                  <option value="EMPTY">{tr('common:empty2')}</option>
                </select>
              </label>
            ) : (
              <label>
                {tr('common:currentItem')}
                <select
                  value={present}
                  onChange={(event) => setPresent(event.target.value)}
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
                onChange={(event) => setBackupCount(event.target.value)}
                required
              />
            </label>
          </>
        )}

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
          ) : tags.data.length === 0 ? (
            <p className="muted">{tr('common:tagsYet')}</p>
          ) : (
            tags.data.map((option) => (
              <label className="check-label" key={option.id}>
                <input
                  type="checkbox"
                  checked={tagIds.includes(option.id)}
                  onChange={(event) =>
                    setTagIds((current) =>
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
            <CatalogCreate
              householdId={household.id}
              kind="tags"
              onCreated={(id) => setTagIds((current) => [...current, id])}
            />
          )}
        </details>
        <p className="form-guidance" id="catalog-guidance" aria-live="polite">
          {categories.isPending || locations.isPending
            ? tr('common:loadingHouseholdS')
            : categories.isError || locations.isError
              ? tr('inventory:categoriesLocationsLoad')
              : !categoryId || !locationId
                ? `Choose ${!categoryId && !locationId ? 'a category and a location' : !categoryId ? 'a category' : 'a location'} to continue. ${household.role === 'ADMIN' ? tr('inventory:ifThereOptions') : tr('inventory:askHouseholdAdmin')}`
                : tr('inventory:readyCheckDetails')}
        </p>
        <Button
          className="wide"
          aria-describedby="catalog-guidance"
          disabled={!canSubmit}
        >
          {create.isPending ? tr('common:creating') : tr('common:createItem')}
        </Button>
      </form>
    </Card>
  );
}
