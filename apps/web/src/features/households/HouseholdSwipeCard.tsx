import { useNavigate } from 'react-router';
import type { Household } from '@/shared/api/types';
import { Doodle } from '@/shared/ui/Doodle';
import { SwipeReveal } from '@/shared/ui/SwipeReveal';
import { tr } from '@/shared/i18n';

export function HouseholdSwipeCard({
  household,
  onDelete,
}: {
  household: Household;
  onDelete: (household: Household) => void;
}) {
  const navigate = useNavigate();
  const isAdmin = household.role === 'ADMIN';
  const row = (
    <button
      className="row household-row-select"
      type="button"
      onClick={() => navigate(`/households/${household.id}/home`)}
    >
      <Doodle kind="household" className="household-row-doodle" />
      <span className="item-identity">
        <strong>{household.name}</strong>
        <small>{isAdmin ? tr('common:admin') : tr('common:member')}</small>
      </span>
      <span aria-hidden="true">→</span>
    </button>
  );

  if (!isAdmin) return row;

  return (
    <SwipeReveal
      className="household-swipe-item"
      action="delete"
      actionLabel={tr('settings:householdDeletion')}
      itemName={household.name}
      showActionsLabel={tr('inventory:showRowActions', {
        name: household.name,
      })}
      hideActionsLabel={tr('inventory:hideRowActions', {
        name: household.name,
      })}
      targetSelector=".household-row-select"
      onAction={() => onDelete(household)}
    >
      {row}
    </SwipeReveal>
  );
}
