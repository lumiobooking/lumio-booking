// Lumio Payment Companion client. Authenticates as an AGENT (pairing token),
// NOT a staff user. Holds the agent token in memory (use secure storage in prod).
const API_URL = (process.env.EXPO_PUBLIC_LUMIO_API as string) ?? 'https://lumio-api.onrender.com/api';

let agentToken: string | null = null;

async function req<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.auth !== false && agentToken ? { Authorization: `Bearer ${agentToken}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
  return data as T;
}

export interface AgentCommand {
  intentId: string;
  action: string;
  provider: string;
  amountCents: number;
  currency: string;
  externalReaderId?: string;
  clientSecret?: string;
}

export const api = {
  async pair(pairingCode: string, platform = 'ios') {
    const r = await req<{ agentToken: string; agentId: string; tenantId: string; kind: string }>('/payments-hub/agent/pair', { method: 'POST', body: { pairingCode, platform }, auth: false });
    agentToken = r.agentToken;
    return r;
  },
  isPaired: () => !!agentToken,
  connectionToken: () => req<{ secret: string | null }>('/payments-hub/agent/connection-token', { method: 'POST' }),
  poll: () => req<{ command: AgentCommand | null }>('/payments-hub/agent/poll', { method: 'POST' }),
  result: (intentId: string, status: 'SUCCEEDED' | 'FAILED' | 'CANCELED', providerReference?: string, error?: string) =>
    req('/payments-hub/agent/result', { method: 'POST', body: { intentId, status, providerReference, error } }),
  registerReader: (provider: string, externalReaderId: string, label?: string) =>
    req('/payments-hub/agent/readers', { method: 'POST', body: { provider, externalReaderId, label } }),
};
