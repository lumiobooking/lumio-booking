/**
 * Settings → Payments → "card brand at the counter" keeps ONLY which brands are
 * on. It once also took an API key and a secret per brand: they connected
 * nothing (online payments run only through the payment hub, encrypted), sat
 * in plain settings, and a browser's password manager filled the owner's login
 * email and password into them. Pure.
 */
import { GATEWAY_IDS, type GatewayConfig, type PaymentGateways } from './settings.constants';

export function brandsOnly(raw: Partial<Record<string, Partial<GatewayConfig>>> | null | undefined): PaymentGateways {
  const out = {} as PaymentGateways;
  for (const id of GATEWAY_IDS) out[id] = { enabled: raw?.[id]?.enabled === true, apiKey: '', secret: '' };
  return out;
}

export function holdsKeys(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return Object.values(raw as Record<string, Partial<GatewayConfig> | null>).some((g) => !!g && (!!g.apiKey || !!g.secret));
}
