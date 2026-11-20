/**
 * rt204 — the permanent record of what was said in a conversation.
 *
 * The owner's rule: "Nhân viên có thể xoá hoặc ẩn tin nhắn trên Meta nhưng
 * trên Lumio tuyệt đối không xoá được. Lịch sử nhân viên đều ghi lại hết để
 * tìm vấn đề."
 *
 * Why a table of its own: a thread keeps only its last ~20 turns (the bot's
 * working memory), and the full transcript was read back from Meta — so a
 * conversation deleted in Meta Business Suite took its history with it.
 *
 * How it is filled: every write of a thread's history (wherever in the code
 * it happens) records its newest turns here, idempotently — the same message
 * seen twice is one row (fingerprint). Nothing in the API updates or deletes
 * a row; the salon's own deletion (the whole tenant) is the only cascade.
 */
import * as crypto from 'crypto';

export type LogRole = 'customer' | 'ai' | 'staff' | 'page';

type TurnLike = {
  role?: string; content?: unknown; at?: string | null; manual?: boolean; by?: string | null;
  source?: string | null; failed?: boolean; messageId?: string | null; images?: unknown[];
};

export function roleOf(t: TurnLike): LogRole | null {
  if (t.role === 'user') return 'customer';
  if (t.role !== 'assistant') return null;
  if (['page', 'automation', 'meta-ai'].includes(String(t.source ?? ''))) return 'page';
  return t.manual ? 'staff' : 'ai';
}

export function fingerprint(threadId: string, role: string, at: string, content: string): string {
  return crypto.createHash('sha256').update(`${threadId}|${role}|${at}|${content}`).digest('hex');
}

/** The newest turns of a history as log rows (oldest first), at most `max`. */
export function logRowsFrom(tenantId: string, threadId: string, history: unknown, max = 30) {
  if (!tenantId || !threadId || !Array.isArray(history)) return [];
  const rows: {
    tenantId: string; threadId: string; fp: string; role: LogRole; byName: string | null; content: string;
    images?: string[]; messageId: string | null; failed: boolean; at: Date;
  }[] = [];
  for (const t of (history as TurnLike[]).slice(-max)) {
    if (!t || typeof t !== 'object') continue;
    const role = roleOf(t);
    if (!role) continue;
    const content = String(t.content ?? '').slice(0, 8000);
    const images = Array.isArray(t.images) ? t.images.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
    if (!content.trim() && !images.length) continue;
    const atMs = Date.parse(String(t.at ?? ''));
    if (!Number.isFinite(atMs)) continue; // no clock, no stable identity: the next write with one records it
    const at = new Date(atMs).toISOString();
    rows.push({
      tenantId, threadId, fp: fingerprint(threadId, role, at, content), role,
      // rt215: a Page row that was not a person says so, so "a person answered" can tell them apart.
      byName: role === 'staff' ? (t.by ? String(t.by).slice(0, 80) : null)
        : role === 'page' && String(t.source ?? '') === 'meta-ai' ? 'Meta AI'
        : role === 'page' && String(t.source ?? '') === 'automation' ? 'Tự động (Page)' : null,
      content, ...(images.length ? { images } : {}),
      messageId: t.messageId ? String(t.messageId).slice(0, 200) : null,
      failed: t.failed === true, at: new Date(atMs),
    });
  }
  return rows;
}

/** Is this Prisma call a write of a thread's history? */
export function historyWrite(params: { model?: string; action?: string; args?: { data?: Record<string, unknown>; create?: Record<string, unknown>; update?: Record<string, unknown> } }): unknown[] | null {
  if (params?.model !== 'MessengerThread') return null;
  const a = params.args ?? {};
  if (['update', 'updateMany', 'create'].includes(String(params.action))) {
    const h = a.data?.history;
    return Array.isArray(h) ? h : null;
  }
  if (params.action === 'upsert') {
    const h = (a.update?.history ?? a.create?.history);
    return Array.isArray(h) ? h : null;
  }
  return null;
}

/**
 * rt225 — the permanent log read back as a conversation. "Tin cũ load lúc được
 * lúc không, và chưa đầy đủ": the screen leaned on Meta's copy (at most 200
 * messages, and nothing at all when the Graph call failed or hung) with our
 * 20-line buffer as the fallback. The log already holds every message Lumio
 * has seen — live ones and everything copied from Meta on earlier opens — so
 * it is the floor: Meta adds to it, never replaces it.
 */
export type LogRow = { role: string; byName: string | null; content: string; images?: unknown; messageId: string | null; failed: boolean; at: Date };
export function turnsFromLog(rows: LogRow[]): Record<string, unknown>[] {
  return rows
    .filter((r) => r && String(r.content ?? '').trim())
    .map((r) => {
      const at = new Date(r.at).toISOString();
      if (r.role === 'customer') return { role: 'user', content: r.content, at, ...(r.messageId ? { messageId: r.messageId } : {}), ...(Array.isArray(r.images) && r.images.length ? { images: r.images } : {}) };
      const source = r.role === 'page' ? (r.byName === 'Meta AI' ? 'meta-ai' : r.byName === 'Tự động (Page)' ? 'automation' : 'page') : undefined;
      return {
        role: 'assistant', content: r.content, at,
        ...(r.role === 'staff' ? { manual: true, ...(r.byName ? { by: r.byName } : {}) } : {}),
        ...(source ? { source, ...(source === 'page' ? { manual: true } : {}) } : {}),
        ...(r.messageId ? { messageId: r.messageId } : {}),
        ...(r.failed ? { failed: true } : {}),
        ...(Array.isArray(r.images) && r.images.length ? { images: r.images } : {}),
      };
    });
}

/** Log turns older than the first turn of `base` (what Meta no longer returns), oldest first. */
export function olderThan(logTurns: Record<string, unknown>[], base: { at?: unknown }[]): Record<string, unknown>[] {
  const first = base.map((t) => Date.parse(String(t?.at ?? ''))).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (!Number.isFinite(first)) return [];
  return logTurns.filter((t) => Date.parse(String(t.at ?? '')) < first);
}
