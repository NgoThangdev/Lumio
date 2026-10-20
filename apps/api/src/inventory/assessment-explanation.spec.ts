import { Prisma } from '../generated/prisma/browser.js';
import { rankNeedsAttention } from './needs-attention.service.js';
import {
  assessStateItem,
  type StateAssessmentItem,
} from './state-assessment.js';
import { assessItem, type IntelligenceItem } from './stock-intelligence.js';

const at = new Date('2026-10-09T03:00:00.000Z');
const decimal = (value: string) => new Prisma.Decimal(value);
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function quantity(overrides: Partial<IntelligenceItem> = {}) {
  return {
    ...assessItem(
      {
        id: 'quantity',
        name: 'Quantity',
        primaryUnit: 'box',
        minimumStock: null,
        lowStockThreshold: null,
        buyThreshold: null,
        targetStock: null,
        openedTrackingEnabled: false,
        neverRunOut: false,
        predictionEnabled: false,
        batches: [],
        actions: [],
        ...overrides,
      },
      at,
      '2026-10-15',
    ),
    trackingMode: 'QUANTITY' as const,
  };
}

function state(overrides: Partial<StateAssessmentItem> = {}) {
  return assessStateItem({
    id: 'state',
    name: 'State',
    primaryUnit: 'bottle',
    trackingMode: 'FIVE_LEVEL',
    currentLevel: 'FULL',
    isPresent: null,
    backupCount: 0,
    lowAtLevel: 'HALF',
    buyAtLevel: 'QUARTER',
    neverRunOut: false,
    ...overrides,
  });
}

describe('state assessment explanations', () => {
  it('pairs five-level stock and open-refill reasons with raw state values', () => {
    const result = state({ currentLevel: 'EMPTY', backupCount: 2 });
    expect(result).toMatchObject({
      lowStockRisk: 'LOW',
      recommendedAction: 'OPEN_REFILL',
      reasons: [
        'Current container is EMPTY; 2 refill(s) remain.',
        'Open one available backup before buying.',
      ],
      reasonExplanations: [
        {
          code: 'FIVE_LEVEL_CURRENT_AND_BACKUPS',
          params: { level: 'EMPTY', backupCount: 2 },
        },
        { code: 'STATE_OPEN_BACKUP_BEFORE_BUY' },
      ],
      expiryExplanation: null,
      prediction: { explanation: { code: 'PREDICTION_NOT_APPLICABLE' } },
      suggestion: null,
    });
  });

  it('keeps five-level low threshold and buy-refill explanations distinct', () => {
    const low = state({ currentLevel: 'HALF' });
    expect(low.lowStockRisk).toBe('LOW');
    expect(low.reasonExplanations.at(-1)).toEqual({
      code: 'FIVE_LEVEL_AT_LOW_THRESHOLD',
      params: { lowAtLevel: 'HALF' },
    });
    const buy = state({ currentLevel: 'QUARTER', neverRunOut: true });
    expect(buy).toMatchObject({
      lowStockRisk: 'BUY',
      recommendedAction: 'BUY_BACKUP',
      purchasePriority: 'MUST_BUY',
    });
    expect(buy.reasons.at(-1)).toBe(
      'No backup remains for this never-run-out item; buy a refill.',
    );
    expect(buy.reasonExplanations.at(-1)).toEqual({
      code: 'STATE_BUY_REFILL_NO_BACKUP',
      params: { neverRunOut: true },
    });
  });

  it('explains presence and backup decisions without inventing a quantity suggestion', () => {
    const out = state({
      trackingMode: 'PRESENCE_BACKUP',
      currentLevel: null,
      isPresent: false,
      backupCount: 0,
    });
    expect(out).toMatchObject({
      lowStockRisk: 'OUT',
      recommendedAction: 'BUY_BACKUP',
      reasons: [
        'Current item is absent; 0 backup(s) remain.',
        'No backup remains; buy a refill.',
      ],
      reasonExplanations: [
        {
          code: 'PRESENCE_CURRENT_AND_BACKUPS',
          params: { present: false, backupCount: 0 },
        },
        {
          code: 'STATE_BUY_REFILL_NO_BACKUP',
          params: { neverRunOut: false },
        },
      ],
      suggestion: null,
    });
    const open = state({
      trackingMode: 'PRESENCE_BACKUP',
      currentLevel: null,
      isPresent: false,
      backupCount: 1,
    });
    expect(open.recommendedAction).toBe('OPEN_REFILL');
    expect(open.reasonExplanations.at(-1)?.code).toBe(
      'STATE_OPEN_BACKUP_BEFORE_BUY',
    );
  });
});

describe('Home Needs Attention explanations', () => {
  it('keeps critical Buy primary and carries simultaneous expiry as support', () => {
    const result = quantity({
      id: 'critical',
      name: 'Critical',
      buyThreshold: decimal('2'),
      targetStock: decimal('8'),
      neverRunOut: true,
      batches: [{ quantity: decimal('1'), expiryDate: date('2026-10-09') }],
    });
    const [home] = rankNeedsAttention([result]);
    expect(home).toMatchObject({
      action: 'BUY',
      priority: 'CRITICAL',
      reason: 'Eligible stock is at or below the buy threshold of 2.',
      primaryExplanation: {
        code: 'QUANTITY_AT_OR_BELOW_BUY_THRESHOLD',
        params: { buyThreshold: '2', unit: 'box' },
      },
    });
    expect(home.supportingExplanations).toContainEqual({
      code: 'QUANTITY_USE_SOON',
      params: { quantity: '1', unit: 'box', throughDate: '2026-10-12' },
    });
  });

  it('selects expiry, Open refill, and state Buy reasons from the ranked branches', () => {
    const expiring = quantity({
      id: 'expiry',
      name: 'Expiry',
      batches: [{ quantity: decimal('3'), expiryDate: date('2026-10-10') }],
    });
    const open = state({
      id: 'open',
      name: 'Open',
      currentLevel: 'EMPTY',
      backupCount: 1,
    });
    const buy = state({
      id: 'buy',
      name: 'Buy',
      currentLevel: 'EMPTY',
      backupCount: 0,
    });
    const home = rankNeedsAttention([expiring, open, buy]);
    expect(
      home.map((entry) => [entry.itemId, entry.action, entry.priority]),
    ).toEqual([
      ['buy', 'BUY', 'CRITICAL'],
      ['expiry', 'USE_SOON', 'HIGH'],
      ['open', 'OPEN_REFILL', 'MEDIUM'],
    ]);
    expect(home.map((entry) => entry.primaryExplanation.code)).toEqual([
      'STATE_BUY_REFILL_NO_BACKUP',
      'QUANTITY_USE_SOON',
      'STATE_OPEN_BACKUP_BEFORE_BUY',
    ]);
    expect(home[0].supportingExplanations).toContainEqual({
      code: 'FIVE_LEVEL_CURRENT_AND_BACKUPS',
      params: { level: 'EMPTY', backupCount: 0 },
    });
    expect(home[1].reason).toBe(
      '3 box expires by 2026-10-12; use eligible batches soon.',
    );
  });
});
