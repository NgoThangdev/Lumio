export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  method = 'GET',
  body?: object,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? (data as { message: string | string[] }).message
        : `The server could not complete this request (${response.status}).`;
    throw new ApiError(
      Array.isArray(message) ? message.join(', ') : message,
      response.status,
    );
  }
  return data as T;
}
