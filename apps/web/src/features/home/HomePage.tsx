import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useHousehold } from '@/shared/household/HouseholdContext';
import { api } from '../../shared/api/client';
import { keys } from '../../shared/api/keys';
import type {
  InventoryRead,
  Item,
  NeedsAttention,
  RecentActivityEvent,
  User,
} from '../../shared/api/types';
import { tr } from '../../shared/i18n';
import { ControlIcon } from '../../shared/ui/ControlIcon';
import { HomeActivitySection } from './HomeActivitySection';
import { HomeAttentionSection } from './HomeAttentionSection';
import { HomeQuickActions } from './HomeQuickActions';
import { HomeSnapshotSection } from './HomeSnapshotSection';
import { HomeTripSection, type TripSummary } from './HomeTripSection';

export function HomePage() {
  const household = useHousehold();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = `/households/${household.id}`;
  const [search, setSearch] = useState('');
  const attention = useQuery({
    queryKey: keys.needsAttention(household.id),
    queryFn: () => api<NeedsAttention>(`${base}/home/needs-attention`),
  });
  const stock = useQuery({
    queryKey: keys.inventoryRead(household.id, 'groupBy=none'),
    queryFn: async () => {
      const result = await api<InventoryRead | Item[]>(
        `${base}/items?groupBy=none`,
      );
      if (Array.isArray(result) || !result || !Array.isArray(result.items)) {
        throw new Error(tr('home:inventoryResponseMissing'));
      }
      return result;
    },
    enabled: !!attention.data?.items.length,
  });
  const snapshot = useQuery({
    queryKey: keys.inventoryRead(household.id, 'groupBy=location'),
    queryFn: async () => {
      const result = await api<InventoryRead | Item[]>(
        `${base}/items?groupBy=location`,
      );
      if (Array.isArray(result) || !result || !Array.isArray(result.groups)) {
        throw new Error(tr('home:locationGroupsMissing'));
      }
      return result;
    },
  });
  const trips = useQuery({
    queryKey: keys.trips(household.id),
    queryFn: () => api<TripSummary[]>(`${base}/trips`),
  });
  const activity = useQuery({
    queryKey: keys.recentActivity(household.id),
    queryFn: () =>
      api<{ items: RecentActivityEvent[] }>(
        `/households/${household.id}/home/activity`,
      ),
  });
  const currentUserId = queryClient.getQueryData<User>(keys.session)?.id;
  const nextTrip = trips.data
    ?.filter((trip) => trip.status !== 'RESTOCKED')
    .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))[0];

  return (
    <div className="home-page">
      <form
        className="home-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate(
            `${base}/inventory${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`,
          );
        }}
      >
        <label className="sr-only" htmlFor="home-search-input">
          {tr('common:searchItem')}
        </label>
        <input
          id="home-search-input"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tr('home:searchItemPrompt')}
        />
        <button
          className="home-search-submit"
          type="submit"
          aria-label={tr('home:searchInventory')}
          title={tr('home:searchInventory')}
        >
          <ControlIcon name="search" />
        </button>
      </form>

      <HomeAttentionSection base={base} attention={attention} stock={stock} />
      <HomeQuickActions base={base} />
      <HomeTripSection base={base} trips={trips} nextTrip={nextTrip} />
      <HomeSnapshotSection base={base} snapshot={snapshot} />
      <HomeActivitySection
        base={base}
        activity={activity}
        currentUserId={currentUserId}
      />
    </div>
  );
}
