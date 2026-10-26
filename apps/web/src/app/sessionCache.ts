import type { QueryClient } from '@tanstack/react-query';
import { keys } from '@/shared/api/keys';
import type { User } from '@/shared/api/types';

export function setSession(queryClient: QueryClient, user: User | null) {
  queryClient.removeQueries({
    predicate: ({ queryKey }) => queryKey[0] !== keys.session[0],
  });
  queryClient.getMutationCache().clear();
  queryClient.setQueryData(keys.session, user);
}
