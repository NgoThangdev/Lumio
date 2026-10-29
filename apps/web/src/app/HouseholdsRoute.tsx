import { useState } from 'react';
import type { Household, User } from '@/shared/api/types';
import { HouseholdsPage } from '@/features/households/HouseholdsPage';
import { HouseholdDeletionDialog } from '@/features/settings/HouseholdDeletionDialog';

export function HouseholdsRoute({ user }: { user: User }) {
  const [deletingHousehold, setDeletingHousehold] = useState<Household | null>(
    null,
  );

  return (
    <>
      <HouseholdsPage onDeleteHousehold={setDeletingHousehold} />
      {deletingHousehold && (
        <HouseholdDeletionDialog
          household={deletingHousehold}
          user={user}
          onClose={() => setDeletingHousehold(null)}
        />
      )}
    </>
  );
}
