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
