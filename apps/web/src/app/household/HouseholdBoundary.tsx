import { Navigate, Outlet, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { Household } from '@/shared/api/types';
import { localizedError, tr } from '@/shared/i18n';
import { Notice } from '@/shared/ui/primitives';
import { HouseholdProvider } from '@/shared/household/HouseholdContext';
import { HouseholdShell } from './HouseholdShell';

export function HouseholdBoundary() {
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
  return (
    <HouseholdProvider key={household.id} household={household}>
      <HouseholdShell>
        <Outlet />
      </HouseholdShell>
    </HouseholdProvider>
  );
}
