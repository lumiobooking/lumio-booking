/**
 * What a phone call needs to know about its salon, read ONCE per call.
 *
 * Every turn of a call used to re-read the salon from the database before the
 * model could start: the line, the brain, the menu, the add-ons, the team,
 * the hours, the facts, the owner's instructions, the caller's record — about
 * twenty queries, one after another. The API runs in Oregon and the database
 * in Virginia, so each one is a cross-country round trip, and together they
 * were more than a second of silence on EVERY turn, before the model had read
 * a single word. None of it changes while a caller is on the line.
 *
 * So the first turn loads it and every later turn of the same call reuses it.
 *
 * TENANT ISOLATION: the key is tenant id + call sid + part. The tenant id is
 * the one the call row (read fresh every turn) belongs to, so a turn can only
 * ever be handed its own salon's context; two salons can never share an entry
 * even if a call sid were to repeat.
 *
 * What is NOT cached: the call row and its transcript (read fresh every turn),
 * availability (the tools read the live diary), and anything a tool writes.
 */
export class CallCache {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(private readonly ttlMs = 15 * 60_000, private readonly maxEntries = 400) {}

  static key(tenantId: string, callSid: string, part: string): string {
    return `${tenantId}\u0000${callSid}\u0000${part}`;
  }

  /** The cached value, or `load()` once — concurrent callers share one load. No call sid → no caching. */
  get<T>(tenantId: string, callSid: string | null | undefined, part: string, load: () => Promise<T>): Promise<T> {
    if (!tenantId || !callSid) return load();
    const k = CallCache.key(tenantId, callSid, part);
    const now = Date.now();
    const hit = this.entries.get(k);
    if (hit && now - hit.at < this.ttlMs) return hit.value as Promise<T>;
    if (this.entries.size >= this.maxEntries) this.sweep(now);
    const value = load();
    this.entries.set(k, { at: now, value });
    // A failed load is never remembered: the next turn tries again.
    value.catch(() => { if (this.entries.get(k)?.value === value) this.entries.delete(k); });
    return value;
  }

  /** Forget one call (it ended). */
  dropCall(callSid: string | null | undefined): void {
    if (!callSid) return;
    const tag = `\u0000${callSid}\u0000`;
    for (const k of this.entries.keys()) if (k.includes(tag)) this.entries.delete(k);
  }

  get size(): number { return this.entries.size; }

  private sweep(now: number): void {
    for (const [k, v] of this.entries) if (now - v.at >= this.ttlMs) this.entries.delete(k);
    // Still full: drop the oldest half.
    if (this.entries.size >= this.maxEntries) {
      const keys = [...this.entries.keys()];
      for (const k of keys.slice(0, Math.ceil(keys.length / 2))) this.entries.delete(k);
    }
  }
}
