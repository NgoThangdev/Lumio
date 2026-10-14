import { Prisma } from '../generated/prisma/browser.js';
import {
  effectiveExpiryDate,
  planAutomaticOpen,
  planOpenTransfer,
  planUse,
  type UseBatch,
} from './plan-use.js';

const decimal = (value: string) => new Prisma.Decimal(value);
const at = new Date('2026-10-09T12:00:00.000Z');

function batch(
  id: string,
  quantity: string,
  expiryDate: string | null,
  createdAt = '2026-10-01T00:00:00.000Z',
): UseBatch {
  return {
    id,
    quantity: decimal(quantity),
    expiryDate:
      expiryDate === null ? null : new Date(`${expiryDate}T00:00:00.000Z`),
    createdAt: new Date(createdAt),
  };
}

function allocationStrings(
  plan: ReturnType<typeof planUse>,
): [string, string][] {
  if (!plan.ok) throw new Error(`Expected a plan, received ${plan.reason}`);
  return plan.allocations.map(({ batchId, quantity }) => [
    batchId,
    quantity.toString(),
  ]);
}

describe('planUse', () => {
  it('allocates FEFO across batches without changing the input', () => {
    const batches = [
      batch('later', '8', '2026-10-20'),
      batch('earlier', '4', '2026-10-12'),
    ];
    const plan = planUse(decimal('6'), batches, at);

    expect(allocationStrings(plan)).toEqual([
      ['earlier', '4'],
      ['later', '2'],
    ]);
    expect(batches.map(({ quantity }) => quantity.toString())).toEqual([
      '8',
      '4',
    ]);
  });

  it('uses exact fractional decimal quantities whose allocations sum to the request', () => {
    const plan = planUse(
      decimal('0.8'),
      [
        batch('first', '0.3', '2026-10-12'),
        batch('second', '0.7', '2026-10-20'),
      ],
      at,
    );

    expect(allocationStrings(plan)).toEqual([
      ['first', '0.3'],
      ['second', '0.5'],
    ]);
    if (!plan.ok) throw new Error('Expected a successful plan');
    expect(
      plan.allocations
        .reduce(
          (sum, allocation) => sum.plus(allocation.quantity),
          decimal('0'),
        )
        .eq('0.8'),
    ).toBe(true);
  });

  it('puts undated batches after dated ones and orders them by creation time', () => {
    const plan = planUse(
      decimal('3'),
      [
        batch('new-undated', '1', null, '2026-10-03T00:00:00.000Z'),
        batch('old-undated', '1', null, '2026-10-01T00:00:00.000Z'),
        batch('dated', '1', '2026-10-20'),
      ],
      at,
    );

    expect(allocationStrings(plan)).toEqual([
      ['dated', '1'],
      ['old-undated', '1'],
      ['new-undated', '1'],
    ]);
  });

  it('keeps a batch eligible through its expiry date in Asia/Ho_Chi_Minh', () => {
    const batches = [batch('today', '1', '2026-10-09')];

    expect(
      allocationStrings(
        planUse(decimal('1'), batches, new Date('2026-10-09T16:59:59.999Z')),
      ),
    ).toEqual([['today', '1']]);
    expect(
      planUse(decimal('1'), batches, new Date('2026-10-09T17:00:00.000Z')),
    ).toEqual({
      ok: false,
      reason: 'INSUFFICIENT_STOCK',
    });
  });

  it.each(['0', '-0.1'])('rejects a non-positive request of %s', (quantity) => {
    expect(
      planUse(decimal(quantity), [batch('available', '2', null)], at),
    ).toEqual({
      ok: false,
      reason: 'INVALID_QUANTITY',
    });
  });

  it('rejects insufficient eligible stock without returning partial allocations', () => {
    expect(
      planUse(
        decimal('4'),
        [
          batch('eligible', '3', '2026-10-09'),
          batch('expired', '8', '2026-10-08'),
        ],
        at,
      ),
    ).toEqual({ ok: false, reason: 'INSUFFICIENT_STOCK' });
  });

  it('uses batch ID as a stable tie-break for otherwise equally ranked batches', () => {
    const batches = [
      batch('b', '1', '2026-10-20'),
      batch('a', '1', '2026-10-20'),
    ];
    expect(allocationStrings(planUse(decimal('2'), batches, at))).toEqual([
      ['a', '1'],
      ['b', '1'],
    ]);
  });
});

