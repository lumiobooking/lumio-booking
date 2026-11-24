/**
 * rt231 — "hệ thống messenger AI vẫn còn chập".
 *
 * Seen on Lumio Agency (24/11): one question, two or three answers.
 *  - Hannah Le asked "Chi phí AI Messenger cho tiệm là bao nhiêu?". The Page's
 *    own automation answered at +2 s, then Lumio's AI answered again at +7 s.
 *  - Vicki Boughen tapped "Audit miễn phí gồm những gì?" twice, 6 s apart:
 *    the AI answered each tap, and the Page's automation answered too.
 *
 * Two rules, both checked just before the AI's reply goes out:
 *  1. A PERSON answered after the customer wrote (while the AI was still
 *     thinking): the AI's reply is dropped — the customer already has an
 *     answer from a human, and two answers look broken.
 *  2. The customer sent the SAME words again within 90 seconds and the AI has
 *     already answered them: no second answer (a double tap, a resent button).
 */

export interface GuardTurn {
  role?: string;
  content?: unknown;
  at?: string | null;
  manual?: boolean;
  failed?: boolean;
  source?: string;
}

/** A person (not the Page's automation, not Meta's lines) answered after `sinceMs`. */
export function personAnsweredSince(history: GuardTurn[], sinceMs: number | null, isMetaLine: (s: string) => boolean = () => false): boolean {
  if (sinceMs == null || !Number.isFinite(sinceMs)) return false;
  return (history ?? []).some((t) => !!t && t.role === 'assistant' && !!t.manual && !t.failed
    && t.source !== 'automation' && t.source !== 'meta-ai'
    && Date.parse(String(t.at ?? '')) > sinceMs
    && !isMetaLine(String(t.content ?? '')));
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The same words again within `windowMs`, already answered by the AI. */
export function answeredDoubleTap(prior: GuardTurn[], text: string, nowMs: number, windowMs = 90_000): boolean {
  const list = prior ?? [];
  let i = list.length - 1;
  while (i >= 0 && list[i]?.role !== 'user') i--;
  if (i < 0) return false;
  const prev = list[i];
  // Short answers ("yes", "ok", "5pm") repeat naturally to different questions — never treated as a double tap.
  if (norm(text).length < 15 || norm(prev.content) !== norm(text)) return false;
  const at = Date.parse(String(prev.at ?? ''));
  if (!Number.isFinite(at) || nowMs - at > windowMs || nowMs < at) return false;
  // The first tap's answer may still be on its way (two runs side by side):
  // inside 30 seconds the second tap is left to it.
  if (nowMs - at <= 30_000) return true;
  return list.slice(i + 1).some((t) => t?.role === 'assistant' && !t.failed && !t.manual);
}
