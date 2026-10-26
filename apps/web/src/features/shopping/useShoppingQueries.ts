import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type {
  CatalogOption,
  HouseholdShoppingSettings,
  Intelligence,
  Item,
} from '@/shared/api/types';
import type { Trip, TripSummary } from './shoppingTypes';

export function useShoppingQueries(householdId: string, tripId?: string) {
  const tripPath = `/households/${householdId}/trips`;
  const trips = useQuery({
    queryKey: keys.trips(householdId),
    queryFn: () => api<TripSummary[]>(tripPath),
  });
  const trip = useQuery({
    queryKey: keys.trip(householdId, tripId ?? ''),
    queryFn: () => api<Trip>(`${tripPath}/${tripId}`),
    enabled: Boolean(tripId),
  });
  const items = useQuery({
    queryKey: keys.items(householdId),
    queryFn: () => api<Item[]>(`/households/${householdId}/items`),
  });
  const intelligence = useQuery({
    queryKey: keys.intelligence(householdId, ''),
    queryFn: () =>
      api<Intelligence>(`/households/${householdId}/stock-intelligence`),
  });
  const shoppingSettings = useQuery({
    queryKey: keys.shoppingSettings(householdId),
    queryFn: () =>
      api<HouseholdShoppingSettings>(
        `/households/${householdId}/shopping-settings`,
      ),
    enabled: !tripId,
  });
  const locations = useQuery({
    queryKey: keys.catalog(householdId, 'locations'),
    queryFn: () => api<CatalogOption[]>(`/households/${householdId}/locations`),
  });

  return { trips, trip, items, intelligence, shoppingSettings, locations };
}
