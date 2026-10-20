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

import { tr } from '../../shared/i18n';
import { localizedError } from '../../shared/i18n';
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
        setError(tr('item-detail:lifecycleSavedRefreshWarning'));
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'ACTIVE_TRIP_ENTRY') {
        setBlockers(cause.tripIds);
        setError(tr('item-detail:archiveBlockedGuidance'));
      } else {
        setError(
          cause instanceof OfflineBeforeSendError
            ? localizedError(cause)
            : isMutationOutcomeUnknown(cause)
              ? tr('item-detail:lifecycleOutcomeUncertain')
              : cause instanceof Error
                ? `Change was not saved: ${localizedError(cause)}`
                : tr('item-detail:lifecycleChangeRejected'),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const base = `/households/${householdId}/items/${item.id}`;
  return (
    <Card>
      <h2>
        {item.archivedAt
          ? tr('common:archivedItem')
          : tr('item-detail:manageItem')}
      </h2>
      {notice && <Notice kind="success">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {blockers.length > 0 && (
        <ul>
          {blockers.map((tripId) => (
            <li key={tripId}>
              <Link to={`/households/${householdId}/shopping/${tripId}`}>
                {tr('item-detail:openBlockingTrip')} {tripId}
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
          {busy
            ? tr('common:restoring')
            : tr('item-detail:restoreActiveInventory')}
        </Button>
      ) : (
        <>
          <details>
            <summary>{tr('item-detail:editNameOrganization')}</summary>
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
                {tr('common:name')}
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
                  {tr('common:categoriesLoad')}{' '}
                  {localizedError(categories.error)}
                </Notice>
              )}
              <label>
                {tr('common:category')}
                <select
                  value={categoryId}
                  disabled={busy || !categories.data}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">{tr('item-detail:category2')}</option>
                  {categories.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              {tags.isError && (
                <Notice kind="error">
                  {tr('common:tagsLoad')} {localizedError(tags.error)}
                </Notice>
              )}
              <fieldset disabled={busy || !tags.data}>
                <legend>{tr('common:tags')}</legend>
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
                  <p className="muted">{tr('common:tagsYet')}</p>
                )}
              </fieldset>
              {locations.isError && (
                <Notice kind="error">
                  {tr('common:locationsLoad')} {localizedError(locations.error)}
                </Notice>
              )}
              <label>
                {tr('item-detail:preferredRestockLocation')}
                <select
                  value={preferredId}
                  disabled={busy || !locations.data}
                  onChange={(event) => setPreferredId(event.target.value)}
                >
                  <option value="">{tr('common:preference')}</option>
                  {locations.data?.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                {tr('item-detail:preferenceAffectsFuture')}
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
                {busy ? tr('common:saving') : tr('item-detail:saveItemDetails')}
              </Button>
            </form>
          </details>
          <details>
            <summary>{tr('item-detail:archiveItem')}</summary>
            <p className="muted">{tr('item-detail:removeActiveInventory')}</p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void submit(`${base}/archive`, 'POST')}
            >
              {busy ? tr('item-detail:archiving') : tr('common:archive')}
            </Button>
          </details>
        </>
      )}
    </Card>
  );
}
