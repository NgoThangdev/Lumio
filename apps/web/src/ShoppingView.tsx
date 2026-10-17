import { useEffect, useState } from 'react';
import { api } from './api';

type InventoryChoice = {
  id: string;
  name: string;
  primaryUnit: string;
  trackingMode: 'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP';
};
type TripSummary = {
  id: string;
  store: string;
  plannedDate: string;
  status: 'DRAFT' | 'SHOPPING' | 'RESTOCKED';
  _count?: { entries: number };
};
type Entry = {
  id: string;
  status: 'PENDING' | 'PURCHASED' | 'SKIPPED';
  source: 'SUGGESTED' | 'MANUAL';
  priority: 'MUST_BUY' | 'SHOULD_BUY' | 'OPTIONAL';
  suggestedQuantity: string | null;
  suggestedReason: string | null;
  actualQuantity: string | null;
  expiryDate: string | null;
  item: InventoryChoice;
};
type Trip = TripSummary & { completedAt: string | null; entries: Entry[] };
type PurchaseDraft = { quantity: string; expiryDate: string };

export function ShoppingView({
  householdId,
  items,
  defaultDate,
  onFinished,
}: {
  householdId: string;
  items: InventoryChoice[];
  defaultDate: string;
  onFinished: () => Promise<void>;
}) {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [store, setStore] = useState('');
  const [plannedDate, setPlannedDate] = useState(defaultDate);
  const [manualItemId, setManualItemId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, PurchaseDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = `/households/${householdId}/trips`;

  useEffect(() => {
    void api<TripSummary[]>(base)
      .then(setTrips)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : 'Could not load trips.',
        ),
      )
      .finally(() => setLoading(false));
  }, [base]);

  function showTrip(next: Trip) {
    setTrip(next);
    setDrafts(
      Object.fromEntries(
        next.entries.map((entry) => [
          entry.id,
          {
            quantity: entry.actualQuantity ?? '',
            expiryDate: entry.expiryDate?.slice(0, 10) ?? '',
          },
        ]),
      ),
    );
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The change was not saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateTrip(path: string, method: string, body?: object) {
    showTrip(await api<Trip>(path, method, body));
    try {
      setTrips(await api<TripSummary[]>(base));
    } catch {
      setError('Trip updated, but the trip list could not be refreshed.');
    }
  }

  const available = items.filter(
    (item) =>
      item.trackingMode === 'QUANTITY' &&
      !trip?.entries.some((entry) => entry.item.id === item.id),
  );
  const validManualSelection = available.some(
    (item) => item.id === manualItemId,
  );
  const purchasedCount =
    trip?.entries.filter((entry) => entry.status === 'PURCHASED').length ?? 0;
  const unsavedPurchase =
    trip?.entries.some(
      (entry) =>
        entry.status === 'PURCHASED' &&
        (drafts[entry.id]?.quantity !== entry.actualQuantity ||
          drafts[entry.id]?.expiryDate !==
            (entry.expiryDate?.slice(0, 10) ?? '')),
    ) ?? false;

  return (
    <div className="shopping-layout">
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="message success" role="status">
          {notice}
        </div>
      )}
      {loading ? (
        <section className="card">
          <p className="muted">Loading trips…</p>
        </section>
      ) : !trip ? (
        <div className="grid">
          <section className="card">
            <p className="eyebrow">Shopping trips</p>
            <h2>Your plans</h2>
            {trips.length === 0 ? (
              <p className="muted">
                No trips yet. Create one for your next shop.
              </p>
            ) : (
              trips.map((entry) => (
                <button
                  className="row"
                  key={entry.id}
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      showTrip(await api<Trip>(`${base}/${entry.id}`)),
                    )
                  }
                >
                  <span>
                    <strong>{entry.store}</strong>
                    <small>
                      {entry.plannedDate.slice(0, 10)} ·{' '}
                      {entry._count?.entries ?? 0} items
                    </small>
                  </span>
                  <span className="pill">{entry.status.toLowerCase()}</span>
                </button>
              ))
            )}
          </section>
          <form
            className="card"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const created = await api<TripSummary>(base, 'POST', {
                  store,
                  plannedDate,
                });
                showTrip(await api<Trip>(`${base}/${created.id}`));
                setTrips(await api<TripSummary[]>(base));
                setStore('');
              });
            }}
          >
            <p className="eyebrow">Plan</p>
            <h2>Create a trip</h2>
            <label>
              Primary store
              <input
                value={store}
                onChange={(event) => setStore(event.target.value)}
                placeholder="e.g. Winmart"
                required
              />
            </label>
            <label>
              Planned date
              <input
                type="date"
                value={plannedDate}
                onChange={(event) => setPlannedDate(event.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              Create trip
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="trip-header">
            <button className="link" onClick={() => setTrip(null)}>
              ← All trips
            </button>
            <div>
              <p className="eyebrow">
                {trip.status === 'DRAFT'
                  ? 'Plan'
                  : trip.status === 'SHOPPING'
                    ? 'Shopping mode'
                    : 'Finished'}
              </p>
              <h2>{trip.store}</h2>
              <p>
                {trip.plannedDate.slice(0, 10)} · {purchasedCount} /{' '}
                {trip.entries.length} purchased
              </p>
            </div>
          </div>
          {trip.status === 'DRAFT' && (
            <div className="trip-tools">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await updateTrip(`${base}/${trip.id}/suggestions`, 'POST');
                    setNotice(
                      'Current suggestions added. Existing entries were kept.',
                    );
                  })
                }
              >
                Add current suggestions
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    updateTrip(`${base}/${trip.id}/start`, 'POST'),
                  )
                }
              >
                Start shopping
              </button>
            </div>
          )}
          {trip.status !== 'RESTOCKED' && available.length > 0 && (
            <form
              className="card manual-add"
              onSubmit={(event) => {
                event.preventDefault();
                if (!validManualSelection) return;
                void run(async () => {
                  await updateTrip(`${base}/${trip.id}/entries`, 'POST', {
                    itemId: manualItemId,
                  });
                  setManualItemId('');
                });
              }}
            >
              <div>
                <p className="eyebrow">Add an existing item</p>
                <p className="muted">
                  Quantity items without a target can still be added. Enter
                  actual quantity only if purchased.
                </p>
              </div>
              <select
                value={manualItemId}
                onChange={(event) => setManualItemId(event.target.value)}
                required
              >
                <option value="">Choose item</option>
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.primaryUnit}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                disabled={busy || !validManualSelection}
              >
                Add
              </button>
            </form>
          )}
          <div className="trip-checklist">
            {trip.entries.length === 0 ? (
              <section className="card">
                <p className="muted">
                  The checklist is empty. Add suggestions or an existing item.
                </p>
              </section>
            ) : (
              (['MUST_BUY', 'SHOULD_BUY', 'OPTIONAL'] as const).map(
                (priority) => {
                  const entries = trip.entries.filter(
                    (entry) => entry.priority === priority,
                  );
                  return (
                    entries.length > 0 && (
                      <section className="card" key={priority}>
                        <p className="eyebrow">
                          {priority === 'MUST_BUY'
                            ? 'Must buy'
                            : priority === 'SHOULD_BUY'
                              ? 'Should buy'
                              : 'Manual / optional'}
                        </p>
                        {entries.map((entry) => (
                          <div className="checklist-entry" key={entry.id}>
                            <div className="entry-title">
                              <strong>{entry.item.name}</strong>
                              <span
                                className={`health health-${entry.status === 'PURCHASED' ? 'ok' : entry.status === 'SKIPPED' ? 'low' : 'buy'}`}
                              >
                                {entry.status.toLowerCase()}
                              </span>
                            </div>
                            <p className="muted">
                              {entry.suggestedQuantity
                                ? `Suggested ${entry.suggestedQuantity} ${entry.item.primaryUnit}`
                                : `No suggested quantity · ${entry.item.primaryUnit}`}
                            </p>
                            {trip.status === 'DRAFT' &&
                              entry.suggestedReason && (
                                <p className="muted">{entry.suggestedReason}</p>
                              )}
                            {trip.status === 'SHOPPING' ? (
                              <div className="purchase-controls">
                                <label>
                                  Actual bought
                                  <input
                                    type="number"
                                    min="0.000001"
                                    step="0.000001"
                                    inputMode="decimal"
                                    value={drafts[entry.id]?.quantity ?? ''}
                                    onChange={(event) =>
                                      setDrafts((current) => ({
                                        ...current,
                                        [entry.id]: {
                                          quantity: event.target.value,
                                          expiryDate:
                                            current[entry.id]?.expiryDate ?? '',
                                        },
                                      }))
                                    }
                                    placeholder="Enter actual quantity"
                                  />
                                </label>
                                <label>
                                  Expiry <em>optional</em>
                                  <input
                                    type="date"
                                    value={drafts[entry.id]?.expiryDate ?? ''}
                                    onChange={(event) =>
                                      setDrafts((current) => ({
                                        ...current,
                                        [entry.id]: {
                                          quantity:
                                            current[entry.id]?.quantity ?? '',
                                          expiryDate: event.target.value,
                                        },
                                      }))
                                    }
                                  />
                                </label>
                                <button
                                  className="primary"
                                  disabled={busy || !drafts[entry.id]?.quantity}
                                  onClick={() =>
                                    void run(async () =>
                                      updateTrip(
                                        `${base}/${trip.id}/entries/${entry.id}`,
                                        'PATCH',
                                        {
                                          status: 'PURCHASED',
                                          actualQuantity:
                                            drafts[entry.id]?.quantity,
                                          expiryDate:
                                            drafts[entry.id]?.expiryDate ||
                                            null,
                                        },
                                      ),
                                    )
                                  }
                                >
                                  {entry.status === 'PURCHASED'
                                    ? 'Save purchase'
                                    : 'Mark purchased'}
                                </button>
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () =>
                                      updateTrip(
                                        `${base}/${trip.id}/entries/${entry.id}`,
                                        'PATCH',
                                        {
                                          status:
                                            entry.status === 'SKIPPED'
                                              ? 'PENDING'
                                              : 'SKIPPED',
                                        },
                                      ),
                                    )
                                  }
                                >
                                  {entry.status === 'SKIPPED'
                                    ? 'Leave pending'
                                    : 'Skip'}
                                </button>
                              </div>
                            ) : (
                              trip.status === 'RESTOCKED' && (
                                <p className="muted">
                                  {entry.status === 'PURCHASED'
                                    ? `Bought ${entry.actualQuantity} ${entry.item.primaryUnit}${entry.expiryDate ? ` · expires ${entry.expiryDate.slice(0, 10)}` : ''}`
                                    : 'Not purchased; no stock added.'}
                                </p>
                              )
                            )}
                          </div>
                        ))}
                      </section>
                    )
                  );
                },
              )
            )}
          </div>
          {trip.status === 'SHOPPING' && (
            <section className="card finish-panel">
              <div>
                <h2>Finish shopping</h2>
                <p className="muted">
                  Only the {purchasedCount} purchased{' '}
                  {purchasedCount === 1 ? 'item' : 'items'} with saved actual
                  quantities will be restocked. Pending entries become skipped.
                  {unsavedPurchase && ' Save edited purchases first.'}
                </p>
              </div>
              <button
                className="primary"
                disabled={busy || unsavedPurchase}
                onClick={() =>
                  void run(async () => {
                    await updateTrip(`${base}/${trip.id}/finish`, 'POST');
                    setNotice(
                      'Shopping finished and purchased quantities restocked.',
                    );
                    try {
                      await onFinished();
                    } catch {
                      setError(
                        'Trip finished, but inventory could not be refreshed. Reopen the household to reload it.',
                      );
                    }
                  })
                }
              >
                Finish & restock
              </button>
            </section>
          )}
          {trip.status === 'RESTOCKED' && (
            <div className="message success" role="status">
              Finished. Purchased items were restocked once; skipped items did
              not change inventory.
            </div>
          )}
        </>
      )}
    </div>
  );
}
