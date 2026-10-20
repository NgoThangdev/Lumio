import { Injectable } from '@nestjs/common';
import { StockIntelligenceService } from './stock-intelligence.service.js';
import type { AssessmentExplanation } from './assessment-explanation.js';

type Assessment = Awaited<
  ReturnType<StockIntelligenceService['assessHousehold']>
>['assessments'][number];

export function rankNeedsAttention(assessments: Assessment[]) {
  const candidates = assessments.flatMap((assessment) => {
    const out = assessment.lowStockRisk === 'OUT';
    const buy = out || assessment.lowStockRisk === 'BUY';
    const expiring = assessment.expiryRisk === 'USE_SOON';
    const openRefill =
      'recommendedAction' in assessment &&
      assessment.recommendedAction === 'OPEN_REFILL';
    const mustBuy =
      buy &&
      (assessment.suggestion?.priority === 'MUST_BUY' ||
        ('purchasePriority' in assessment &&
          assessment.purchasePriority === 'MUST_BUY'));
    const low = assessment.lowStockRisk === 'LOW';
    if (!buy && !expiring && !openRefill && !low) return [];

    const action =
      out || mustBuy
        ? 'BUY'
        : expiring
          ? 'USE_SOON'
          : buy
            ? 'BUY'
            : openRefill
              ? 'OPEN_REFILL'
              : 'VIEW_ITEM';
    const rank =
      out || mustBuy ? 0 : expiring ? 1 : buy ? 2 : openRefill ? 3 : 4;
    const priority = rank === 0 ? 'CRITICAL' : rank <= 2 ? 'HIGH' : 'MEDIUM';
    const reasons = [assessment.expiryReason, ...assessment.reasons].filter(
      (reason): reason is string => Boolean(reason),
    );
    const reason =
      action === 'USE_SOON'
        ? assessment.expiryReason!
        : action === 'OPEN_REFILL'
          ? assessment.reasons.at(-1)!
          : assessment.reasons.join(' ');
    const explanations: AssessmentExplanation[] = [
      ...(assessment.expiryExplanation ? [assessment.expiryExplanation] : []),
      ...assessment.reasonExplanations,
    ];
    const primaryExplanation: AssessmentExplanation =
      action === 'USE_SOON'
        ? assessment.expiryExplanation!
        : assessment.trackingMode === 'QUANTITY'
          ? assessment.reasonExplanations[0]
          : assessment.reasonExplanations.at(-1)!;
    const primaryIndex = explanations.indexOf(primaryExplanation);
    return [
      {
        itemId: assessment.itemId,
        name: assessment.name,
        trackingMode: assessment.trackingMode,
        lowStockRisk: assessment.lowStockRisk,
        expiryRisk: assessment.expiryRisk,
        priority,
        action,
        reason,
        reasons,
        primaryExplanation,
        supportingExplanations: explanations.filter(
          (_, index) => index !== primaryIndex,
        ),
        rank,
      },
    ];
  });
  candidates.sort(
    (left, right) =>
      left.rank - right.rank ||
      left.name.localeCompare(right.name) ||
      left.itemId.localeCompare(right.itemId),
  );
  return candidates.slice(0, 4).map(({ rank: _rank, ...item }) => item);
}

@Injectable()
export class NeedsAttentionService {
  constructor(private readonly intelligence: StockIntelligenceService) {}

  async list(actorId: string, householdId: string) {
    const result = await this.intelligence.assessHousehold(
      actorId,
      householdId,
    );
    return { items: rankNeedsAttention(result.assessments) };
  }
}