describe('opened package planning', () => {
  it('conserves total stock when one unopened container is opened', () => {
    const transfer = planOpenTransfer(decimal('3'));
    expect(transfer).not.toBeNull();
    if (!transfer) throw new Error('Expected a transfer');
    expect(transfer.sourceRemaining.toString()).toBe('2');
    expect(transfer.openedQuantity.toString()).toBe('1');
    expect(
      transfer.sourceRemaining.plus(transfer.openedQuantity).toString(),
    ).toBe('3');
    expect(planOpenTransfer(decimal('0.5'))).toBeNull();
  });

  it('keeps the original expiry and uses the earlier opening deadline', () => {
    const opened = {
      ...batch('opened', '0.5', '2026-10-20'),
      openedAt: at,
      openedUseByDate: new Date('2026-10-11T00:00:00.000Z'),
    };
    expect(effectiveExpiryDate(opened)?.toISOString().slice(0, 10)).toBe(
      '2026-10-11',
    );
    expect(opened.expiryDate?.toISOString().slice(0, 10)).toBe('2026-10-20');
    expect(
      effectiveExpiryDate({
        expiryDate: new Date('2026-10-10T00:00:00.000Z'),
        openedUseByDate: opened.openedUseByDate,
      })
        ?.toISOString()
        .slice(0, 10),
    ).toBe('2026-10-10');
    expect(
      planUse(decimal('0.5'), [opened], new Date('2026-10-11T16:59:59.999Z'))
        .ok,
    ).toBe(true);
    expect(
      planUse(decimal('0.5'), [opened], new Date('2026-10-11T17:00:00.000Z'))
        .ok,
    ).toBe(false);
  });

  it('uses eligible opened quantity first, then opens whole containers from unopened FEFO stock', () => {
    const opened = {
      ...batch('opened', '0.4', '2026-10-30'),
      openedAt: at,
      openedUseByDate: new Date('2026-10-12T00:00:00.000Z'),
    };
    const sources = [
      batch('later', '2', '2026-10-20'),
      batch('earlier', '1', '2026-10-10'),
    ];
    const plan = planAutomaticOpen(decimal('1.6'), [opened, ...sources], at);
    expect(plan).toEqual({ ok: true, sourceBatchIds: ['earlier', 'later'] });
    if (!plan.ok) throw new Error('Expected opening plan');
    expect(planUse(decimal('0.4'), [opened], at).ok).toBe(true);
  });

  it('consumes opened containers by effective-expiry FEFO without opening more when sufficient', () => {
    const opened = [
      {
        ...batch('later-opened', '0.5', '2026-10-15'),
        openedAt: at,
        openedUseByDate: new Date('2026-10-14T00:00:00.000Z'),
      },
      {
        ...batch('earlier-opened', '0.5', '2026-10-20'),
        openedAt: at,
        openedUseByDate: new Date('2026-10-10T00:00:00.000Z'),
      },
    ];
    const unopened = batch('unopened', '2', '2026-10-09');
    expect(
      planAutomaticOpen(decimal('0.75'), [...opened, unopened], at),
    ).toEqual({
      ok: true,
      sourceBatchIds: [],
    });
    expect(allocationStrings(planUse(decimal('0.75'), opened, at))).toEqual([
      ['earlier-opened', '0.5'],
      ['later-opened', '0.25'],
    ]);
  });

  it('rejects insufficient eligible stock before any transfer and retains legacy FEFO', () => {
    const opened = { ...batch('opened', '0.25', '2026-10-10'), openedAt: at };
    const unopened = batch('unopened', '1', '2026-10-12');
    expect(planAutomaticOpen(decimal('1.5'), [opened, unopened], at)).toEqual({
      ok: false,
    });
    expect(
      allocationStrings(planUse(decimal('1'), [unopened, opened], at)),
    ).toEqual([
      ['opened', '0.25'],
      ['unopened', '0.75'],
    ]);
  });
});
