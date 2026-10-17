export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly itemId: string | null;

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    itemId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.itemId = itemId;
  }
}

export class OfflineBeforeSendError extends Error {
  constructor() {
    super(
      'You’re offline, so this action was not sent or saved. Reconnect, then choose the action again to retry.',
    );
    this.name = 'OfflineBeforeSendError';
  }
}

export class MutationOutcomeUnknownError extends Error {
  constructor(path: string) {
    const guidance = path.includes('notification-preferences')
      ? 'Reload Settings and check the saved values before choosing to retry.'
      : path.includes('/items/') ||
          path.includes('/trips/') ||
          path.includes('stock-check')
        ? 'Check current stock and activity before choosing to retry.'
        : 'Check the current screen before choosing to retry.';
    super(
      `The connection failed after the request started. The result is uncertain. ${guidance}`,
    );
    this.name = 'MutationOutcomeUnknownError';
  }
}

export function isMutationOutcomeUnknown(error: unknown) {
  return (
    error instanceof MutationOutcomeUnknownError ||
    (!(error instanceof ApiError) &&
      !(error instanceof OfflineBeforeSendError)) ||
    (error instanceof ApiError && (error.status === 408 || error.status >= 500))
  );
}

export async function api<T>(
  path: string,
  method = 'GET',
  body?: object,
): Promise<T> {
  const normalizedMethod = method.toUpperCase();
  if (
    normalizedMethod !== 'GET' &&
    typeof navigator !== 'undefined' &&
    !navigator.onLine
  ) {
    throw new OfflineBeforeSendError();
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: normalizedMethod,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    if (normalizedMethod !== 'GET') throw new MutationOutcomeUnknownError(path);
    throw cause;
  }
  let data: unknown = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch (cause) {
      if (normalizedMethod !== 'GET')
        throw new MutationOutcomeUnknownError(path);
      throw cause;
    }
  }
  if (!response.ok) {
    const body =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : null;
    const raw =
      body && 'message' in body
        ? body.message
        : `The server could not complete this request (${response.status}).`;
    if (
      response.status === 401 &&
      !['/auth/me', '/auth/sign-in', '/auth/register'].includes(path)
    ) {
      window.dispatchEvent(new Event('lumio:session-expired'));
    }
    const returnedCode =
      typeof body?.code === 'string'
        ? body.code
        : typeof raw === 'string' && /^[A-Z][A-Z0-9_]+$/.test(raw)
          ? raw
          : null;
    throw new ApiError(
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.join(', ')
          : 'The server could not complete this request.',
      response.status,
      returnedCode,
      typeof body?.itemId === 'string' ? body.itemId : null,
    );
  }
  return data as T;
}
