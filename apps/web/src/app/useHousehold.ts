import { useOutletContext } from 'react-router';
import type { Household } from '../shared/api/types';

export function useHousehold() {
  return useOutletContext<{ household: Household }>().household;
}
