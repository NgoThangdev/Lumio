import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { ShoppingView } from './ShoppingView';

type User = { id: string; email: string };
type Household = { id: string; name: string; role: 'ADMIN' | 'MEMBER' };
type TrackingMode = 'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP';
type Batch = { id: string; quantity: string; expiryDate: string | null };
type Action = {
  id: string;
  type: 'RESTOCK' | 'USE';
  quantity: string;
  createdAt: string;
  allocations: { batchId: string; quantity: string }[];
};
type Item = {
  id: string;
  name: string;
  primaryUnit: string;
  trackingMode: TrackingMode;
  currentLevel: 'FULL' | 'THREE_QUARTERS' | 'HALF' | 'QUARTER' | 'EMPTY' | null;
  isPresent: boolean | null;
  backupCount: number;
  batches: Batch[];
  actions?: Action[];
  stateActions?: {
    id: string;
    type: 'UPDATE_LEVEL' | 'ADD_BACKUP' | 'OPEN_REFILL' | 'SET_PRESENCE';
    createdAt: string;
    afterLevel: Item['currentLevel'];
    afterPresent: boolean | null;
    afterBackupCount: number;
  }[];
  minimumStock: string | null;
  lowStockThreshold: string | null;
  buyThreshold: string | null;
  targetStock: string | null;
  neverRunOut: boolean;
  predictionEnabled: boolean;
};
type Assessment = {
  itemId: string;
  name: string;
  primaryUnit: string;
  trackingMode: TrackingMode;
  recommendedAction?: 'NONE' | 'OPEN_REFILL' | 'BUY_BACKUP';
  physicalStock: string | null;
  eligibleStock: string | null;
  expiredStock: string | null;
  useSoonQuantity: string | null;
  expiryRisk: 'USE_SOON' | 'NONE';
  expiryReason: string | null;
  lowStockRisk: 'OUT' | 'BUY' | 'LOW' | 'OK';
  reasons: string[];
  prediction: {
    basis: 'USE_14_DAY' | 'THRESHOLD_FALLBACK' | 'NOT_APPLICABLE';
    reason: string;
    dailyRate: string | null;
    projectedNeed: string | null;
    shoppingDays: number | null;
  };
  suggestion: {
    quantity: string;
    priority: 'MUST_BUY' | 'SHOULD_BUY';
    reason: string;
  } | null;
};
type Intelligence = {
  shoppingDate: string;
  assessments: Assessment[];
  useSoon: Assessment[];
  suggestions: Assessment[];
};
type Config = Pick<
  Item,
  | 'minimumStock'
  | 'lowStockThreshold'
  | 'buyThreshold'
  | 'targetStock'
  | 'neverRunOut'
  | 'predictionEnabled'
