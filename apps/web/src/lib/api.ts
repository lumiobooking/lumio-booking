// Thin client for the Lumio Booking backend API.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

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

export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', token, body } = options;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
