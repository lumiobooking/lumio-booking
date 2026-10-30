/**
 * Who wrote a line the Page sent that Lumio did not send?
 *
 * Every such echo used to mean "a person is answering — the bot steps aside".
 * The live transcripts of 28 salons (30 Oct 2026) showed most of them were
 * not people at all:
 *   - Meta's notices ("X replied to your automated welcome message…",
 *     "X replied to a post…", "Bạn đã trả lời … chưa? Họ đang chờ bạn đấy.");
 *   - the Page's own automation: Kin's Restaurant's welcome message ("Hi Roy!
 *     Welcome to Kin's Restaurant…") 2 s after the notice, an instant answer
 *     ("Hello Roy Alex! Our address is…") 3 s after the customer wrote —
 *     faster than anybody types;
 *   - Meta's Business AI ("Your AI agent will respond." then its answers).
 * Each one silenced the salon's bot for its "human is talking" grace, with no
 * error anywhere. Now only a person holds the chat.
 *
 * Pure (automation-echo.spec.ts).
 */

/** An echo this soon after the customer wrote, or after a Meta notice, is a machine. */
export const AUTOMATION_AFTER_CUSTOMER_MS = 6_000;
export const AUTOMATION_AFTER_NOTICE_MS = 8_000;
/** After "Your AI agent will respond.", the thread's next echoes are Meta's AI for this long. */
export const META_AI_HOLD_MS = 30 * 60_000;

export type EchoKind = 'notice' | 'automation' | 'meta-ai' | 'person';

export function echoKind(e: {
  /** The echo is one of Meta's own lines (meta-system-lines). */
  notice: boolean;
  /** The echo is Meta's AI announcing itself. */
  metaAi: boolean;
  nowMs: number;
  lastNoticeMs?: number | null;
  lastCustomerMs?: number | null;
  /** When Meta's AI last announced itself in this thread. */
  metaAiMs?: number | null;
}): EchoKind {
  if (e.notice || e.metaAi) return 'notice';
  if (e.metaAiMs != null && e.nowMs - e.metaAiMs >= 0 && e.nowMs - e.metaAiMs < META_AI_HOLD_MS) return 'meta-ai';
  if (e.lastNoticeMs != null && e.nowMs - e.lastNoticeMs >= 0 && e.nowMs - e.lastNoticeMs < AUTOMATION_AFTER_NOTICE_MS) return 'automation';
  if (e.lastCustomerMs != null && e.nowMs - e.lastCustomerMs >= 0 && e.nowMs - e.lastCustomerMs < AUTOMATION_AFTER_CUSTOMER_MS) return 'automation';
  return 'person';
}

/** The newest `at` (ms) of a turn that matches, or null. */
export function lastStampOf<T extends { at?: string | null; content?: unknown; role?: string }>(history: T[], match: (t: T & { content: string }) => boolean): number | null {
  for (let i = (history?.length ?? 0) - 1; i >= 0; i--) {
    const t = history[i];
    if (!t) continue;
    if (match({ ...t, content: String(t.content ?? '') })) {
      const at = t.at ? Date.parse(t.at) : NaN;
      return Number.isFinite(at) ? at : null;
    }
  }
  return null;
}

export function maxOf(a: number | null | undefined, b: number | null | undefined): number | null {
  const xs = [a, b].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return xs.length ? Math.max(...xs) : null;
}

/** Ten minutes: far longer than an echo ever takes to come back. */
export const OWN_ECHO_MS = 10 * 60_000;

/**
 * Is this echo one of OUR bot's own replies (same words, sent by the bot in
 * the last ten minutes)? The per-process "ids we sent" memory cannot answer
 * that when another API process handles the echo; the stored history can.
 */
export function ownEcho(history: { role?: string; content?: unknown; at?: string | null; manual?: boolean; failed?: boolean }[], body: string, nowMs: number): boolean {
  const want = String(body ?? '').trim().slice(0, 1000);
  if (!want) return false;
  for (let i = (history?.length ?? 0) - 1; i >= 0; i--) {
    const t = history[i];
    if (!t || t.role !== 'assistant' || t.manual) continue;
    const at = t.at ? Date.parse(t.at) : NaN;
    if (Number.isFinite(at) && nowMs - at > OWN_ECHO_MS) break;
    if (String(t.content ?? '').trim().slice(0, 1000) === want) return true;
  }
  return false;
}
