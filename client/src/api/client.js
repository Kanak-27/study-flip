const BASE = import.meta.env.VITE_API_BASE ?? '';

// Thin wrapper around fetch: includes the session cookie, sends/receives JSON,
// and throws ApiError with the server's { code, message } on failure.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'unknown', data?.error?.message ?? 'Something went wrong.');
  }
  return data;
}
