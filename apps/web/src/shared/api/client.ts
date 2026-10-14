export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly itemId: string | null;

  constructor(message: string, status: number, code: string | null = null, itemId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.itemId = itemId;
  }
}

export function isMutationOutcomeUnknown(error: unknown) {
  return !(error instanceof ApiError) || error.status === 408 || error.status >= 500;
}

export async function api<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = typeof data === "object" && data !== null ? data as Record<string, unknown> : null;
    const raw =
      body && "message" in body
        ? body.message
        : `The server could not complete this request (${response.status}).`;
    if (
      response.status === 401 &&
      !["/auth/me", "/auth/sign-in", "/auth/register"].includes(path)
    ) {
      window.dispatchEvent(new Event("lumio:session-expired"));
    }
    const returnedCode = typeof body?.code === "string"
      ? body.code
      : typeof raw === "string" && /^[A-Z][A-Z0-9_]+$/.test(raw)
        ? raw
        : null;
    throw new ApiError(
      typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(", ") : "The server could not complete this request.",
      response.status,
      returnedCode,
      typeof body?.itemId === "string" ? body.itemId : null,
    );
  }
  return data as T;
}
