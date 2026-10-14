export interface StockCheckCandidate {
  id: string;
  stockRevision: number;
  trackingMode: 'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP';
  currentLevel: string | null;
  isPresent: boolean | null;
  batches: { createdAt: Date }[];
  actions: { createdAt: Date }[];
  stateActions: { createdAt: Date }[];
  stockChecks: { checkedAt: Date | null; revision: number }[];
}

export function rankStockChecks(
  items: StockCheckCandidate[],
  at: Date,
  limit = 5,
) {
  const threshold = at.getTime() - 30 * 86_400_000;
  return items
    .flatMap((item) => {
      const missing =
        item.trackingMode === 'FIVE_LEVEL'
          ? item.currentLevel === null
          : item.trackingMode === 'PRESENCE_BACKUP' && item.isPresent === null;
      const dates = [
        ...item.batches.map((batch) => batch.createdAt),
        ...item.actions.map((action) => action.createdAt),
        ...item.stateActions.map((action) => action.createdAt),
        ...item.stockChecks
          .filter((check) => check.revision === item.stockRevision)
          .map((check) => check.checkedAt),
      ].filter((date): date is Date => date !== null);
      const newest = dates.length
        ? Math.max(...dates.map((date) => date.getTime()))
        : null;
      if (!missing && newest !== null && newest >= threshold) return [];
      return [
        {
          itemId: item.id,
          revision: item.stockRevision,
          reason: missing
            ? 'MISSING_STATE'
            : newest === null
              ? 'NO_STOCK_RECORD'
              : 'STALE_RECORD',
          age: newest ?? 0,
        },
      ];
    })
    .sort(
      (a, b) =>
        (a.reason === 'MISSING_STATE' ? -1 : 0) -
          (b.reason === 'MISSING_STATE' ? -1 : 0) ||
        a.age - b.age ||
        a.itemId.localeCompare(b.itemId),
    )
    .slice(0, limit);
}
