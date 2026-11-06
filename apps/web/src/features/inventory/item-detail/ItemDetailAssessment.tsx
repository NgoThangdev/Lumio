import type { Assessment, Item } from '@/shared/api/types';
import {
  Card,
  ExplanationText,
  hasExplanationTranslation,
} from '@/shared/ui/primitives';
import { formatDateOnly, formatNumber, tr } from '@/shared/i18n';

export function ItemDetailAssessment({
  item,
  assessment,
  shoppingDate,
  isPending,
  showReasonExplanations,
}: {
  item: Item;
  assessment?: Assessment;
  shoppingDate?: string;
  isPending: boolean;
  showReasonExplanations: boolean;
}) {
  return (
    <>
      {!item.archivedAt && isPending && (
        <Card className="assessment-loading">
          <p className="muted">{tr('common:loadingStockAssessment')}</p>
        </Card>
      )}
      {!item.archivedAt && assessment && (
        <Card className="assessment-card">
          <p className="eyebrow">{tr('common:stockHealth')}</p>
          <h2>{tr('item-detail:howThingsLooking')}</h2>
          {showReasonExplanations &&
            (assessment.reasonExplanations?.length
              ? assessment.reasonExplanations.map((explanation, index) => (
                  <ExplanationText
                    key={`${explanation.code}-${index}`}
                    explanation={explanation}
                    fallback={assessment.reasons[index]}
                  />
                ))
              : assessment.reasons.map((reason, index) => (
                  <ExplanationText
                    key={`${reason}-${index}`}
                    explanation={undefined}
                    fallback={reason}
                  />
                )))}
          <ExplanationText
            className="use-soon-note"
            explanation={assessment.expiryExplanation}
            fallback={assessment.expiryReason}
          />
          {item.trackingMode === 'QUANTITY' && (
            <>
              <ExplanationText
                explanation={assessment.prediction.explanation}
                fallback={assessment.prediction.reason}
              />
              {assessment.prediction.basis === 'USE_14_DAY' &&
                assessment.prediction.dailyRate !== null &&
                assessment.prediction.projectedNeed !== null &&
                shoppingDate && (
                  <p className="muted">
                    {tr('inventory:predictionDetails', {
                      dailyRate: formatNumber(assessment.prediction.dailyRate),
                      unit: item.primaryUnit,
                      shoppingDate: formatDateOnly(shoppingDate),
                      projectedNeed: formatNumber(
                        assessment.prediction.projectedNeed,
                      ),
                    })}
                  </p>
                )}
            </>
          )}
          {assessment.suggestion && (
            <ExplanationText
              explanation={assessment.suggestion.explanation}
              fallback={assessment.suggestion.reason}
            />
          )}
          {item.trackingMode !== 'QUANTITY' &&
            assessment.recommendedAction &&
            assessment.recommendedAction !== 'NONE' && (
              <p className="muted">
                {tr('common:recommended')}{' '}
                {assessment.recommendedAction === 'OPEN_REFILL'
                  ? tr('common:openBackup')
                  : tr('common:buyBackup')}
              </p>
            )}
        </Card>
      )}
    </>
  );
}

export function shouldShowReasonExplanations(assessment?: Assessment): boolean {
  return (
    !assessment?.suggestion ||
    hasExplanationTranslation(assessment.suggestion.explanation)
  );
}
