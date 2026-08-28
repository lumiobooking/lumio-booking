/**
 * The decisions behind "did my tap actually do anything?" — kept pure.
 *
 * Two complaints drove this file, both from watching a real owner use the app:
 * pages load slowly, and pressing a button gives no sign anything happened.
 * The fixes are centralised in the API client so all ~100 screens get them at
 * once — but WHAT to toast and WHAT to cache are judgement calls, and
 * judgement calls go in a pure module where a test can pin each one.
 */

// ---- toasts ----------------------------------------------------------------

/**
 * Writes that must stay SILENT on success.
 *
 * A toast is a receipt for something a person did on purpose. These paths fire
 * on their own — opening a conversation marks it read, the shell re-registers
 * push, telemetry pings — and a receipt for a thing nobody did is noise.
 * Within a day the sound of "Đã lưu" would mean nothing, which un-fixes the
 * exact problem toasts exist to fix.
 */
const SILENT_WRITES: RegExp[] = [
  /\/read$/,            // opening a conversation
  /\/push\//,           // background push (re)subscription
  /\/heartbeat|\/hello|\/telemetry|\/track/,
  /\/auth\/login|\/auth\/refresh/, // login has its own full-page outcome
];

export type WriteKind = 'silent' | 'announce';

/** Should a successful write show the little "✓ Đã lưu"? */
export function writeKind(method: string, path: string): WriteKind {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET') return 'silent';
  const p = String(path || '').split('?')[0];
  return SILENT_WRITES.some((rx) => rx.test(p)) ? 'silent' : 'announce';
}

/** The receipt's wording. Sends get their own verb — "saved" would be a lie
 *  about a message that just left for a customer. */
export function successText(path: string, vi: boolean): string {
  const p = String(path || '');
  if (/\/send$|\/messages$/.test(p.split('?')[0])) return vi ? 'Đã gửi' : 'Sent';
  if (/delete/.test(p)) return vi ? 'Đã xoá' : 'Deleted';
  return vi ? 'Đã lưu' : 'Saved';
}

// ---- GET cache -------------------------------------------------------------

/**
 * A 15-second memory for GETs.
 *
 * Why it exists: every page fetches everything on mount, so pressing Back —
 * or hopping between Lịch hẹn and Hộp thư — re-downloads data that is seconds
 * old, against an API that may live an ocean away. Fifteen seconds is long
 * enough to make navigation feel instant and short enough that no salon
 * decision is ever made on meaningfully stale numbers.
 *
 * Why it is WIPED — entirely — by any write: after "save", every screen must
 * show the saved world. Working out which cached GET a given POST invalidates
 * is a dependency graph nobody will maintain; wiping all of it is one line
 * and cannot be wrong, only slightly slower. Streams and unread-badge pulls
 * refresh themselves anyway.
 */
export const GET_TTL_MS = 15_000;

/**
 * Writes that leave the cached world TRUE.
 *
 * "Any write wipes everything" is the honesty rule above — but marking a
 * conversation read, re-registering push, a heartbeat: these change nothing a
 * cached GET ever showed. And the read-mark fires on EVERY conversation open,
 * so with the blanket rule the cache was being emptied at exactly the moment
 * it was most useful: flicking between customers in the inbox.
 */
const CACHE_PRESERVING: RegExp[] = [
  /\/read$/,
  /\/push\//,
  /\/heartbeat|\/hello|\/telemetry|\/track/,
];

export function preservesCache(method: string, path: string): boolean {
  if (String(method || 'GET').toUpperCase() === 'GET') return true;
  const p = String(path || '').split('?')[0];
  return CACHE_PRESERVING.some((rx) => rx.test(p));
}

/** Paths whose answers must never be served from memory. */
const NEVER_CACHE: RegExp[] = [
  /\/stream/,           // SSE — not a JSON GET, but belt and braces
  /\/healthz/,
  /\/export|\/download/, // files
];

export function cacheable(method: string, path: string): boolean {
  if (String(method || 'GET').toUpperCase() !== 'GET') return false;
  const p = String(path || '').split('?')[0];
  return !NEVER_CACHE.some((rx) => rx.test(p));
}

/** One entry per path+identity. A branch switch or a re-login changes the key,
 *  so tenant A's cache can never answer tenant B's screen. */
export function cacheKey(path: string, token: string | null | undefined, branch: string | null | undefined): string {
  // The token's SIGNATURE only — enough to split identities without keeping
  // whole JWTs alive in yet another place.
  const t = String(token ?? '');
  const sig = t.length > 24 ? t.slice(-16) : t;
  return `${sig}|${branch ?? ''}|${path}`;
}

export class GetCache {
  private map = new Map<string, { at: number; data: unknown }>();

  get(key: string, now: number = Date.now()): { hit: boolean; data?: unknown } {
    const e = this.map.get(key);
    if (!e) return { hit: false };
    if (now - e.at > GET_TTL_MS) { this.map.delete(key); return { hit: false }; }
    return { hit: true, data: e.data };
  }

  set(key: string, data: unknown, now: number = Date.now()): void {
    // Bounded. A long POS shift visits a lot of paths; an unbounded map is a
    // slow leak nobody would ever trace back to "the cache".
    if (this.map.size > 200) this.map.clear();
    this.map.set(key, { at: now, data });
  }

  /** Any write anywhere → forget everything. See the header for why. */
  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ---- slow-server notice ----------------------------------------------------

/**
 * After this long with no answer, say WHY instead of looking dead.
 * Render's free tier spins the API down when idle; the first request of the
 * morning can take tens of seconds. A spinner that long reads as "broken";
 * one line of truth reads as "starting, wait".
 */
export const SLOW_NOTICE_MS = 6_000;

export function slowText(vi: boolean): string {
  return vi
    ? 'Máy chủ đang khởi động, chờ vài giây…'
    : 'The server is waking up — a few more seconds…';
}
