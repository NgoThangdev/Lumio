import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  isMutationOutcomeUnknown,
  OfflineBeforeSendError,
} from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import { localizedError, tr } from '@/shared/i18n';

export function useShoppingActionFeedback(householdId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requiredLocationItemId, setRequiredLocationItemId] = useState('');
  const [retryLocationId, setRetryLocationId] = useState('');

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'DESTINATION_NOT_DRAFT') {
        setError(tr('shopping:destinationNoLongerDraft'));
        await queryClient.invalidateQueries({
          queryKey: keys.trips(householdId),
        });
      } else {
        setError(
          cause instanceof OfflineBeforeSendError
            ? localizedError(cause)
            : isMutationOutcomeUnknown(cause)
              ? tr('shopping:tripChangeOutcomeUncertain')
              : cause instanceof Error
                ? localizedError(cause)
                : 'common:changeSaved',
        );
      }
      if (
        cause instanceof ApiError &&
        cause.code === 'LOCATION_REQUIRED' &&
        cause.itemId
      ) {
        setRequiredLocationItemId(cause.itemId);
        setRetryLocationId('');
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    notice,
    setNotice,
    requiredLocationItemId,
    setRequiredLocationItemId,
    retryLocationId,
    setRetryLocationId,
    run,
  };
}