>;
const emptyConfig: Config = {
  minimumStock: null,
  lowStockThreshold: null,
  buyThreshold: null,
  targetStock: null,
  neverRunOut: false,
  predictionEnabled: false,
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [household, setHousehold] = useState<Household | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [item, setItem] = useState<Item | null>(null);
  const [view, setView] = useState<'inventory' | 'shopping'>('inventory');
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [shoppingDate, setShoppingDate] = useState('');
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [itemName, setItemName] = useState('');
  const [unit, setUnit] = useState('');
  const [restock, setRestock] = useState('');
  const [expiry, setExpiry] = useState('');
  const [use, setUse] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setUser(await api<User>('/auth/me'));
        setHouseholds(await api<Household[]>('/households'));
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status === 401)) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load your session.',
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The request could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function refresh(householdId: string, itemId?: string) {
    const [listing, assessment] = await Promise.all([
      api<Item[]>(`/households/${householdId}/items`),
      api<Intelligence>(
        `/households/${householdId}/stock-intelligence${shoppingDate ? `?shoppingDate=${shoppingDate}` : ''}`,
      ),
    ]);
    setItems(listing);
    setIntelligence(assessment);
    setShoppingDate(assessment.shoppingDate);
    if (itemId) {
      const detail = await api<Item>(
        `/households/${householdId}/items/${itemId}`,
      );
      setItem(detail);
      setConfig({
        minimumStock: detail.minimumStock,
        lowStockThreshold: detail.lowStockThreshold,
        buyThreshold: detail.buyThreshold,
        targetStock: detail.targetStock,
        neverRunOut: detail.neverRunOut,
        predictionEnabled: detail.predictionEnabled,
      });
    }
  }

  async function refreshAfterMutation(
    householdId: string,
    itemId: string,
    successMessage: string,
  ) {
    setNotice(successMessage);
    try {
      await refresh(householdId, itemId);
    } catch {
      setItem(null);
      setIntelligence(null);
      setError(
        'Saved, but the latest inventory could not be loaded. Select the household again to refresh.',
      );
    }
  }

  const itemAssessment = intelligence?.assessments.find(
    (entry) => entry.itemId === item?.id,
  );

  if (loading) return <main className="loading">Loading Lumio…</main>;
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span>◕</span> Lumio
        </div>
        {user && (
          <div className="top-actions">
            <small>{user.email}</small>
            <button
              className="link"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api('/auth/sign-out', 'POST');
                  setUser(null);
                  setHouseholds([]);
                  setHousehold(null);
                  setItem(null);
                  setView('inventory');
                  setIntelligence(null);
                })
              }
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="content">
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
        {!user ? (
          <div className="auth-layout">
            <div className="intro">
              <p className="eyebrow">Your household inventory</p>
              <h1>
                Know what you have.
                <br />
                Use it well.
              </h1>
              <p>
                Keep batches, expiry dates, and everyday stock changes together
                in one simple place.
              </p>
            </div>
            <form
              className="card auth-card"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  setUser(
                    await api<User>(`/auth/${mode}`, 'POST', {
                      email,
                      password,
                    }),
                  );
                  setPassword('');
                  setHouseholds(await api<Household[]>('/households'));
                });
              }}
            >
              <div className="tabs">
                <button
                  type="button"
                  className={mode === 'sign-in' ? 'active' : ''}
                  onClick={() => setMode('sign-in')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={mode === 'register' ? 'active' : ''}
                  onClick={() => setMode('register')}
                >
                  Sign up
                </button>
              </div>
              <h2>
                {mode === 'register' ? 'Create your account' : 'Welcome back'}
              </h2>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  minLength={8}
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                {mode === 'register' ? 'Create account' : 'Sign in'}
              </button>
            </form>
          </div>
        ) : !household ? (
          <div className="narrow">
            <div className="heading">
              <p className="eyebrow">Get started</p>
              <h1>Choose a household</h1>
              <p>Each household keeps its own items and activity.</p>
            </div>
            {households.length > 0 && (
              <section className="card">
                <h2>Your households</h2>
                {households.map((entry) => (
                  <button
                    className="row"
                    key={entry.id}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await refresh(entry.id);
                        setHousehold(entry);
                        setView('inventory');
                      })
                    }
                  >
                    <span>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.role === 'ADMIN' ? 'Admin' : 'Member'}
                      </small>
                    </span>
                    <span>→</span>
                  </button>
                ))}
              </section>
            )}
            <form
              className="card"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const created = await api<{ id: string; name: string }>(
                    '/households',
                    'POST',
                    { name: householdName },
                  );
                  const entry: Household = { ...created, role: 'ADMIN' };
                  setHouseholds((current) => [...current, entry]);
                  await refresh(entry.id);
                  setHousehold(entry);
                  setView('inventory');
                  setHouseholdName('');
                });
              }}
            >
              <h2>Create a household</h2>
              <label>
                Household name
                <input
                  value={householdName}
                  onChange={(event) => setHouseholdName(event.target.value)}
                  placeholder="e.g. Our home"
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                Create household
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className="workspace-heading">
              <div>
                <button
                  className="link"
                  onClick={() => {
                    setHousehold(null);
                    setItem(null);
                  }}
                >
                  ← Households
                </button>
                <p className="eyebrow">{household.name}</p>
                <h1>
                  {view === 'shopping'
                    ? 'Shopping'
                    : item
                      ? item.name
                      : 'Inventory'}
                </h1>
              </div>
              {view === 'inventory' && item && (
                <button className="secondary" onClick={() => setItem(null)}>
                  All items
                </button>
              )}
            </div>
            <nav className="workspace-nav" aria-label="Household sections">
              <button
                className={view === 'inventory' ? 'selected' : ''}
                onClick={() => setView('inventory')}
              >
                Inventory
              </button>
              <button
                className={view === 'shopping' ? 'selected' : ''}
                onClick={() => {
                  setItem(null);
                  setView('shopping');
                }}
              >
                Shopping
              </button>
            </nav>
            {view === 'shopping' ? (
              <ShoppingView
                key={household.id}
                householdId={household.id}
                items={items}
                defaultDate={shoppingDate}
                onFinished={() => refresh(household.id)}
              />
            ) : !item ? (
              <>
                <div className="insight-strip">
                  {intelligence && intelligence.useSoon.length > 0 && (
                    <section className="card use-soon">
                      <p className="eyebrow">Use Soon</p>
                      <h2>
                        {intelligence.useSoon.length}{' '}
                        {intelligence.useSoon.length === 1 ? 'item' : 'items'}{' '}
                        to check
                      </h2>
                      {intelligence.useSoon.slice(0, 4).map((entry) => (
                        <button
                          className="insight-row"
                          key={entry.itemId}
                          onClick={() =>
                            void run(async () =>
                              refresh(household.id, entry.itemId),
                            )
                          }
                        >
                          <strong>{entry.name}</strong>
                          <span>{entry.expiryReason}</span>
                        </button>
                      ))}
                    </section>
                  )}
                  <section className="card suggestions">
                    <div className="suggestion-heading">
                      <div>
                        <p className="eyebrow">Shopping suggestions</p>
                        <h2>
                          {intelligence?.suggestions.length ?? 0} items
                          suggested
                        </h2>
                      </div>
                      <label>
                        Shopping date
                        <input
                          type="date"
                          value={shoppingDate}
                          onChange={(event) => {
                            const date = event.target.value;
                            setShoppingDate(date);
                            if (date)
                              void run(async () =>
                                setIntelligence(
                                  await api<Intelligence>(
                                    `/households/${household.id}/stock-intelligence?shoppingDate=${date}`,
                                  ),
                                ),
                              );
                          }}
                        />
                      </label>
                    </div>
                    {!intelligence?.suggestions.length ? (
                      <p className="muted">
                        Nothing to buy based on current stock and item rules.
                      </p>
                    ) : (
                      intelligence.suggestions.map((entry) => (
                        <div className="suggestion-row" key={entry.itemId}>
                          <div>
                            <strong>
                              {entry.name}{' '}
                              <span className="priority">
                                {entry.suggestion?.priority === 'MUST_BUY'
                                  ? 'Must buy'
                                  : 'Should buy'}
                              </span>
                            </strong>
                            <small>{entry.suggestion?.reason}</small>
                          </div>
                          <span>
                            {entry.suggestion?.quantity} {entry.primaryUnit}
                          </span>
                        </div>
                      ))
                    )}
                    <p className="muted">
                      Suggestions are a starting quantity. You can adjust
                      purchases when planning a trip later.
                    </p>
                  </section>
                </div>
                <div className="grid">
                  <section className="card">
                    <h2>
                      Items <span className="count">{items.length}</span>
                    </h2>
                    {items.length === 0 ? (
                      <div className="empty">
                        <div>▧</div>
                        <h3>No items yet</h3>
                        <p>Create an item, then add its first stock batch.</p>
                      </div>
                    ) : (
                      items.map((entry) => (
                        <button
                          className="row"
                          key={entry.id}
                          disabled={busy}
                          onClick={() =>
                            void run(async () =>
                              refresh(household.id, entry.id),
                            )
                          }
                        >
                          <span>
                            <strong>{entry.name}</strong>
                            <small>
                              {entry.trackingMode === 'QUANTITY'
                                ? `${entry.batches.length} ${entry.batches.length === 1 ? 'batch' : 'batches'}`
                                : entry.trackingMode === 'FIVE_LEVEL'
                                  ? `Five-level · ${entry.currentLevel?.replaceAll('_', ' ').toLowerCase() ?? '—'} · ${entry.backupCount} backups`
                                  : `Presence · ${entry.isPresent ? 'present' : 'absent'} · ${entry.backupCount} backups`}
                            </small>
                          </span>
                          {entry.trackingMode === 'QUANTITY' && (
                            <span className="pill">
                              {intelligence?.assessments.find(
                                (assessment) => assessment.itemId === entry.id,
                              )?.eligibleStock ?? '—'}{' '}
                              {entry.primaryUnit}
                            </span>
                          )}
                          <span
                            className={`health health-${intelligence?.assessments.find((assessment) => assessment.itemId === entry.id)?.lowStockRisk.toLowerCase() ?? 'ok'}`}
                          >
                            {intelligence?.assessments.find(
                              (assessment) => assessment.itemId === entry.id,
                            )?.lowStockRisk ?? '—'}
                          </span>
                          <span>→</span>
                        </button>
                      ))
                    )}
                  </section>
                  <form
                    className="card"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        const created = await api<{ id: string }>(
                          `/households/${household.id}/items`,
                          'POST',
                          {
                            name: itemName,
                            primaryUnit: unit,
                            trackingMode: 'QUANTITY',
                          },
                        );
                        setItemName('');
                        setUnit('');
                        await refreshAfterMutation(
                          household.id,
                          created.id,
                          'Quantity item created. Add its first batch below.',
                        );
                      });
                    }}
                  >
                    <p className="eyebrow">New item</p>
                    <h2>Add to inventory</h2>
                    <label>
                      Item name
                      <input
                        value={itemName}
                        onChange={(event) => setItemName(event.target.value)}
                        placeholder="e.g. Rice"
                        required
                      />
                    </label>
                    <label>
                      Primary unit
                      <input
                        value={unit}
                        onChange={(event) => setUnit(event.target.value)}
                        placeholder="e.g. kg, bottle"
                        required
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      Create item
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div
                className={
                  item.trackingMode === 'QUANTITY'
                    ? 'grid'
                    : 'grid state-detail'
                }
              >
                <div className="stack">
                  {item.trackingMode === 'QUANTITY' ? (
                    <section className="stock-summary">
                      <p className="eyebrow">Eligible stock</p>
                      <strong>
                        {itemAssessment?.eligibleStock ?? '—'}
                      </strong>{' '}
                      <span>{item.primaryUnit}</span>
                      <p>
                        Physical: {itemAssessment?.physicalStock ?? '—'}{' '}
                        {item.primaryUnit} · Expired:{' '}
                        {itemAssessment?.expiredStock ?? '—'} {item.primaryUnit}
                      </p>
                    </section>
                  ) : (
                    <section className="stock-summary">
                      <p className="eyebrow">
                        {item.trackingMode === 'FIVE_LEVEL'
                          ? 'Current level'
                          : 'Current item'}
                      </p>
                      <strong className="state-value">
                        {item.trackingMode === 'FIVE_LEVEL'
                          ? (item.currentLevel
                              ?.replaceAll('_', ' ')
                              .toLowerCase() ?? '—')
                          : item.isPresent
                            ? 'Present'
                            : 'Absent'}
                      </strong>
                      <p>
                        {item.backupCount}{' '}
                        {item.backupCount === 1 ? 'backup' : 'backups'}{' '}
                        available
                      </p>
                    </section>
                  )}
                  {itemAssessment && (
                    <section className="card">
                      <p className="eyebrow">Stock health</p>
                      <h2>
                        <span
                          className={`health health-${itemAssessment.lowStockRisk.toLowerCase()}`}
                        >
                          {itemAssessment.lowStockRisk}
                        </span>
                      </h2>
                      {itemAssessment.reasons.map((reason) => (
                        <p className="muted" key={reason}>
                          {reason}
                        </p>
                      ))}
                      {itemAssessment.expiryReason && (
                        <p className="use-soon-note">
                          {itemAssessment.expiryReason}
                        </p>
                      )}
                      {item.trackingMode === 'QUANTITY' && (
                        <p className="muted">
                          {itemAssessment.prediction.reason}
                          {itemAssessment.prediction.basis === 'USE_14_DAY' &&
                            ` Daily rate: ${itemAssessment.prediction.dailyRate} ${item.primaryUnit}; projected need through ${intelligence?.shoppingDate}: ${itemAssessment.prediction.projectedNeed} ${item.primaryUnit}.`}
                        </p>
                      )}
                      {item.trackingMode !== 'QUANTITY' &&
                        itemAssessment.recommendedAction &&
                        itemAssessment.recommendedAction !== 'NONE' && (
                          <p className="muted">
                            Recommended:{' '}
                            {itemAssessment.recommendedAction === 'OPEN_REFILL'
                              ? 'Open a backup'
                              : 'Buy a backup'}
                          </p>
                        )}
                    </section>
                  )}
                  {item.trackingMode === 'QUANTITY' && (
                    <>
                      <section className="card">
                        <h2>
                          Batches{' '}
                          <span className="count">{item.batches.length}</span>
                        </h2>
                        {item.batches.length === 0 ? (
                          <p className="muted">No stock batches yet.</p>
                        ) : (
                          item.batches.map((batch) => (
                            <div className="row static" key={batch.id}>
                              <span>
                                <strong>
                                  {batch.quantity} {item.primaryUnit}
                                </strong>
                                <small>
                                  {batch.expiryDate
                                    ? `Expires ${batch.expiryDate.slice(0, 10)}`
                                    : 'No expiry'}
                                </small>
                              </span>
                              <small>{batch.id.slice(0, 8)}</small>
                            </div>
                          ))
                        )}
                      </section>
                      <section className="card">
                        <h2>
                          Activity{' '}
                          <span className="count">
                            {item.actions?.length ?? 0}
                          </span>
                        </h2>
                        {!item.actions?.length ? (
                          <p className="muted">No activity yet.</p>
                        ) : (
                          [...item.actions].reverse().map((action) => (
                            <div className="row static" key={action.id}>
                              <span>
                                <strong>
                                  <span
                                    className={
                                      action.type === 'RESTOCK'
                                        ? 'plus'
                                        : 'minus'
                                    }
                                  >
                                    {action.type === 'RESTOCK' ? '+' : '−'}
                                  </span>{' '}
                                  {action.type === 'RESTOCK'
                                    ? 'Restocked'
                                    : 'Used'}{' '}
                                  {action.quantity} {item.primaryUnit}
                                </strong>
                                <small>
                                  {new Date(action.createdAt).toLocaleString()}{' '}
                                  · {action.allocations.length}{' '}
                                  {action.allocations.length === 1
                                    ? 'batch'
                                    : 'batches'}
                                </small>
                              </span>
                            </div>
                          ))
                        )}
                      </section>
                    </>
                  )}
                  {item.trackingMode !== 'QUANTITY' && (
                    <section className="card">
                      <h2>
                        State activity{' '}
                        <span className="count">
                          {item.stateActions?.length ?? 0}
                        </span>
                      </h2>
                      {!item.stateActions?.length ? (
                        <p className="muted">No state activity yet.</p>
                      ) : (
                        [...item.stateActions].reverse().map((action) => (
                          <div className="row static" key={action.id}>
                            <span>
                              <strong>
                                {action.type.replaceAll('_', ' ').toLowerCase()}
                              </strong>
                              <small>
                                {new Date(action.createdAt).toLocaleString()} ·{' '}
                                {action.afterBackupCount} backups
                              </small>
                            </span>
                          </div>
                        ))
                      )}
                    </section>
                  )}
                </div>
                <div className="stack">
                  {item.trackingMode === 'QUANTITY' && (
                    <>
                      <form
                        className="card"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(async () => {
                            await api(
                              `/households/${household.id}/items/${item.id}/restock`,
                              'POST',
                              { quantity: restock, expiryDate: expiry || null },
                            );
                            setRestock('');
                            setExpiry('');
                            await refreshAfterMutation(
                              household.id,
                              item.id,
                              'Stock added.',
                            );
                          });
                        }}
                      >
                        <p className="eyebrow">Add stock</p>
                        <h2>Restock</h2>
                        <label>
                          Actual quantity
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.000001"
                            step="0.000001"
                            value={restock}
                            onChange={(event) => setRestock(event.target.value)}
                            required
                          />
                        </label>
                        <label>
                          Expiry date <em>optional</em>
                          <input
                            type="date"
                            value={expiry}
                            onChange={(event) => setExpiry(event.target.value)}
                          />
                        </label>
                        <button className="primary" disabled={busy}>
                          Add batch
                        </button>
                      </form>
                      <form
                        className="card"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(async () => {
                            await api(
                              `/households/${household.id}/items/${item.id}/use`,
                              'POST',
                              { quantity: use },
                            );
                            setUse('');
                            await refreshAfterMutation(
                              household.id,
                              item.id,
                              'Use recorded.',
                            );
                          });
                        }}
                      >
                        <p className="eyebrow">Quick action</p>
                        <h2>Use stock</h2>
                        <p className="muted">
                          The earliest eligible expiry is used first.
                        </p>
                        <label>
                          Quantity used
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.000001"
                            step="0.000001"
                            value={use}
                            onChange={(event) => setUse(event.target.value)}
                            required
                          />
                        </label>
                        <button className="secondary wide" disabled={busy}>
                          Record use
                        </button>
                      </form>
                      {household.role === 'ADMIN' && (
                        <form
                          className="card"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void run(async () => {
                              await api(
                                `/households/${household.id}/items/${item.id}/config`,
                                'PUT',
                                config,
                              );
                              await refreshAfterMutation(
                                household.id,
                                item.id,
                                'Stock rules saved.',
                              );
                            });
                          }}
                        >
                          <p className="eyebrow">Item rules</p>
                          <h2>Stock settings</h2>
                          <p className="muted">
                            Optional values use {item.primaryUnit}. Set a target
                            to enable purchase quantities.
                          </p>
                          {(
                            [
                              ['minimumStock', 'Minimum stock'],
                              ['buyThreshold', 'Buy threshold'],
                              ['lowStockThreshold', 'Low threshold'],
                              ['targetStock', 'Target stock'],
                            ] as const
                          ).map(([field, label]) => (
                            <label key={field}>
                              {label}
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={config[field] ?? ''}
                                onChange={(event) =>
                                  setConfig((current) => ({
                                    ...current,
                                    [field]: event.target.value || null,
                                  }))
                                }
                              />
                            </label>
                          ))}
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={config.neverRunOut}
                              onChange={(event) =>
                                setConfig((current) => ({
                                  ...current,
                                  neverRunOut: event.target.checked,
                                }))
                              }
                            />{' '}
                            Never run out
                          </label>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={config.predictionEnabled}
                              onChange={(event) =>
                                setConfig((current) => ({
                                  ...current,
                                  predictionEnabled: event.target.checked,
                                }))
                              }
                            />{' '}
                            Predict from USE history
                          </label>
                          <button className="secondary wide" disabled={busy}>
                            Save stock rules
                          </button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
