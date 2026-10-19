import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  api,
  ApiError,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { CatalogOption, Item } from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';
import { refreshItemLifecycle } from './itemLifecycle';

export function ItemLifecyclePanel({
  householdId,
  item,
}: {
  householdId: string;
  item: Item;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.categoryId ?? '');
  const [tagIds, setTagIds] = useState<string[]>(
    item.tagLinks?.map((link) => link.tagId) ?? [],
  );
  const [preferredId, setPreferredId] = useState(
    item.preferredRestockLocationId ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blockers, setBlockers] = useState<string[]>([]);
  const categories = useQuery({
    queryKey: keys.catalog(householdId, 'categories'),
    queryFn: () =>
      api<CatalogOption[]>(`/households/${householdId}/categories`),
    enabled: !item.archivedAt,
  });
  const tags = useQuery({
    queryKey: keys.catalog(householdId, 'tags'),
    queryFn: () => api<CatalogOption[]>(`/households/${householdId}/tags`),
    enabled: !item.archivedAt,
  });
  const locations = useQuery({
    queryKey: keys.catalog(householdId, 'locations'),
    queryFn: () => api<CatalogOption[]>(`/households/${householdId}/locations`),
    enabled: !item.archivedAt,
  });

  async function submit(path: string, method: 'PATCH' | 'POST', body?: object) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setBlockers([]);
    try {
      const saved = await api<Item>(path, method, body);
      queryClient.setQueryData(keys.item(householdId, item.id), saved);
      setName(saved.name);
      setCategoryId(saved.categoryId ?? '');
      setTagIds(saved.tagLinks?.map((link) => link.tagId) ?? []);
      setPreferredId(saved.preferredRestockLocationId ?? '');
      const action =
        method === 'PATCH'
          ? 'Changes saved'
          : path.endsWith('/archive')
            ? 'Item archived'
            : 'Item restored';
      setNotice(`${action}.`);
      if (!(await refreshItemLifecycle(queryClient, householdId, item.id))) {
        setError(
          'Saved, but some views could not refresh. Reload to check the latest Inventory and Shopping data.',
        );
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'ACTIVE_TRIP_ENTRY') {
        setBlockers(cause.tripIds);
        setError(
          'Archive was not saved. Remove this item from each active trip explicitly, then choose Archive again.',
        );
      } else {
        setError(
          cause instanceof OfflineBeforeSendError
            ? cause.message
            : isMutationOutcomeUnknown(cause)
              ? 'The result is uncertain. Reload Item Detail and check history before choosing to retry.'
              : cause instanceof Error
                ? `Change was not saved: ${cause.message}`
                : 'Change was not saved.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const base = `/households/${householdId}/items/${item.id}`;
  return (
    <Card>
      <h2>{item.archivedAt ? 'Archived item' : 'Manage item'}</h2>
      {notice && <Notice kind="success">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {blockers.length > 0 && (
        <ul>
          {blockers.map((tripId) => (
            <li key={tripId}>
              <Link to={`/households/${householdId}/shopping/${tripId}`}>
                Open blocking trip {tripId}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {item.archivedAt ? (
        <Button
          disabled={busy}
          onClick={() => void submit(`${base}/restore`, 'POST')}
        >
          {busy ? 'Restoring…' : 'Restore to active Inventory'}
        </Button>
      ) : (
        <>
          <details>
            <summary>Edit name and organization</summary>
            <form
              className="field-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(base, 'PATCH', {
                  name: name.trim(),
                  categoryId: categoryId || null,
                  tagIds,
                  preferredRestockLocationId: preferredId || null,
                });
              }}
            >
              <label>
                Name
                <input
                  value={name}
                  maxLength={120}
                  required
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {categories.isError && (
                <Notice kind="error">
                  Categories could not load: {categories.error.message}
                </Notice>
              )}
              <label>
                Category
                <select
                  value={categoryId}
                  disabled={busy || !categories.data}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">No category</option>
                  {categories.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              {tags.isError && (
                <Notice kind="error">
                  Tags could not load: {tags.error.message}
                </Notice>
              )}
              <fieldset disabled={busy || !tags.data}>
                <legend>Tags</legend>
                {tags.data?.length ? (
                  tags.data.map((entry) => (
                    <label className="check-label" key={entry.id}>
                      <input
                        type="checkbox"
                        checked={tagIds.includes(entry.id)}
                        onChange={(event) =>
                          setTagIds((current) =>
                            event.target.checked
                              ? [...current, entry.id]
                              : current.filter((id) => id !== entry.id),
                          )
                        }
                      />
                      {entry.name}
                    </label>
                  ))
                ) : (
                  <p className="muted">No tags yet.</p>
                )}
              </fieldset>
              {locations.isError && (
                <Notice kind="error">
                  Locations could not load: {locations.error.message}
                </Notice>
              )}
              <label>
                Preferred restock location
                <select
                  value={preferredId}
                  disabled={busy || !locations.data}
                  onChange={(event) => setPreferredId(event.target.value)}
                >
                  <option value="">No preference</option>
                  {locations.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                This preference affects future stock writes. Existing batch
                locations stay as recorded.
              </p>
              <Button
                disabled={
                  busy ||
                  !categories.data ||
                  !tags.data ||
                  !locations.data ||
                  !name.trim()
                }
              >
                {busy ? 'Saving…' : 'Save item details'}
              </Button>
            </form>
          </details>
          <details>
            <summary>Archive item</summary>
            <p className="muted">
              Remove from active Inventory. Stock, batches, and history are
              retained; active stock actions become unavailable.
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void submit(`${base}/archive`, 'POST')}
            >
              {busy ? 'Archiving…' : 'Archive'}
            </Button>
          </details>
        </>
      )}
    </Card>
  );
}
