import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import type { User } from '@/shared/api/types';
import { Button, Notice } from '@/shared/ui/primitives';
import { localizedError, tr } from '@/shared/i18n';
import { AppRoutes } from './AppRoutes';
import { setSession } from './sessionCache';

export function SessionBoundary() {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      try {
        return await api<User>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    const expire = () => {
      setSession(queryClient, null);
    };
    window.addEventListener('lumio:session-expired', expire);
    return () => window.removeEventListener('lumio:session-expired', expire);
  }, [queryClient]);

  if (session.isPending)
    return <main className="loading">{tr('common:checkingSession')}</main>;
  if (session.isError)
    return (
      <main className="loading">
        <Notice kind="error">{localizedError(session.error)}</Notice>
        <Button onClick={() => void session.refetch()}>
          {tr('common:retrySessionCheck')}
        </Button>
      </main>
    );

  return (
    <AppRoutes
      user={session.data}
      onSessionChange={(user) => setSession(queryClient, user)}
    />
  );
}
