import { createContext, useContext, type ReactNode } from 'react';
import type { Household } from '@/shared/api/types';

const HouseholdContext = createContext<Household | null>(null);

export function HouseholdProvider({
  household,
  children,
}: {
  household: Household;
  children: ReactNode;
}) {
  return (
    <HouseholdContext.Provider value={household}>
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const household = useContext(HouseholdContext);
  if (!household)
    throw new Error('useHousehold must be used within HouseholdProvider');
  return household;
}
