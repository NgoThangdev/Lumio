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

type Kind = 'categories' | 'locations' | 'tags';
type CatalogEntry = {
  id: string;
  name: string;
  shoppingSection?: string | null;
};

const catalogKinds: { kind: Kind; label: string; singular: string }[] = [
  { kind: 'categories', label: 'Categories', singular: 'category' },
  { kind: 'locations', label: 'Locations', singular: 'location' },
  { kind: 'tags', label: 'Tags', singular: 'tag' },
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
      setError(
        'The change was saved, but related views could not refresh. Reload to check them.',
      );
    }
  }

  function mutationError(cause: unknown, action: string) {
    if (
      cause instanceof ApiError &&
      (cause.code === 'CATEGORY_IN_USE' || cause.code === 'LOCATION_IN_USE')
    ) {
      setReferences(cause.references);
      setError(
        `This ${singular} is still referenced and was not removed. Rename it instead if needed.`,
      );
    } else {
      setError(
        cause instanceof OfflineBeforeSendError
          ? cause.message
          : isMutationOutcomeUnknown(cause)
            ? `The ${action} result is uncertain. Reload the catalog before choosing to retry.`
            : cause instanceof ApiError
              ? `${action} failed: ${cause.message}`
              : cause instanceof Error
                ? cause.message
                : `${action} failed.`,
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
        `${singular[0].toUpperCase()}${singular.slice(1)} renamed to ${saved.name}.`,
      );
      await refresh();
    } catch (cause) {
      mutationError(cause, 'Rename');
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
      setMessage(`${entry.name} was permanently removed.`);
      await refresh();
    } catch (cause) {
      mutationError(cause, 'Remove');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="field-stack">
      <h3>{label}</h3>
      {catalog.isPending && <p role="status">Loading {label.toLowerCase()}…</p>}
      {catalog.isError && (
        <>
          <Notice kind="error">
            {label} could not be loaded: {catalog.error.message}
          </Notice>
          <Button variant="secondary" onClick={() => void catalog.refetch()}>
            Retry {label.toLowerCase()}
          </Button>
        </>
      )}
      {catalog.data?.length === 0 && (
        <p className="muted">No {label.toLowerCase()} yet.</p>
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
            <p>Even a zero-quantity historical batch may prevent removal.</p>
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
              {singular[0].toUpperCase()}
              {singular.slice(1)} name
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
              Rename
            </Button>
          </form>
          {canRemove && (
            <details>
              <summary>Remove {entry.name}</summary>
              <p className="muted">
                Removal is permanent and works only when this {singular} has no
                references. Items, batches, and trips will not be detached.
              </p>
              <Button variant="secondary" disabled={busy} onClick={onRemove}>
                Permanently remove {entry.name}
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
      <h2>Catalog for {household.name}</h2>
      <p className="muted">
        Names appear throughout Inventory and Shopping. Category shopping
        sections are managed separately below.
      </p>
      {household.role !== 'ADMIN' && (
        <p className="muted">
          Only a household Admin can rename or remove catalog entries.
        </p>
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
