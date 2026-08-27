// Thin client for the Lumio Booking backend API.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

// Multi-branch: the salon owner/manager's currently selected branch. Read fresh
// from localStorage on every call so a switch takes effect immediately (and there
// is no load-order race with the AuthProvider). Single-salon users never set it.
export const ACTIVE_BRANCH_KEY = 'lumio_active_branch';
function activeBranchId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(ACTIVE_BRANCH_KEY) || null;
  } catch {
    return null;
  }
}

// Global handler invoked when an authenticated request is rejected with 401
// (i.e. the session/token expired). The AuthProvider registers a handler that
// clears the session and redirects to /login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
}

/**
 * Fetch an image from the API and hand back an object URL.
 *
 * An <img src> cannot carry an Authorization header, and the alternative —
 * putting the token in the query string — writes it into every proxy and
 * access log between here and the server. So the bytes come down through a
 * normal authenticated request and become a blob url the tag can use.
 *
 * Returns null when the server says there is no picture (204), which is a
 * normal answer for a Facebook profile Meta will not share.
 */
const imageCache = new Map<string, string | null>();

export async function apiImage(path: string, token: string): Promise<string | null> {
  // Cached per path for the life of the page: scrolling a list must not refetch
  // the same face, and switching filters must not either.
  if (imageCache.has(path)) return imageCache.get(path) ?? null;
  try {
    const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 204 || !res.ok) { imageCache.set(path, null); return null; }
    const blob = await res.blob();
    if (!blob.size) { imageCache.set(path, null); return null; }
    const url = URL.createObjectURL(blob);
    imageCache.set(path, url);
    return url;
  } catch {
    imageCache.set(path, null);
    return null;
  }
}

/**
 * Open a Server-Sent Events stream with the normal Authorization header.
 *
 * Not EventSource: that cannot set headers, which would force the JWT into the
 * query string — and query strings end up in proxy and access logs. fetch() with
 * a stream reader keeps the token where every other request puts it.
 *
 * Calls `onEvent` with the event name for each frame. Returns a function that
 * closes the stream.
 */
export function apiStream(
  path: string,
  token: string,
  onEvent: (name: string) => void,
  onError?: () => void,
): () => void {
  const ctrl = new AbortController();
  const branch = activeBranchId();
  void (async () => {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
          ...(branch ? { 'X-Branch-Id': branch } : {}),
        },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) { onError?.(); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // Frames are separated by a blank line. Anything not yet terminated
        // stays in the buffer — a frame split across two network packets must
        // not be read as two half frames.
        let i = buf.indexOf('\n\n');
        while (i !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = /^event:\s*(\S+)/m.exec(frame);
          // A frame with no event name is the keep-alive comment; ignore it.
          if (m) onEvent(m[1]);
          i = buf.indexOf('\n\n');
        }
      }
      onError?.();
    } catch {
      // Aborting on unmount lands here too, which is why the caller decides
      // whether a reconnect is wanted rather than this function retrying.
      onError?.();
    }
  })();
  return () => ctrl.abort();
}

export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', token, body } = options;

  const branch = activeBranchId();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branch ? { 'X-Branch-Id': branch } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    // Only treat 401 as a session expiry when we actually sent a token; a 401
    // from the login request itself (wrong password) must NOT trigger a redirect.
    if (res.status === 401 && token) {
      onUnauthorized?.();
    }
    const message =
      (data && typeof data === 'object' && 'message' in data && String((data as any).message)) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}
