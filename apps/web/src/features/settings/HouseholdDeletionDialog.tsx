import { useEffect, useId, useRef } from 'react';
import type { Household, User } from '@/shared/api/types';
import { Button } from '@/shared/ui/primitives';
import { tr } from '@/shared/i18n';
import { HouseholdDeletionSection } from './HouseholdDeletionSection';

export function HouseholdDeletionDialog({
  household,
  user,
  onClose,
}: {
  household: Household;
  user: User;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  function closeDialog() {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="household-delete-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="household-delete-dialog-close">
        <Button variant="secondary" type="button" onClick={closeDialog}>
          {tr('households:cancel')}
        </Button>
      </div>
      <HouseholdDeletionSection
        household={household}
        user={user}
        titleId={titleId}
        onComplete={onClose}
      />
    </dialog>
  );
}
