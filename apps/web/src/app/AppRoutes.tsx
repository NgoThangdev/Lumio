import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { AuthPage } from '@/features/auth/AuthPage';
import { authReturnPath } from '@/features/auth/returnPath';
import { HouseholdsPage } from '@/features/households/HouseholdsPage';
import { HouseholdMembersPage } from '@/features/households/HouseholdMembersPage';
import { InvitationPage } from '@/features/households/InvitationPage';
import { HomePage } from '@/features/home/HomePage';
import { InventoryPage } from '@/features/inventory/list/InventoryPage';
import { ItemDetailPage } from '@/features/inventory/item-detail/ItemDetailPage';
import { LocationStockCheckPage } from '@/features/inventory/location-check/LocationStockCheckPage';
import { QuickPurchasePage } from '@/features/shopping/QuickPurchasePage';
import { ShoppingPage } from '@/features/shopping/ShoppingPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AttentionPage } from '@/features/attention/AttentionPage';
import { api } from '@/shared/api/client';
import type { User } from '@/shared/api/types';
import { SignedInShell } from './SignedInShell';
import { RequireSignIn } from './RequireSignIn';
import { HouseholdBoundary } from './household/HouseholdBoundary';

export function AppRoutes({
  user,
  onSessionChange,
}: {
  user: User | null;
  onSessionChange: (user: User | null) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();

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
            <AuthPage onAuthed={onSessionChange} />
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
                onSessionChange(null);
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
