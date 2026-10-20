import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type { Household } from '../../shared/api/types';
import { Button, Card, Notice } from '../../shared/ui/primitives';

import { localizedError, tr, type TranslationKey } from '../../shared/i18n';
type Kind = 'categories' | 'locations' | 'tags';
type CatalogEntry = {
  id: string;
  name: string;
  shoppingSection?: string | null;
};

const catalogKinds: { kind: Kind; label: string; singular: string }[] = [
  { kind: 'categories', label: 'Categories', singular: 'Category' },
  { kind: 'locations', label: 'Locations', singular: 'Location' },
  { kind: 'tags', label: 'Tags', singular: 'Tag' },
];

function CatalogList({
  household,
  kind,
  label,
  singular,
}: {
  household: Household;
  kind: Kind;
  label: string;
  singular: string;
}) {
  const displayLabel = tr(label as TranslationKey);
  const displaySingular = tr(singular as TranslationKey);
  const queryClient = useQueryClient();
  const catalogKey = keys.catalog(household.id, kind);
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => api<CatalogEntry[]>(`/households/${household.id}/${kind}`),
  });
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [references, setReferences] = useState<Record<string, number> | null>(
    null,
  );

  async function refresh() {
    try {
      await queryClient.invalidateQueries(
        { queryKey: keys.household(household.id), refetchType: 'all' },
        { throwOnError: true },
      );
    } catch {
      setError(tr('settings:catalogSavedRefreshWarning'));
    }
  }

  function mutationError(cause: unknown) {
    if (
      cause instanceof ApiError &&
      (cause.code === 'CATEGORY_IN_USE' || cause.code === 'LOCATION_IN_USE')
    ) {
      setReferences(cause.references);
      setError(
        tr('settings:stillReferencedRemoved', {
          catalog: displaySingular.toLocaleLowerCase(),
        }),
      );
    } else {
      setError(
        cause instanceof OfflineBeforeSendError
          ? localizedError(cause)
          : isMutationOutcomeUnknown(cause)
            ? tr('settings:catalogChangeResult')
            : cause instanceof ApiError
              ? localizedError(cause)
              : cause instanceof Error
                ? localizedError(cause)
                : tr('common:changeSaved'),
      );
    }
  }

  async function rename(entry: CatalogEntry, name: string) {
    if (busyId || name.trim() === entry.name) return;
    setBusyId(entry.id);
    setError('');
    setMessage('');
    setReferences(null);
    try {
      const saved = await api<CatalogEntry>(
        `/households/${household.id}/${kind}/${entry.id}`,
        'PATCH',
        { name },
      );
      queryClient.setQueryData<CatalogEntry[]>(catalogKey, (current) =>
        current?.map((value) => (value.id === saved.id ? saved : value)),
      );
      setMessage(
        tr('settings:renamed', {
          catalog: displaySingular,
          name: saved.name,
        }),
      );
      await refresh();
    } catch (cause) {
      mutationError(cause);
    } finally {
      setBusyId('');
    }
  }

  async function remove(entry: CatalogEntry) {
    if (busyId || kind === 'tags') return;
    setBusyId(entry.id);
    setError('');
    setMessage('');
    setReferences(null);
    try {
      await api<void>(
        `/households/${household.id}/${kind}/${entry.id}`,
        'DELETE',
      );
      queryClient.setQueryData<CatalogEntry[]>(catalogKey, (current) =>
        current?.filter((value) => value.id !== entry.id),
      );
      setMessage(tr('settings:permanentlyRemoved', { name: entry.name }));
      await refresh();
    } catch (cause) {
      mutationError(cause);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="field-stack">
      <h3>{displayLabel}</h3>
      {catalog.isPending && (
        <p role="status">
          {tr('common:loading', {
            catalog: displayLabel.toLocaleLowerCase(),
          })}
        </p>
      )}
      {catalog.isError && (
        <>
          <Notice kind="error">
            {tr('settings:loaded', { catalog: displayLabel })}{' '}
            {localizedError(catalog.error)}
          </Notice>
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            {tr('settings:retry2', {
              catalog: displayLabel.toLocaleLowerCase(),
            })}
          </Button>
        </>
      )}
      {catalog.data?.length === 0 && (
        <p className="muted">
          {tr('settings:yet', {
            catalog: displayLabel.toLocaleLowerCase(),
          })}
        </p>
      )}
      {message && <Notice kind="success">{message}</Notice>}
      {error && (
        <Notice kind="error">
          <p>{error}</p>
          {references && (
            <ul>
              {Object.entries(references)
                .filter(([, count]) => count > 0)
                .map(([key, count]) => (
                  <li key={key}>
                    {key}: {count}
                  </li>
                ))}
            </ul>
          )}
          {references && kind === 'locations' && (
            <p>{tr('settings:evenZeroQuantity')}</p>
          )}
        </Notice>
      )}
      {catalog.data?.map((entry) => (
        <CatalogRow
          key={`${entry.id}-${entry.name}`}
          entry={entry}
          singular={singular}
          canEdit={household.role === 'ADMIN'}
          canRemove={kind !== 'tags'}
          busy={!!busyId}
          onRename={(name) => void rename(entry, name)}
          onRemove={() => void remove(entry)}
        />
      ))}
    </div>
  );
}

function CatalogRow({
  entry,
  singular,
  canEdit,
  canRemove,
  busy,
  onRename,
  onRemove,
}: {
  entry: CatalogEntry;
  singular: string;
  canEdit: boolean;
  canRemove: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const displaySingular = tr(singular as TranslationKey);
  const [name, setName] = useState(entry.name);
  return (
    <div className="category-section-row">
      {canEdit ? (
        <>
          <form
            className="field-stack"
            onSubmit={(event) => {
              event.preventDefault();
              onRename(name);
            }}
          >
            <label>
              {displaySingular} {tr('common:name2')}
              <input
                value={name}
                maxLength={80}
                required
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              variant="secondary"
              disabled={busy || !name.trim() || name === entry.name}
            >
              {tr('settings:rename')}
            </Button>
          </form>
          {canRemove && (
            <details>
              <summary>
                {tr('common:remove')} {entry.name}
              </summary>
              <p className="muted">
                {tr('settings:removalPermanentWorks')} {displaySingular}{' '}
                {tr('settings:hasReferencesItems')}
              </p>
              <Button variant="secondary" disabled={busy} onClick={onRemove}>
                {tr('settings:permanentlyRemove')} {entry.name}
              </Button>
            </details>
          )}
        </>
      ) : (
        <p>{entry.name}</p>
      )}
    </div>
  );
}

export function CatalogManagement({ household }: { household: Household }) {
  return (
    <Card>
      <h2>
        {tr('common:catalog')} {household.name}
      </h2>
      <p className="muted">{tr('settings:namesAppearThroughout')}</p>
      {household.role !== 'ADMIN' && (
        <p className="muted">{tr('settings:onlyHouseholdAdmin5')}</p>
      )}
      {catalogKinds.map((item) => (
        <CatalogList
          key={`${household.id}-${item.kind}`}
          household={household}
          {...item}
        />
      ))}
    </Card>
  );
}
