import type { ReactNode } from 'react';
import { tr } from '@/shared/i18n';

export function ItemDetailManagementSection({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section
      className="stack detail-management"
      aria-label={tr('item-detail:itemManagement')}
    >
      {children}
    </section>
  );
}
