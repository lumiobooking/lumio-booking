/**
 * A one-way loudspeaker from anywhere in the code to the toast stack.
 *
 * Deliberately not React state: the API client is a plain module and must be
 * able to speak without a hook. A DOM CustomEvent is the one bus both sides
 * already share. The listener (FeedbackToasts, mounted once in the root
 * layout) is the only place that renders anything.
 */

export type NoticeKind = 'success' | 'error' | 'info';

export const FEEDBACK_EVENT = 'lumio:notify';

export function notify(kind: NoticeKind, text: string): void {
  if (typeof window === 'undefined' || !text) return;
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail: { kind, text } }));
}

/** rt220: the same notice at most once every 15 s — three "server is starting" toasts stacked say nothing more than one. */
const lastSaid = new Map<string, number>();
export function notifyOnce(kind: NoticeKind, text: string, windowMs = 15_000): void {
  const k = `${kind}|${text}`;
  const now = Date.now();
  if (now - (lastSaid.get(k) ?? 0) < windowMs) return;
  lastSaid.set(k, now);
  notify(kind, text);
}
