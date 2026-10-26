import { Link } from 'react-router';
import type {
  CatalogOption,
  InventoryGroupEntry,
  InventoryRead,
  Item,
} from '@/shared/api/types';
import { ItemVisual, Notice, StockBadge } from '@/shared/ui/primitives';
import { Doodle } from '@/shared/ui/Doodle';
import { ControlIcon } from '@/shared/ui/ControlIcon';
import { formatNumber, localizedEnum, tr } from '@/shared/i18n';
import { localizedError } from '@/shared/i18n';

function locationLabel(item: Item, locations?: CatalogOption[]) {
  if (item.trackingMode === 'QUANTITY') {
    const names = [
      ...new Set(
        item.batches
          .map(
            (batch) =>
              locations?.find((location) => location.id === batch.locationId)
                ?.name,
          )
          .filter(Boolean),
      ),
    ];
    return names.length
      ? names.join(', ')
      : item.batches.some((batch) => batch.locationId)
        ? tr('inventory:seeBatchLocations')
        : tr('common:locationSet');
  }
  if (item.currentLocation?.name)
    return `${tr('common:current')} ${item.currentLocation.name}`;
  if (item.backupLocation?.name)
    return `${tr('common:backups')} ${item.backupLocation.name}`;
  return tr('common:locationSet');
}

function InventoryItemRow({
  item,
  assessment,
  base,
  place,
  stock,
  locations,
}: {
  item: Item;
  assessment: InventoryRead['items'][number]['assessment'];
  base: string;
  place?: string;
  stock?: InventoryGroupEntry;
  locations?: CatalogOption[];
}) {
  const amount =
    item.trackingMode === 'QUANTITY'
      ? `${formatNumber(stock ? (stock.quantity ?? '—') : (assessment.eligibleStock ?? '—'))} ${item.primaryUnit}`
      : item.trackingMode === 'FIVE_LEVEL'
        ? `${stock ? (stock.currentLevel ? localizedEnum(stock.currentLevel) : tr('inventory:currentItemHere')) : item.currentLevel ? localizedEnum(item.currentLevel) : '—'} · ${formatNumber(stock?.backupCount ?? item.backupCount)} ${tr('common:backups2')}`
        : `${stock ? (stock.isPresent === null ? tr('inventory:currentItemHere') : tr(stock.isPresent ? 'common:present' : 'common:absent')) : tr(item.isPresent ? 'common:present' : 'common:absent')} · ${formatNumber(stock?.backupCount ?? item.backupCount)} ${tr('common:backups2')}`;

  return (
    <Link className="row inventory-row" to={`${base}/inventory/${item.id}`}>
      <ItemVisual name={item.name} />
      <span className="item-identity">
        <strong>{item.name}</strong>
        <small className="inventory-amount">{amount}</small>
        {(place ?? (stock ? '' : locationLabel(item, locations))) && (
          <small className="location-note">
            {place ?? locationLabel(item, locations)}
          </small>
        )}
      </span>
      <span className="item-status">
        <StockBadge status={stock?.lowStockRisk ?? assessment.lowStockRisk} />
        {(stock?.expiryRisk ?? assessment.expiryRisk) === 'USE_SOON' && (
          <StockBadge status="USE_SOON" />
        )}
      </span>
      <span className="row-arrow" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

export function InventoryResults({
  inventory,
  isPending,
  error,
  groupBy,
  base,
  locations,
  hasFilters,
}: {
  inventory?: InventoryRead;
  isPending: boolean;
  error: Error | null;
  groupBy: string;
  base: string;
  locations?: CatalogOption[];
  hasFilters: boolean;
}) {
  if (isPending)
    return (
      <p className="muted" role="status">
        {tr('common:loadingInventory')}
      </p>
    );
  if (error) return <Notice kind="error">{localizedError(error)}</Notice>;
  if (!inventory) return null;
  if (inventory.items.length === 0)
    return (
      <div className="empty">
        <ItemVisual name="Inventory" large />
        <h3>
          {hasFilters ? tr('inventory:matchingItems') : tr('common:itemsYet')}
        </h3>
        <p>
          {hasFilters
            ? tr('inventory:tryDifferentSearch')
            : tr('inventory:addItemStarting')}
        </p>
      </div>
    );
  if (groupBy === 'none')
    return (
      <div className="inventory-ungrouped">
        {inventory.items.map(({ item, assessment }) => (
          <InventoryItemRow
            key={item.id}
            item={item}
            assessment={assessment}
            base={base}
            locations={locations}
          />
        ))}
      </div>
    );

  return (
    <>
      {inventory.groups?.map((group) => (
        <details className="inventory-group" key={group.id ?? 'unlocated'} open>
          <summary className="inventory-group-heading">
            <Doodle kind="inventory" />
            <span className="inventory-group-title">{group.name}</span>
            <span className="inventory-group-count">
              {group.entries.length}{' '}
              {tr(group.entries.length === 1 ? 'common:item' : 'common:items')}
            </span>
            <span className="inventory-group-chevron" aria-hidden="true">
              <ControlIcon
                name="arrowdown"
                className="inventory-chevron-closed"
              />
              <ControlIcon name="arrowup" className="inventory-chevron-open" />
            </span>
          </summary>
          {group.entries.map((entry) => {
            const match = inventory.items.find(
              ({ item }) => item.id === entry.itemId,
            );
            return (
              match && (
                <InventoryItemRow
                  key={entry.itemId}
                  item={match.item}
                  assessment={match.assessment}
                  base={base}
                  place={
                    groupBy === 'location'
                      ? undefined
                      : locationLabel(match.item, locations)
                  }
                  stock={groupBy === 'location' ? entry : undefined}
                  locations={locations}
                />
              )
            );
          })}
        </details>
      ))}
    </>
  );
}
