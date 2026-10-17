import { useEffect, useState } from 'react';
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import { AuthPage } from '../features/auth/AuthPage';
import { HouseholdsPage } from '../features/households/HouseholdsPage';
import { HomePage } from '../features/home/HomePage';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { ItemDetailPage } from '../features/inventory/ItemDetailPage';
import { LocationStockCheckPage } from '../features/inventory/LocationStockCheckPage';
import { ShoppingPage } from '../features/shopping/ShoppingPage';
import { QuickPurchasePage } from '../features/shopping/QuickPurchasePage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { AttentionPage } from '../features/attention/AttentionPage';
import { api, ApiError } from '../shared/api/client';
import { keys } from '../shared/api/keys';
import type { Household, User } from '../shared/api/types';
import { Brand, Doodle } from '../shared/ui/Doodle';
import { Button, Notice } from '../shared/ui/primitives';

function setSession(queryClient: QueryClient, user: User | null) {
  queryClient.removeQueries({
    predicate: ({ queryKey }) => queryKey[0] !== keys.session[0],
  });
  queryClient.getMutationCache().clear();
  queryClient.setQueryData(keys.session, user);
}

function SessionRoutes() {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      try {
        return await api<User>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    const expire = () => {
      setSession(queryClient, null);
    };
    window.addEventListener('lumio:session-expired', expire);
    return () => window.removeEventListener('lumio:session-expired', expire);
  }, [queryClient]);

  if (session.isPending)
    return <main className="loading">Checking your session…</main>;
  if (session.isError)
    return (
      <main className="loading">
        <Notice kind="error">{session.error.message}</Notice>
        <Button onClick={() => void session.refetch()}>
          Retry session check
        </Button>
      </main>
    );

  const user = session.data;
  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          user ? (
            <Navigate to="/households" replace />
          ) : (
            <AuthPage
              onAuthed={(next) => {
                setSession(queryClient, next);
              }}
            />
          )
        }
      />
      <Route element={user ? <SignedInShell user={user} /> : <RequireSignIn />}>
        <Route path="/attention" element={<AttentionPage user={user!} />} />
        <Route path="/settings" element={<SettingsPage user={user!} />} />
        <Route path="/households" element={<HouseholdsPage />} />
        <Route path="/households/:householdId" element={<HouseholdBoundary />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/:itemId" element={<ItemDetailPage />} />
          <Route
            path="locations/:locationId/check"
            element={<LocationStockCheckPage />}
          />
          <Route path="shopping" element={<ShoppingPage />} />
          <Route
            path="shopping/quick-purchase"
            element={<QuickPurchasePage />}
          />
          <Route path="shopping/:tripId" element={<ShoppingPage />} />
        </Route>
      </Route>
      <Route
        path="*"
        element={<Navigate to={user ? '/households' : '/sign-in'} replace />}
      />
    </Routes>
  );
}

function RequireSignIn() {
  const location = useLocation();
  return (
    <Navigate
      to="/sign-in"
      state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      replace
    />
  );
}

function SignedInShell({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSignOutError('');
    setSigningOut(true);
    try {
      await api('/auth/sign-out', 'POST');
      setSession(queryClient, null);
      void navigate('/sign-in', { replace: true });
    } catch (cause) {
      setSignOutError(
        cause instanceof Error ? cause.message : 'Sign out failed.',
      );
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" to="/households" aria-label="Lumio households">
          <Brand />
          <span className="brand-tagline">Home stuff, happier days.</span>
        </Link>
        <div className="top-actions">
          <small>{user.email}</small>
          <Link className="link" to="/settings">
            Settings
          </Link>
          <Button
            variant="link"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="content">
        {signOutError && <Notice kind="error">{signOutError}</Notice>}
        <Outlet />
      </main>
    </div>
  );
}

function HouseholdBoundary() {
  const { householdId } = useParams();
  const households = useQuery({
    queryKey: keys.households,
    queryFn: () => api<Household[]>('/households'),
  });
  if (households.isPending) return <p className="muted">Loading household…</p>;
  if (households.isError)
    return <Notice kind="error">{households.error.message}</Notice>;
  const household = households.data.find((entry) => entry.id === householdId);
  if (!household) return <Navigate to="/households" replace />;
  return <HouseholdWorkspace key={household.id} household={household} />;
}

function HouseholdWorkspace({ household }: { household: Household }) {
  const { pathname } = useLocation();
  const home = pathname.endsWith('/home');
  const shopping = pathname.includes('/shopping');
  const item = pathname.match(/\/inventory\/([^/]+)$/);
  const locationCheck = pathname.includes('/locations/');
  const base = `/households/${household.id}`;
  return (
    <>
      {!home && (
        <div
          className={`workspace-heading${item ? ' workspace-heading-detail' : ''}`}
        >
          <div>
            <Link className="link household-link" to="/households">
              ← Households
            </Link>
            <p className="eyebrow">{household.name}</p>
            <h1>
              {home
                ? 'Home'
                : shopping
                  ? 'Shopping'
                  : item
                    ? 'Item detail'
                    : locationCheck
                      ? 'Location check'
                      : 'Inventory'}
            </h1>
            {!item && (
              <p className="page-subtitle">
                {home
                  ? 'A calmer way to care for what’s at home.'
                  : shopping
                    ? 'A little planning. A happier home.'
                    : 'What’s at home, and what needs attention?'}
              </p>
            )}
          </div>
          {item ? (
            <Link className="secondary" to={`${base}/inventory`}>
              ← All items
            </Link>
          ) : (
            <Doodle
              kind={shopping ? 'basket' : 'inventory'}
              className="heading-doodle"
            />
          )}
        </div>
      )}
      <nav
        className={`workspace-nav${home ? ' home-nav' : ''}`}
        aria-label="Household sections"
      >
        <Link
          className={home ? 'selected' : ''}
          aria-current={home ? 'page' : undefined}
          to={`${base}/home`}
        >
          <Doodle kind="home" />
          <span>Home</span>
        </Link>
        <Link
          className={!home && !shopping ? 'selected' : ''}
          aria-current={!home && !shopping ? 'page' : undefined}
          to={`${base}/inventory`}
        >
          <Doodle kind="inventory" />
          <span>Inventory</span>
        </Link>
        <Link
          className={shopping ? 'selected' : ''}
          aria-current={shopping ? 'page' : undefined}
          to={`${base}/shopping`}
        >
          <Doodle kind="basket" />
          <span>Shopping</span>
        </Link>
        <Link to="/households">
          <Doodle kind="household" />
          <span>Households</span>
        </Link>
      </nav>
      <Outlet context={{ household }} />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <NetworkStatus />
      <SessionRoutes />
    </BrowserRouter>
  );
}

function NetworkStatus() {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online ? null : (
    <div className="offline-banner" role="status">
      You’re offline. Live household data is unavailable, and changes are never
      queued for later.
    </div>
  );
}
