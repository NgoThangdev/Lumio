import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import {
  api,
  ApiError,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { CatalogOption, Item } from '@/shared/api/types';
import { Button, Card, Notice } from '@/shared/ui/primitives';
import {
  refreshAfterPermanentItemDeletion,
  refreshItemLifecycle,
} from './itemLifecycle';

import { tr } from '@/shared/i18n';
import { localizedError } from '@/shared/i18n';
export function ItemLifecyclePanel({
  householdId,
  item,
}: {
  householdId: string;
  item: Item;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
  const [deleteName, setDeleteName] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
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

  async function finishPermanentDeletion() {
    queryClient.removeQueries({
      queryKey: keys.item(householdId, item.id),
      exact: true,
    });
    const refreshed = await refreshAfterPermanentItemDeletion(
      queryClient,
      householdId,
    );
    void navigate(`/households/${householdId}/inventory`, {
      replace: true,
      state: {
        notice: refreshed
          ? tr('item-detail:deleteSuccess', { name: item.name })
          : tr('item-detail:deleteSavedRefreshWarning'),
      },
    });
  }

  async function reconcileUncertainDeletion() {
    const [archivedResult, detailResult] = await Promise.allSettled([
      api<Array<Pick<Item, 'id' | 'name'>>>(
        `/households/${householdId}/items/archived`,
      ),
      api<Item>(base),
    ]);
    const archived =
      archivedResult.status === 'fulfilled' ? archivedResult.value : null;
    const detail =
      detailResult.status === 'fulfilled' ? detailResult.value : null;
    if (archived) {
      queryClient.setQueryData(keys.archivedItems(householdId), archived);
    }
    if (detail) {
      queryClient.setQueryData(keys.item(householdId, item.id), detail);
    }

    const detailConfirmsMissing =
      detailResult.status === 'rejected' &&
      detailResult.reason instanceof ApiError &&
      detailResult.reason.code === 'ITEM_NOT_FOUND';
    if (
      archived &&
      !archived.some((entry) => entry.id === item.id) &&
      detailConfirmsMissing
    ) {
      await finishPermanentDeletion();
      return;
    }

    setDeleteError(
      archived?.some((entry) => entry.id === item.id) && detail
        ? tr('item-detail:deleteOutcomeStillPresent')
        : tr('item-detail:deleteOutcomeUncertain'),
    );
  }

  async function deletePermanently() {
    if (busy || deleteBusy || !item.archivedAt) return;
    setDeleteError('');
    setError('');

    if (deleteName !== item.name) {
      setDeleteError(tr('item-detail:deleteNameMismatch'));
      return;
    }

    setDeleteBusy(true);
    let deleteSent = false;
    try {
      const current = await api<Item>(base);
      queryClient.setQueryData(keys.item(householdId, item.id), current);
      if (current.name !== item.name) {
        setDeleteName('');
        setDeleteError(tr('item-detail:deleteNameChanged'));
        return;
      }
      if (!current.archivedAt) {
        setDeleteName('');
        setDeleteError(tr('item-detail:deleteNoLongerArchived'));
        return;
      }
      if (deleteName !== current.name) {
        setDeleteError(tr('item-detail:deleteNameMismatch'));
        return;
      }

      deleteSent = true;
      await api<void>(base, 'DELETE', { confirmName: deleteName });
      await finishPermanentDeletion();
    } catch (cause) {
      if (
        deleteSent &&
        !(cause instanceof OfflineBeforeSendError) &&
        isMutationOutcomeUnknown(cause)
      ) {
        setDeleteError(tr('item-detail:deleteOutcomeUncertain'));
        await reconcileUncertainDeletion();
      } else {
        if (
          cause instanceof ApiError &&
          ['DELETE_NAME_MISMATCH', 'ITEM_NOT_ARCHIVED'].includes(
            cause.code ?? '',
          )
        ) {
          try {
            const current = await api<Item>(base);
            queryClient.setQueryData(keys.item(householdId, item.id), current);
            if (current.name !== item.name) {
              setDeleteName('');
              setDeleteError(tr('item-detail:deleteNameChanged'));
              return;
            }
          } catch {
            // Keep the server's deletion error visible if the detail refresh fails.
          }
        }
        setDeleteError(
          cause instanceof Error
            ? localizedError(cause)
            : tr('item-detail:deleteRejected'),
        );
      }
    } finally {
      setDeleteBusy(false);
    }
  }

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
        <>
          <Button
            disabled={busy || deleteBusy}
            onClick={() => void submit(`${base}/restore`, 'POST')}
          >
            {busy
              ? tr('common:restoring')
              : tr('item-detail:restoreActiveInventory')}
          </Button>
          <details>
            <summary>{tr('item-detail:deletePermanently')}</summary>
            <p className="muted">
              {tr('item-detail:deleteCannotUndo', { name: item.name })}
            </p>
            {deleteError && <Notice kind="error">{deleteError}</Notice>}
            <form
              className="field-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void deletePermanently();
              }}
            >
              <label htmlFor={`delete-confirm-${item.id}`}>
                {tr('item-detail:typeNameToDelete', { name: item.name })}
              </label>
              <input
                id={`delete-confirm-${item.id}`}
                autoComplete="off"
                value={deleteName}
                disabled={deleteBusy}
                onChange={(event) => {
                  setDeleteName(event.target.value);
                  setDeleteError('');
                }}
              />
              <Button
                variant="secondary"
                disabled={busy || deleteBusy || !deleteName}
              >
                {deleteBusy
                  ? tr('item-detail:deletingPermanently')
                  : tr('item-detail:deletePermanently')}
              </Button>
            </form>
          </details>
        </>
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
