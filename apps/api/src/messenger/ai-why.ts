/**
 * WHY THE AI DID NOT ANSWER (18/11/2026).
 *
 * A conversation lands in "needs a reply" and the person opening it sees a
 * customer's question with nothing under it. Was the AI switched off? Did it
 * break? Did it decide the question was not for it? Until now the screen did
 * not say, and the owner's reading was "the AI is not working".
 *
 * The moment the AI sends nothing, the reason is kept on the conversation as
 * ONE internal note (the newest replaces the last), stored as a code and
 * shown in the reader's own language. It belongs to the salon's thread and is
 * read only through the salon's own inbox.
 */

export const AI_WHY_CODES = ['silent_rule', 'silent_choice', 'held_rule', 'held_safety', 'failed'] as const;
export type AiWhy = (typeof AI_WHY_CODES)[number];

/** Who "wrote" the note. Never a staff account. */
export const AI_NOTE_AUTHOR = 'Lumio AI';
const TAG = /^\[\[AI_WHY ([a-z_]{3,24})\]\]$/;

export function aiWhyNote(code: AiWhy): string {
  return `[[AI_WHY ${code}]]`;
}

/** The code inside a stored note; null for anything a person wrote. */
export function readAiWhy(note: { text?: unknown; authorName?: unknown } | null | undefined): AiWhy | null {
  if (!note || note.authorName !== AI_NOTE_AUTHOR) return null;
  const m = String(note.text ?? '').trim().match(TAG);
  return m && (AI_WHY_CODES as readonly string[]).includes(m[1]) ? (m[1] as AiWhy) : null;
}

/** Is this row one of ours (whatever its code)? Used to keep them out of the staff's own notes. */
export function isAiWhyNote(note: { text?: unknown; authorName?: unknown } | null | undefined): boolean {
  return !!note && note.authorName === AI_NOTE_AUTHOR && /^\[\[AI_WHY /.test(String(note.text ?? '').trim());
}

/** Which reason, from how the turn ended. `guards`: what stopped drafts in this run. */
export function aiWhyFor(o: { outcome: 'silent' | 'held' | 'failed'; guards?: string[] | null; doorWhy?: string | null }): AiWhy {
  if (o.outcome === 'failed') return 'failed';
  const byRule = (o.guards ?? []).includes('instruction');
  if (o.outcome === 'silent') return byRule ? 'silent_rule' : 'silent_choice';
  return byRule || /^forbidden phrase/.test(String(o.doorWhy ?? '')) ? 'held_rule' : 'held_safety';
}

/** Does the note still describe the conversation? Only while the customer's last message is the one it was written for. */
export function aiWhyCurrent(noteAt: Date | string | null | undefined, lastCustomerAt: Date | string | null | undefined, customerLast: boolean): boolean {
  if (!customerLast || !noteAt || !lastCustomerAt) return false;
  const n = new Date(noteAt).getTime();
  const c = new Date(lastCustomerAt).getTime();
  return Number.isFinite(n) && Number.isFinite(c) && n >= c - 1000;
}
