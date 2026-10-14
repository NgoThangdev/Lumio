import {
  rankStockChecks,
  type StockCheckCandidate,
} from './stock-check-ranking.js';

const at = new Date('2026-10-12T12:00:00.000Z');

function item(
  id: string,
  overrides: Partial<StockCheckCandidate> = {},
): StockCheckCandidate {
  return {
    id,
    stockRevision: 0,
    trackingMode: 'QUANTITY',
    currentLevel: null,
    isPresent: null,
    batches: [],
    actions: [],
    stateActions: [],
    stockChecks: [],
    ...overrides,
  };
}

describe('pre-shopping shortlist', () => {
  it('includes an unsuggested stale item, excludes a recent low-stock item, and ranks missing state first', () => {
    const ranked = rankStockChecks(
      [
        item('recent-low', {
          batches: [{ createdAt: new Date('2026-10-11T00:00:00.000Z') }],
        }),
        item('stale-unsuggested', {
          actions: [{ createdAt: new Date('2026-08-01T00:00:00.000Z') }],
        }),
        item('missing-level', { trackingMode: 'FIVE_LEVEL' }),
        item('recent-presence', {
          trackingMode: 'PRESENCE_BACKUP',
          isPresent: true,
          stateActions: [{ createdAt: new Date('2026-10-11T00:00:00.000Z') }],
        }),
      ],
      at,
    );
    expect(
      ranked.map((candidate) => [candidate.itemId, candidate.reason]),
    ).toEqual([
      ['missing-level', 'MISSING_STATE'],
      ['stale-unsuggested', 'STALE_RECORD'],
    ]);
  });

  it('uses a prior physical check as fresh evidence and bounds the shortlist', () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      item(`item-${index}`),
    );
    candidates.push(
      item('checked', {
        stockChecks: [
          { checkedAt: new Date('2026-10-11T00:00:00.000Z'), revision: 0 },
        ],
      }),
    );
    expect(
      rankStockChecks(candidates, at).map((candidate) => candidate.itemId),
    ).toEqual(['item-0', 'item-1', 'item-2', 'item-3', 'item-4']);
  });
});
