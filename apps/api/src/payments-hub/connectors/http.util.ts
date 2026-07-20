// Dependency-free JSON HTTP for BYO REST connectors (Square, SumUp). Uses the
// Node 18+ global fetch; typed loosely so it compiles regardless of TS lib.
const doFetch: any = (globalThis as any).fetch;

export interface HttpResult {
  ok: boolean;
  status: number;
  json: any;
}

export async function httpJson(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<HttpResult> {
  const res = await doFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
}
