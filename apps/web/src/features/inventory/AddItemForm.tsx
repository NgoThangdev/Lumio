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
  Household,
  Item,
  StockLevel,
  TrackingMode,
} from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';

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
      {create.isError && <Notice kind="error">{create.error.message}</Notice>}
      <label>
        New {singular} name
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
          placeholder={`e.g. ${kind === 'categories' ? 'Food' : kind === 'locations' ? 'Pantry' : 'Everyday'}`}
        />
      </label>
      <Button
        type="button"
        variant="secondary"
        disabled={create.isPending || !name.trim()}
        onClick={() => create.mutate()}
      >
        {create.isPending ? 'Adding…' : `Add ${singular}`}
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
  const [unit, setUnit] = useState('');
  const [mode, setMode] = useState<TrackingMode>('QUANTITY');
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
    queryFn: () => api<CatalogOption[]>(`${base}/categories`),
  });
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
        ? ' The item was created, but some views could not refresh; check Inventory and Item Detail.'
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
      <p className="eyebrow">Make a little room</p>
      <h2>Add something to your home</h2>
      <p className="muted">
        Choose its place and starting stock. Everything is saved together.
      </p>
      {create.isError && (
        <Notice kind="error">
          {create.error instanceof OfflineBeforeSendError
            ? create.error.message
            : isMutationOutcomeUnknown(create.error)
              ? `The item request outcome is unknown. It may already have been saved. Check Inventory or Item Detail activity before choosing to retry. ${create.error.message}`
              : `Item creation was rejected. The form is still available. ${create.error.message}`}
        </Notice>
      )}
      <form onSubmit={submit}>
        <label>
          Item name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Rice"
            required
          />
        </label>
        <label>
          Tracking mode
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as TrackingMode)}
          >
            <option value="QUANTITY">Quantity</option>
            <option value="FIVE_LEVEL">Five levels</option>
            <option value="PRESENCE_BACKUP">Present + backups</option>
          </select>
        </label>
        <label>
          Primary unit
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            placeholder={
              mode === 'QUANTITY' ? 'e.g. kg, bottle' : 'e.g. bottle, pack'
            }
            required
          />
        </label>
        <label>
          Category
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            required
            disabled={categories.isPending || categories.isError}
          >
            <option value="">Choose a category</option>
            {categories.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        {categories.isPending && <p className="muted">Loading categories…</p>}
        {categories.isError && (
          <Notice kind="error">
            Categories could not be loaded: {categories.error.message}
          </Notice>
        )}
        {categories.data?.length === 0 && household.role === 'MEMBER' && (
          <p className="muted">
            A household Admin needs to add a category before you can create an
            item.
          </p>
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
              <summary>Add a category</summary>
              <CatalogCreate
                householdId={household.id}
                kind="categories"
                onCreated={setCategoryId}
              />
            </details>
          ))}
        <label>
          Location
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            required
            disabled={locations.isPending || locations.isError}
          >
            <option value="">Choose a location</option>
            {locations.data?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        {locations.isPending && <p className="muted">Loading locations…</p>}
        {locations.isError && (
          <Notice kind="error">
            Locations could not be loaded: {locations.error.message}
          </Notice>
        )}
        {locations.data?.length === 0 && household.role === 'MEMBER' && (
          <p className="muted">
            A household Admin needs to add a location before you can create an
            item.
          </p>
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
              <summary>Add a location</summary>
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
              Starting quantity
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
                ? 'This is the amount you bought; it will be saved as initial stock in the same request.'
                : 'Have none at home? Enter 0 and restock later.'}
            </p>
            {quantity !== '0' && (
              <details className="catalog-disclosure">
                <summary>
                  Expiry date <em>optional</em>
                </summary>
                <label>
                  Expiry date
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
                Current level
                <select
                  value={level}
                  onChange={(event) =>
                    setLevel(event.target.value as StockLevel)
                  }
                  required
                >
                  <option value="">Choose a level</option>
                  <option value="FULL">Full</option>
                  <option value="THREE_QUARTERS">¾</option>
                  <option value="HALF">½</option>
                  <option value="QUARTER">¼</option>
                  <option value="EMPTY">Empty</option>
                </select>
              </label>
            ) : (
              <label>
                Current item
                <select
                  value={present}
                  onChange={(event) => setPresent(event.target.value)}
                  required
                >
                  <option value="">Choose a state</option>
                  <option value="true">Present</option>
                  <option value="false">Absent</option>
                </select>
              </label>
            )}
            <label>
              Backup count
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
            Tags <em>optional</em>
            {tagIds.length > 0 ? ` · ${tagIds.length} selected` : ''}
          </summary>
          {tags.isPending ? (
            <p className="muted">Loading tags…</p>
          ) : tags.isError ? (
            <Notice kind="error">
              Tags could not be loaded: {tags.error.message}
            </Notice>
          ) : tags.data.length === 0 ? (
            <p className="muted">No tags yet.</p>
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
            ? 'Loading your household’s categories and locations…'
            : categories.isError || locations.isError
              ? 'Categories and locations must load before you can create an item.'
              : !categoryId || !locationId
                ? `Choose ${!categoryId && !locationId ? 'a category and a location' : !categoryId ? 'a category' : 'a location'} to continue. ${household.role === 'ADMIN' ? 'If there are no options, add one above.' : 'Ask a household Admin if an option is missing.'}`
                : 'Ready when you are. Check the details above, then create your item.'}
        </p>
        <Button
          className="wide"
          aria-describedby="catalog-guidance"
          disabled={!canSubmit}
        >
          {create.isPending ? 'Creating…' : 'Create item'}
        </Button>
      </form>
    </Card>
  );
}
