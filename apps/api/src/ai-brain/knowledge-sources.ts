/**
 * "HỌC TỪ LINK" — the salon gives the AI a link (a price list, a menu, a
 * policy page, a JSON feed) instead of typing it in or asking Lumio to change
 * code. The page is read now and again every day; what was read is kept, so a
 * link that fails tomorrow still leaves yesterday's text in use. When the link
 * and older typed facts disagree, the link wins (the prompt says so).
 *
 * Per salon (setting row `ai_brain_sources` on the salon's own tenant) — a
 * salon only ever reads its own links. Pure helpers here; fetching lives in
 * AiBrainService.
 */
import { isForbiddenHost } from '../common/site-reader';
import { readableText } from '../common/site-extract';

export interface KnowledgeSource {
  id: string;
  url: string;
  label: string;
  on: boolean;
  /** What was read, as plain lines the AI can use. Kept when a later read fails. */
  text: string;
  chars: number;
  fetchedAt: string | null;
  error: string | null;
  errorAt: string | null;
}

export const SOURCES_KEY = 'ai_brain_sources';
export const MAX_SOURCES = 5;
export const MAX_CHARS = 15_000;
export const MAX_TOTAL = 30_000;
/** Read again after this long. */
export const STALE_MS = 24 * 60 * 60_000;

/** A link we may read from our server: http(s), a real public host. Null when not. */
export function cleanSourceUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(s) || s.length > 1000) return null;
  try {
    const u = new URL(s);
    if (isForbiddenHost(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function sourcesFrom(v: unknown): KnowledgeSource[] {
  const arr = Array.isArray(v) ? v : Array.isArray((v as { items?: unknown })?.items) ? (v as { items: unknown[] }).items : [];
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { url?: unknown }).url === 'string')
    .map((x) => ({
      id: String(x.id ?? ''), url: String(x.url), label: String(x.label ?? '').slice(0, 80), on: x.on !== false,
      text: String(x.text ?? '').slice(0, MAX_CHARS), chars: Number(x.chars ?? String(x.text ?? '').length) || 0,
      fetchedAt: (x.fetchedAt as string) ?? null, error: (x.error as string) ?? null, errorAt: (x.errorAt as string) ?? null,
    }))
    .slice(0, MAX_SOURCES);
}

/** JSON → "plans > Boost > price per month: 179" lines: every value with the path that names it. */
export function flattenJson(v: unknown, path: string[] = [], out: string[] = [], depth = 0): string[] {
  if (out.length > 2000 || depth > 12) return out;
  const key = path.map((p) => p.replace(/_/g, ' ')).join(' > ');
  if (v === null || v === undefined || v === '') return out;
  if (typeof v !== 'object') { out.push(key ? `${key}: ${String(v)}` : String(v)); return out; }
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) { if (v.length) out.push(`${key}: ${v.join(', ')}`); return out; }
    v.forEach((x, i) => {
      const name = x && typeof x === 'object' && !Array.isArray(x) ? String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).title ?? (x as Record<string, unknown>).label ?? i + 1) : String(i + 1);
      flattenJson(x, [...path, name], out, depth + 1);
    });
    return out;
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if ((k === 'name' || k === 'title') && path.length) continue; // already in the path
    flattenJson(x, [...path, k], out, depth + 1);
  }
  return out;
}

/** What the AI gets from one response: JSON as named lines, HTML as readable text, anything else as text. */
export function docText(body: string, contentType: string | null | undefined): string {
  const ct = String(contentType ?? '').toLowerCase();
  const raw = String(body ?? '');
  const looksJson = ct.includes('json') || /^\s*[[{]/.test(raw);
  if (looksJson) {
    try { return flattenJson(JSON.parse(raw)).join('\n').slice(0, MAX_CHARS); } catch { /* not JSON after all */ }
  }
  if (ct.includes('html') || /<html|<body|<div/i.test(raw.slice(0, 2000))) return readableText(raw, MAX_CHARS);
  return raw.replace(/\s+\n/g, '\n').trim().slice(0, MAX_CHARS);
}

/** The prompt section: every link that is on and has text, newest facts winning over older typed ones. */
export function docsBlock(sources: KnowledgeSource[]): string {
  const live = sources.filter((s) => s.on && s.text.trim());
  if (!live.length) return '';
  let left = MAX_TOTAL;
  const parts: string[] = [];
  for (const s of live) {
    if (left <= 200) break;
    const head = `--- ${s.label || s.url} (read from ${s.url}${s.fetchedAt ? ` on ${s.fetchedAt.slice(0, 10)}` : ''}) ---`;
    const body = s.text.slice(0, Math.max(0, left - head.length - 2));
    parts.push(`${head}\n${body}`);
    left -= head.length + body.length + 2;
  }
  return [
    "THE BUSINESS'S OWN DOCUMENTS — read from links the owner gave and refreshed daily. They are the CURRENT truth for prices, packages, plans, menus, offers and policies:",
    '- When anything else you were given (older notes, typed facts, a tool result, your own memory) disagrees with these documents, these documents win.',
    '- Quote numbers exactly as written here. Never invent a price, package, discount or gift that is not here.',
    '- If a document marks an offer as limited to dates that have passed, say the offer may have ended and that the team can confirm.',
    ...parts,
  ].join('\n');
}
