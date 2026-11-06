import type { Assessment, Item } from '@/shared/api/types';
import { ItemVisual, StockBadge } from '@/shared/ui/primitives';
import { tr } from '@/shared/i18n';

export function ItemDetailIdentity({
  item,
  assessment,
}: {
  item: Item;
  assessment?: Assessment;
}) {
  return (
    <div className="detail-intro">
      <div>
        <p className="eyebrow">{tr('item-detail:littlePartHome')}</p>
        <h2 className="detail-title">{item.name}</h2>
        {item.archivedAt && (
          <p className="muted">{tr('item-detail:archivedStockHistory')}</p>
        )}
        <div className="detail-badges">
          {!item.archivedAt && <StockBadge status={assessment?.lowStockRisk} />}
          {!item.archivedAt && assessment?.expiryRisk === 'USE_SOON' && (
            <StockBadge status="USE_SOON" />
          )}
        </div>
      </div>
      <ItemVisual name={item.name} large />
    </div>
  );
}
