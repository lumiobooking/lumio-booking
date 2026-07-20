'use strict';
// Lumio agent API client. Authenticates with the AGENT token (not a user login).
// Only amounts + intent ids cross this channel — never card data or provider keys.

async function call(cfg, path, body, useAuth = true) {
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(useAuth && cfg.agentToken ? { Authorization: `Bearer ${cfg.agentToken}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(Array.isArray(msg) ? msg.join(', ') : msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

module.exports = {
  pair: (cfg, pairingCode) =>
    call(cfg, '/payments-hub/agent/pair', { pairingCode, platform: 'windows', label: 'Lumio Bridge' }, false),
  poll: (cfg) => call(cfg, '/payments-hub/agent/poll', {}),
  result: (cfg, intentId, status, providerReference, error) =>
    call(cfg, '/payments-hub/agent/result', { intentId, status, providerReference, error }),
  registerReader: (cfg, provider, externalReaderId, label) =>
    call(cfg, '/payments-hub/agent/readers', { provider, externalReaderId, label }),
};
