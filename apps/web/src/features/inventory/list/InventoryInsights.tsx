import { Link } from 'react-router';
import type { Intelligence } from '@/shared/api/types';
import { Card, ExplanationText, Notice } from '@/shared/ui/primitives';
import { formatDateOnly, formatNumber, tr } from '@/shared/i18n';
import { localizedError } from '@/shared/i18n';

export function InventoryInsights({
  base,
  data,
  isPending,
  error,
  shoppingDate,
  onShoppingDateChange,
}: {
  base: string;
  data?: Intelligence;
  isPending: boolean;
  error: Error | null;
  shoppingDate: string;
  onShoppingDateChange: (value: string) => void;
}) {
  return (
    <div className="insight-strip">
      {data && data.useSoon.length > 0 && (
        <Card className="use-soon">
          <p className="eyebrow">{tr('common:useSoon2')}</p>
          <h2>
            {data.useSoon.length}{' '}
            {tr(data.useSoon.length === 1 ? 'common:item' : 'common:items')}{' '}
            {tr('common:check2')}
          </h2>
          {data.useSoon.slice(0, 4).map((entry) => (
            <Link
              className="insight-row"
              key={entry.itemId}
              to={`${base}/inventory/${entry.itemId}`}
            >
              <strong>{entry.name}</strong>
              <ExplanationText
                as="span"
                explanation={entry.expiryExplanation}
                fallback={entry.expiryReason}
              />
            </Link>
          ))}
        </Card>
      )}
      <Card className="suggestions">
        <div className="suggestion-heading">
          <div>
            <p className="eyebrow">{tr('common:shoppingSuggestions')}</p>
            <h2>
              {data
                ? `${data.suggestions.length} ${tr(data.suggestions.length === 1 ? 'common:item' : 'common:items')} suggested`
                : '—'}
            </h2>
          </div>
          <label>
            {tr('common:shoppingDate')}
            <input
              type="date"
              value={shoppingDate || data?.shoppingDate || ''}
              onChange={(event) => onShoppingDateChange(event.target.value)}
            />
          </label>
        </div>
        {data && (
          <p className="muted">
            {tr('inventory:assessmentDate')} {formatDateOnly(data.shoppingDate)}{' '}
            {tr('inventory:lumioSStock')}
          </p>
        )}
        {isPending ? (
          <p className="muted">{tr('common:loadingStockAssessment')}</p>
        ) : error ? (
          <Notice kind="error">{localizedError(error)}</Notice>
        ) : data?.suggestions.length === 0 ? (
          <p className="muted">{tr('common:nothingBuyBased')}</p>
        ) : (
          data?.suggestions.map((entry) => (
            <div className="suggestion-row" key={entry.itemId}>
              <div>
                <strong>
                  {entry.name}{' '}
                  <span className="priority">
                    {entry.suggestion?.priority === 'MUST_BUY'
                      ? tr('common:buy3')
                      : tr('common:buy4')}
                  </span>
                </strong>
                {entry.suggestion && (
                  <ExplanationText
                    className="suggestion-explanation"
                    explanation={entry.suggestion.explanation}
                    fallback={entry.suggestion.reason}
                  />
                )}
              </div>
              <span>
                {formatNumber(entry.suggestion?.quantity ?? 0)}{' '}
                {entry.primaryUnit}
              </span>
            </div>
          ))
        )}
        <p className="muted">{tr('inventory:suggestionsStartingQuantity')}</p>
      </Card>
    </div>
  );
}
