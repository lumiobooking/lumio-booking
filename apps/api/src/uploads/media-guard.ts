/**
 * Is this photo / clip really THIS salon's? (8 Nov 2026)
 *
 * The agency team uploads media for many salons. After wrong phone numbers
 * and addresses on posts (caught by content/post-kit), the next mistake was
 * the wrong PICTURES: salon A's photos uploaded into salon B's post.
 *
 * Two signals, both pure here so they are tested without a server:
 *  1. Fingerprint — the same file (SHA-256) or the same picture after a
 *     resize / re-encode (64-bit perceptual hash from the browser, Hamming
 *     distance ≤ PHASH_NEAR) already uploaded for ANOTHER salon.
 *  2. What the picture shows — the AI reads visible text (signboard, phone,
 *     website, booking link); a phone that is not this salon's, or another
 *     salon's name or link, is a finding.
 *
 * Isolation: the comparison runs on the server across salons, but a salon
 * only ever learns "used for another salon". The other salon's NAME is shown
 * to Lumio staff (support sessions / super admin) only — see `forViewer`.
 */

export const PHASH_NEAR = 6;

/** 16 hex chars = 64 bits, or null. */
export function cleanPhash(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(s) && !/^0{16}$|^f{16}$/.test(s) ? s : null;
}

/** Bits that differ between two 64-bit hex hashes. */
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < 16; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) { d += x & 1; x >>>= 1; }
  }
  return d;
}

export interface FpRow { tenantId: string; sha256: string; phash: string | null; createdAt: Date }

export interface FpMatch { tenantId: string; how: 'same-file' | 'same-picture'; at: Date }

/** Other salons that already have this file or picture (one row per salon, newest first). */
export function matchFingerprints(tenantId: string, fp: { sha256: string; phash: string | null }, rows: FpRow[]): FpMatch[] {
  const best = new Map<string, FpMatch>();
  for (const r of rows) {
    if (!r || r.tenantId === tenantId) continue;
    let how: FpMatch['how'] | null = null;
    if (r.sha256 && r.sha256 === fp.sha256) how = 'same-file';
    else if (fp.phash && r.phash && hamming(fp.phash, r.phash) <= PHASH_NEAR) how = 'same-picture';
    if (!how) continue;
    const prev = best.get(r.tenantId);
    if (!prev || (how === 'same-file' && prev.how !== 'same-file') || (prev.how === how && r.createdAt > prev.at)) {
      best.set(r.tenantId, { tenantId: r.tenantId, how, at: r.createdAt });
    }
  }
  return [...best.values()].sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ---- what the picture shows ---------------------------------------------------

export interface SeenText { names: string[]; phones: string[]; links: string[] }

export interface SalonFacts { id: string; name: string; slug?: string | null; phone?: string | null; website?: string | null }

export type SeenKind = 'phone' | 'name' | 'link';
export interface SeenFinding { kind: SeenKind; found: string; tenantId?: string | null }

/** Digits only, last 10 — how two written phone numbers are compared. */
export function phoneKey(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '').slice(-10);
}

function fold(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

const GENERIC = new Set([
  'nail', 'nails', 'spa', 'salon', 'salons', 'and', 'the', 'at', 'of', 'by', 'beauty', 'studio', 'bar', 'lounge', 'care',
  'hair', 'lash', 'lashes', 'brow', 'brows', 'massage', 'wellness', 'day', 'pedicure', 'manicure', 'co', 'llc', 'inc',
  'shop', 'store', 'restaurant', 'cafe', 'coffee', 'tiem', 'cua', 'hang', 'quan', 'va', 'tattoo', 'tattoos', 'skin',
]);

/** Distinctive words of a business name. */
export function nameWords(name: string): string[] {
  return [...new Set(fold(name).split(/[^a-z0-9]+/).filter((w) => w && !GENERIC.has(w) && (w.length > 1 || /\d/.test(w))))];
}

/** Every distinctive word of `name` appears in `text`'s words. */
function namedIn(name: string, words: Set<string>): boolean {
  const n = nameWords(name);
  return n.length > 0 && n.every((w) => words.has(w));
}

function host(u: string): string {
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).host.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Findings for what the AI read off the picture.
 * A phone that is not this salon's; another salon's name (all its distinctive
 * words) when this salon's own name is not also there; another salon's
 * website or Lumio booking link.
 */
export function seenFindings(seen: SeenText, own: SalonFacts, others: SalonFacts[]): SeenFinding[] {
  const out: SeenFinding[] = [];
  const add = (f: SeenFinding) => { if (!out.some((o) => o.kind === f.kind && o.found === f.found)) out.push(f); };
  const mine = phoneKey(own.phone);
  for (const raw of (seen.phones || []).slice(0, 10)) {
    const k = phoneKey(raw);
    if (k.length < 10 || k === mine) continue;
    const who = others.find((o) => phoneKey(o.phone) === k);
    add({ kind: 'phone', found: String(raw).trim().slice(0, 40), tenantId: who?.id ?? null });
  }
  const textWords = new Set((seen.names || []).slice(0, 20).flatMap((n) => fold(n).split(/[^a-z0-9]+/).filter(Boolean)));
  if (!namedIn(own.name, textWords)) {
    for (const o of others) {
      if (namedIn(o.name, textWords)) {
        add({ kind: 'name', found: (seen.names || []).find((n) => nameWords(o.name).some((w) => fold(n).includes(w)))?.slice(0, 80) || o.name, tenantId: o.id });
      }
    }
  }
  const ownHost = host(own.website || '');
  for (const raw of (seen.links || []).slice(0, 10)) {
    const h = host(raw);
    if (!h || h === ownHost) continue;
    const path = fold(raw);
    const who = others.find((o) => (o.website && host(o.website) === h) || (o.slug && /lumiobooking\.com/.test(h + path) && new RegExp(`lumiobooking\\.com/(book/)?${o.slug}\\b`).test(path)));
    if (who) add({ kind: 'link', found: String(raw).trim().slice(0, 80), tenantId: who.id });
  }
  return out;
}

/** Parse the model's JSON answer; anything odd reads as "nothing seen". */
export function parseSeen(text: string): SeenText {
  const empty: SeenText = { names: [], phones: [], links: [] };
  const m = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!m) return empty;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 20) : []);
    return { names: arr(j.names), phones: arr(j.phones), links: arr(j.links) };
  } catch { return empty; }
}

// ---- the answer the screen gets ------------------------------------------------

export interface GuardWarning {
  kind: 'same-file' | 'same-picture' | SeenKind;
  /** The other salon's name — Lumio staff only. */
  salon?: string;
  found?: string;
  at?: string;
}

export interface MediaGuard {
  sha256: string;
  warnings: GuardWarning[];
  /** What was actually checked, so silence is never read as "checked and fine". */
  checked: { fingerprint: boolean; picture: boolean };
}

/** The guard as this viewer may see it: other salons' names only for Lumio staff. */
export function forViewer(g: MediaGuard, staff: boolean): MediaGuard {
  if (staff) return g;
  return { ...g, warnings: g.warnings.map(({ salon: _s, ...w }) => w) };
}
