import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router';
import { useHousehold } from '@/shared/household/HouseholdContext';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type {
  CatalogOption,
  Intelligence,
  Item,
  User,
} from '@/shared/api/types';
import { Card, Notice } from '@/shared/ui/primitives';
import { ItemLifecyclePanel } from './ItemLifecyclePanel';
import { ItemDetailIdentity } from './ItemDetailIdentity';
import { ItemDetailStockSummary } from './ItemDetailStockSummary';
import {
  ItemDetailAssessment,
  shouldShowReasonExplanations,
} from './ItemDetailAssessment';
import { ItemDetailHistory } from './ItemDetailHistory';
import { ItemDetailManagementSection } from './ItemDetailManagementSection';
import { QuantityStockActions } from './QuantityStockActions';
import { useQuantityStockActions } from './useQuantityStockActions';
import { OpeningActions } from './OpenedQuantityActions';
import { StateModeActions } from './StateModeActions';
import { ConfigForm, OpeningConfigForm } from './ItemStockConfiguration';

import { localizedError, tr } from '@/shared/i18n';
export function ItemDetailPage() {
  const household = useHousehold();
  const { itemId = '' } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState(
    (location.state as { notice?: string } | null)?.notice ?? '',
  );
  const itemQuery = useQuery({
    queryKey: keys.item(household.id, itemId),
    queryFn: () => api<Item>(`/households/${household.id}/items/${itemId}`),
  });
  const intelligence = useQuery({
    queryKey: keys.intelligence(household.id, ''),
    queryFn: () =>
      api<Intelligence>(`/households/${household.id}/stock-intelligence`),
  });
  const locations = useQuery({
    queryKey: keys.catalog(household.id, 'locations'),
    queryFn: () =>
      api<CatalogOption[]>(`/households/${household.id}/locations`),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: keys.item(household.id, itemId),
      }),
      queryClient.invalidateQueries({ queryKey: keys.items(household.id) }),
      queryClient.invalidateQueries({
        queryKey: keys.intelligencePrefix(household.id),
      }),
      queryClient.invalidateQueries({
        queryKey: keys.needsAttention(household.id),
      }),
      queryClient.invalidateQueries({
        queryKey: keys.recentActivity(household.id),
      }),
      queryClient.invalidateQueries({ queryKey: keys.trips(household.id) }),
      queryClient.invalidateQueries({
        queryKey: keys.tripDetailsPrefix(household.id),
      }),
    ]);
  };
  const quantityActions = useQuantityStockActions({
    householdId: household.id,
    itemId,
    item: itemQuery.data,
    onRefresh: refresh,
    onNotice: setNotice,
  });
  const item = itemQuery.data;
  const locationName = (
    locationId: string,
    relation?: { name: string } | null,
  ) =>
    relation?.name ??
    locations.data?.find((place) => place.id === locationId)?.name ??
    locationId;
  const correctionLocations = new Map<string, { name: string; part: string }>();
  if (item?.trackingMode === 'QUANTITY') {
    for (const batch of item.batches) {
      if (batch.locationId)
        correctionLocations.set(batch.locationId, {
          name: locationName(batch.locationId, batch.location),
          part: tr('item-detail:quantityAtLocation'),
        });
    }
    if (
      item.preferredRestockLocationId &&
      !correctionLocations.has(item.preferredRestockLocationId)
    )
      correctionLocations.set(item.preferredRestockLocationId, {
        name: locationName(
          item.preferredRestockLocationId,
          item.preferredRestockLocation,
        ),
        part: tr('item-detail:quantityAtLocation'),
      });
  } else if (item) {
    if (item.currentLocationId)
      correctionLocations.set(item.currentLocationId, {
        name: locationName(item.currentLocationId, item.currentLocation),
        part: tr('item-detail:currentPart'),
      });
    if (item.backupLocationId) {
      const current = correctionLocations.get(item.backupLocationId);
      correctionLocations.set(item.backupLocationId, {
        name: locationName(item.backupLocationId, item.backupLocation),
        part: current
          ? tr('item-detail:currentAndBackups')
          : tr('item-detail:backupsPart'),
      });
    }
  }
  const correctionChoices = [...correctionLocations].map(
    ([locationId, value]) => ({
      locationId,
      ...value,
      to: `/households/${household.id}/locations/${locationId}/check?itemId=${encodeURIComponent(itemId)}&correct=1`,
    }),
  );
  const hasUnlocatedQuantity =
    item?.trackingMode === 'QUANTITY' &&
    item.batches.some((batch) => !batch.locationId);
  const hasMissingStateLocation =
    item?.trackingMode !== 'QUANTITY' &&
    (!item?.currentLocationId || !item?.backupLocationId);
  const assessment = intelligence.data?.assessments.find(
    (entry) => entry.itemId === itemId,
  );
  const showReasonExplanations = shouldShowReasonExplanations(assessment);
  const signedInUser = queryClient.getQueryData<User>(keys.session);

  if (itemQuery.isPending)
    return (
      <Card>
        <p className="muted">{tr('common:loadingItemDetail')}</p>
      </Card>
    );
  if (itemQuery.isError)
    return (
      <>
        {notice && <Notice kind="success">{notice}</Notice>}
        <Notice kind="error">
          {notice
            ? `The item was saved, but its latest detail could not be refreshed. Check Inventory or retry opening this item. ${localizedError(itemQuery.error)}`
            : localizedError(itemQuery.error)}
        </Notice>
      </>
    );
  if (!item)
    return (
      <Notice kind="error">{tr('item-detail:itemDetailUnavailable')}</Notice>
    );
  return (
    <>
      <ItemDetailIdentity item={item} assessment={assessment} />
      {notice && <Notice kind="success">{notice}</Notice>}
      {!item.archivedAt &&
        !quantityActions.undoCandidate &&
        quantityActions.undoAction.isError && (
          <Notice kind="error">
            {localizedError(quantityActions.undoAction.error)}
          </Notice>
        )}
      {intelligence.isError && (
        <Notice kind="error">
          {tr('item-detail:assessmentLoaded')}{' '}
          {localizedError(intelligence.error)}
        </Notice>
      )}
      <div
        className={
          item.trackingMode === 'QUANTITY'
            ? 'detail-grid'
            : 'detail-grid state-detail'
        }
      >
        <div className="stack detail-overview">
          <ItemDetailStockSummary
            item={item}
            assessment={assessment}
            correctionChoices={correctionChoices}
            hasUnlocatedQuantity={hasUnlocatedQuantity}
            hasMissingStateLocation={hasMissingStateLocation}
          />
          <ItemDetailAssessment
            item={item}
            assessment={assessment}
            shoppingDate={intelligence.data?.shoppingDate}
            isPending={intelligence.isPending}
            showReasonExplanations={showReasonExplanations}
          />
        </div>
        {!item.archivedAt && item.trackingMode === 'QUANTITY' && (
          <div className="stack detail-actions">
            <QuantityStockActions
              item={item}
              actions={quantityActions}
              locations={{
                data: locations.data,
                isPending: locations.isPending,
                isError: locations.isError,
                error: locations.error,
              }}
            />
            {item.openedTrackingEnabled && (
              <OpeningActions
                householdId={household.id}
                item={item}
                onRefresh={refresh}
              />
            )}
          </div>
        )}
        {!item.archivedAt && item.trackingMode !== 'QUANTITY' && (
          <StateModeActions
            householdId={household.id}
            item={item}
            recommendedAction={assessment?.recommendedAction}
            onRefresh={refresh}
          />
        )}
        <ItemDetailHistory
          item={item}
          locations={locations.data ?? []}
          signedInUserId={signedInUser?.id}
        />
      </div>
      {household.role === 'ADMIN' && (
        <ItemDetailManagementSection>
          <ItemLifecyclePanel householdId={household.id} item={item} />
          {!item.archivedAt && item.trackingMode === 'QUANTITY' && (
            <>
              <ConfigForm
                householdId={household.id}
                item={item}
                onSaved={refresh}
              />
              <OpeningConfigForm
                householdId={household.id}
                item={item}
                onSaved={refresh}
              />
            </>
          )}
        </ItemDetailManagementSection>
      )}
    </>
  );
}
