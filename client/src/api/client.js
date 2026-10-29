const BASE = import.meta.env.VITE_API_BASE ?? '';

// Absolute URL for things the browser loads directly (avatar images). When the
// client and API share an origin, BASE is empty and this stays a relative path.
export function apiUrl(path) {
  return `${BASE}${path}`;
}

// Avatar URLs are cache-busted by the upload timestamp: the image is served
// with a long private cache, so without this a new upload would show the old
// picture until a hard refresh.
export function avatarUrl(user) {
  if (!user?.hasAvatar) return null;
  const version = user.avatarUpdatedAt ? new Date(user.avatarUpdatedAt).getTime() : 0;
  return `${apiUrl(`/api/users/${user.id}/avatar`)}?v=${version}`;
}

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

// Multipart upload. Same base URL, credentials and error shape as api(), but
// the browser must set Content-Type itself so the multipart boundary is
// included. Hand-rolling this call with fetch('/api/...') is a trap: it ignores
// VITE_API_BASE and posts to whatever origin serves the SPA, which answers 405
// when the site host is static files only.
export async function apiUpload(path, formData) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'unknown',
      data?.error?.message ?? 'Upload failed. Please try again.',
    );
  }
  return data;
}
