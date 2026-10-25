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
import { authReturnPath } from '../features/auth/returnPath';
import { HouseholdsPage } from '../features/households/HouseholdsPage';
import { HouseholdMembersPage } from '../features/households/HouseholdMembersPage';
import { InvitationPage } from '../features/households/InvitationPage';
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
import { ControlIcon } from '../shared/ui/ControlIcon';
import { Button, Notice } from '../shared/ui/primitives';
import { localizedError, tr } from '../shared/i18n';
import { useTranslation } from 'react-i18next';

function setSession(queryClient: QueryClient, user: User | null) {
  queryClient.removeQueries({
    predicate: ({ queryKey }) => queryKey[0] !== keys.session[0],
  });
  queryClient.getMutationCache().clear();
  queryClient.setQueryData(keys.session, user);
}

function SessionRoutes() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
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
    return <main className="loading">{tr('common:checkingSession')}</main>;
  if (session.isError)
    return (
      <main className="loading">
        <Notice kind="error">{localizedError(session.error)}</Notice>
        <Button onClick={() => void session.refetch()}>
          {tr('common:retrySessionCheck')}
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
            <Navigate
              to={authReturnPath(
                (location.state as { from?: unknown } | null)?.from,
              )}
              replace
            />
          ) : (
            <AuthPage
              onAuthed={(next) => {
                setSession(queryClient, next);
              }}
            />
          )
        }
      />
      <Route path="/invite/:secret" element={<InvitationPage user={user} />} />
      <Route element={user ? <SignedInShell user={user} /> : <RequireSignIn />}>
        <Route path="/attention" element={<AttentionPage user={user!} />} />
        <Route
          path="/settings"
          element={
            <SettingsPage
              user={user!}
              onSignOut={async () => {
                await api('/auth/sign-out', 'POST');
                setSession(queryClient, null);
                void navigate('/sign-in', { replace: true });
              }}
            />
          }
        />
        <Route path="/households" element={<HouseholdsPage />} />
        <Route path="/households/:householdId" element={<HouseholdBoundary />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route
            path="members"
            element={<HouseholdMembersPage user={user!} />}
          />
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
  const { pathname, search, hash } = useLocation();
  const [compactHeader, setCompactHeader] = useState(() => window.scrollY > 24);
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  useEffect(() => {
    const onScroll = () => setCompactHeader(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const householdId =
    pathname.match(/^\/households\/([^/]+)(?:\/|$)/)?.[1] ??
    (pathname === '/settings'
      ? new URLSearchParams(search).get('householdId')
      : null);
  return (
    <div className="shell">
      <header className={`topbar${compactHeader ? ' is-compact' : ''}`}>
        <Link
          className="brand"
          to="/households"
          aria-label={tr('common:lumioHouseholdsTitle')}
        >
          <Brand />
          <span className="brand-tagline">{tr('common:homeStuffHappier')}</span>
        </Link>
        <div className="top-actions">
          <small>{user.email}</small>
          <Link
            className="settings-icon-link"
            to={
              householdId
                ? `/settings?householdId=${encodeURIComponent(householdId)}`
                : '/settings'
            }
            aria-label={tr('common:settings')}
            title={tr('common:settings')}
          >
            <ControlIcon name="setting" />
          </Link>
        </div>
      </header>
      <main className="content">
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
  if (households.isPending)
    return <p className="muted">{tr('common:loadingHousehold')}</p>;
  if (households.isError)
    return <Notice kind="error">{localizedError(households.error)}</Notice>;
  const household = households.data.find((entry) => entry.id === householdId);
  if (!household) return <Navigate to="/households" replace />;
  return <HouseholdWorkspace key={household.id} household={household} />;
}

function HouseholdWorkspace({ household }: { household: Household }) {
  const { pathname } = useLocation();
  const home = pathname.endsWith('/home');
  const shopping = pathname.includes('/shopping');
  const tripDetail =
    shopping &&
    !pathname.endsWith('/quick-purchase') &&
    /\/shopping\/[^/]+$/.test(pathname);
  const item = pathname.match(/\/inventory\/([^/]+)$/);
  const locationCheck = pathname.includes('/locations/');
  const members = pathname.endsWith('/members');
  const base = `/households/${household.id}`;
  return (
    <>
      {!home && !tripDetail && !locationCheck && (
        <div
          className={`workspace-heading${item ? ' workspace-heading-detail' : ''}`}
        >
          <div>
            <Link className="link household-link" to="/households">
              {tr('common:households3')}
            </Link>
            <p className="eyebrow">{household.name}</p>
            <h1>
              {home
                ? tr('common:home')
                : shopping
                  ? tr('common:shopping2')
                  : item
                    ? tr('common:itemDetail')
                    : locationCheck
                      ? tr('common:locationCheck')
                      : members
                        ? tr('common:membersInvites')
                        : tr('common:inventory')}
            </h1>
            {!item && (
              <p className="page-subtitle">
                {home
                  ? tr('common:calmerWayCare')
                  : shopping
                    ? tr('common:littlePlanningHappier')
                    : members
                      ? tr('common:manageSharesHousehold')
                      : tr('common:sHomeNeeds')}
              </p>
            )}
          </div>
          {item ? (
            <Link className="secondary" to={`${base}/inventory`}>
              {tr('common:allItems')}
            </Link>
          ) : household.role === 'ADMIN' && !members ? (
            <Link
              className="secondary members-link"
              to={`${base}/members`}
              aria-label={tr('common:membersInvites')}
              title={tr('common:membersInvites')}
            >
              <ControlIcon name="adduser" />
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
        aria-label={tr('common:householdSectionsTitle')}
      >
        <Link
          className={home ? 'selected' : ''}
          aria-current={home ? 'page' : undefined}
          to={`${base}/home`}
        >
          <ControlIcon name="homeicon" />
          <span>{tr('common:home')}</span>
        </Link>
        <Link
          className={!home && !shopping && !members ? 'selected' : ''}
          aria-current={!home && !shopping && !members ? 'page' : undefined}
          to={`${base}/inventory`}
        >
          <ControlIcon name="clipboard" />
          <span>{tr('common:inventory')}</span>
        </Link>
        <Link
          className={shopping ? 'selected' : ''}
          aria-current={shopping ? 'page' : undefined}
          to={`${base}/shopping`}
        >
          <ControlIcon name="shoppingcart" />
          <span>{tr('common:shopping2')}</span>
        </Link>
        <Link to="/households">
          <ControlIcon name="warehouse" />
          <span>{tr('common:households')}</span>
        </Link>
      </nav>
      <Outlet context={{ household }} />
    </>
  );
}

export function App() {
  useTranslation();
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
      {tr('common:reOfflineLive')}
    </div>
  );
}
