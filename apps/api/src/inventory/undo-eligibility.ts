export const UNDO_WINDOW_MS = 2 * 60 * 1000;

export function undoEligibility(createdAt: Date, eligible: boolean) {
  return eligible
    ? {
        eligible: true as const,
        expiresAt: new Date(createdAt.getTime() + UNDO_WINDOW_MS),
      }
    : {
        eligible: false as const,
        expiresAt: null,
        reason: 'UNDO_UNSUPPORTED' as const,
      };
}
