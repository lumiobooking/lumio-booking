/**
 * "MY CARD MACHINE ISN'T ON THE LIST" — what a salon sends Lumio, cleaned.
 *
 * A salon picks or types its terminal's brand, the model and the serial /
 * device code printed on it. Lumio files the request and answers with the
 * matching self-connect guide straight away (web lib/terminal-guides.ts): a
 * brand Lumio drives (Square, Stripe, Helcim, Dejavoo, SumUp, Adyen) gets the
 * steps to connect it in Payment terminals; one it does not drive yet
 * (Clover, GoDaddy/Poynt, PAX, Verifone, Ingenico…) gets the "ring the sale
 * on your machine, record it as card in Lumio" steps while the team looks.
 *
 * Stored per salon in the setting `terminal_requests` (newest first, 20 max).
 * Pure.
 */
export const TERMINAL_REQUESTS_KEY = 'terminal_requests';
export const TERMINAL_REQUESTS_MAX = 20;

export const TERMINAL_BRANDS = ['square', 'stripe', 'helcim', 'dejavoo', 'sumup', 'adyen', 'clover', 'godaddy', 'pax', 'verifone', 'ingenico', 'other'] as const;
export type TerminalBrand = (typeof TERMINAL_BRANDS)[number];
/** The ones Lumio drives today (payment hub connectors). */
export const DRIVEN_BRANDS: TerminalBrand[] = ['square', 'stripe', 'helcim', 'dejavoo', 'sumup', 'adyen'];

export type RequestStatus = 'open' | 'sent' | 'done';
export interface TerminalRequest {
  id: string;
  brand: string;
  brandKey: TerminalBrand;
  model: string;
  serial: string;
  note: string;
  phone: string;
  status: RequestStatus;
  reply: string;
  createdAt: string;
  updatedAt: string;
  byName: string | null;
}

/** "Clover Flex", "godaddy poynt", "PAX A920" → the brand family. */
export function brandKeyOf(brand: string, model = ''): TerminalBrand {
  const s = `${brand} ${model}`.toLowerCase();
  if (/square/.test(s)) return 'square';
  if (/stripe|bbpos|wisepos/.test(s)) return 'stripe';
  if (/helcim/.test(s)) return 'helcim';
  if (/dejavoo|ipospays|\bz11\b|\bqd\d|\bp1\b|\bp3\b|\bp5\b/.test(s)) return 'dejavoo';
  if (/sumup|solo/.test(s)) return 'sumup';
  if (/adyen/.test(s)) return 'adyen';
  if (/clover/.test(s)) return 'clover';
  if (/godaddy|go daddy|poynt/.test(s)) return 'godaddy';
  if (/\bpax\b|a920|a80|s300/.test(s)) return 'pax';
  if (/verifone|vx\d|v400|engage/.test(s)) return 'verifone';
  if (/ingenico|desk\/|move\/|lane\//.test(s)) return 'ingenico';
  return 'other';
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

export function cleanRequest(input: { brand?: unknown; model?: unknown; serial?: unknown; note?: unknown; phone?: unknown }): Pick<TerminalRequest, 'brand' | 'brandKey' | 'model' | 'serial' | 'note' | 'phone'> | null {
  const brand = clip(input.brand, 60);
  const model = clip(input.model, 80);
  if (!brand && !model) return null;
  return {
    brand: brand || model,
    brandKey: brandKeyOf(brand, model),
    model,
    serial: clip(input.serial, 80),
    note: clip(input.note, 500),
    phone: clip(input.phone, 40),
  };
}

/** A stored list made safe (missing or odd rows dropped). */
export function readRequests(raw: unknown): TerminalRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is TerminalRequest => !!r && typeof r === 'object' && typeof (r as TerminalRequest).id === 'string').slice(0, TERMINAL_REQUESTS_MAX);
}
