import { useMutation } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/api/client';
import type { UndoCandidate, UndoResult } from '@/shared/api/types';

export function useItemUndoAction({
  householdId,
  itemId,
  onRefresh,
  onUndoStarted,
  onUndoComplete,
  onConflict,
}: {
  householdId: string;
  itemId: string;
  onRefresh: () => Promise<void>;
  onUndoStarted: () => void;
  onUndoComplete: (result: UndoResult) => void;
  onConflict: () => void;
}) {
  const mutation = useMutation({
    mutationFn: (candidate: UndoCandidate) =>
      api<UndoResult>(
        `/households/${householdId}/items/${itemId}/undo`,
        'POST',
        candidate,
      ),
    onSuccess: async (result) => {
      onUndoStarted();
      await onRefresh();
      onUndoComplete(result);
    },
    onError: async (error) => {
      await onRefresh();
      if (error instanceof ApiError && error.status === 409) onConflict();
    },
  });

  return {
    isError: mutation.isError,
    error: mutation.error,
    isPending: mutation.isPending,
    undo: (candidate: UndoCandidate) => mutation.mutate(candidate),
  };
}
