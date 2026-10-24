/**
 * The team's notes on a salon, as the agency list shows them. The API owns
 * them (apps/api/src/support/agency-notes.ts); this side keeps the row's
 * summary in step after a change without re-reading the whole salon list.
 *
 * Pure (tested in agency-notes.spec.ts).
 */

export const NOTE_MAX = 1000;

export interface NoteView {
  id: string; body: string; pinned: boolean; by: string | null; at: string; editedAt: string | null;
  doneAt: string | null; doneBy: string | null; canEdit: boolean;
}

/** What the row shows — same shape the API puts on GET /support/tenants. */
export interface NotesSummary {
  open: number;
  pinned: number;
  top: { body: string; by: string | null; at: string; pinned: boolean } | null;
}

/** Pinned first, then newest. */
export function sortNotes<T extends { pinned: boolean; at: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : Date.parse(b.at) - Date.parse(a.at)));
}

/** The row's summary from the open notes; none open → null (the row shows nothing). */
export function summaryOf(open: Pick<NoteView, 'body' | 'pinned' | 'by' | 'at' | 'doneAt'>[]): NotesSummary | null {
  const live = sortNotes(open.filter((n) => !n.doneAt));
  if (!live.length) return null;
  const t = live[0];
  return {
    open: live.length,
    pinned: live.filter((n) => n.pinned).length,
    top: { body: t.body.length > 160 ? `${t.body.slice(0, 157)}…` : t.body, by: t.by, at: t.at, pinned: t.pinned },
  };
}

/** One line for the row: the first line of the note, without the rest. */
export function firstLine(body: string): string {
  const line = body.split('\n').find((l) => l.trim()) ?? '';
  return line.trim();
}

/** Put one note back into the open/done lists after the server answered a change. */
export function placeNote(lists: { open: NoteView[]; done: NoteView[] }, n: NoteView): { open: NoteView[]; done: NoteView[] } {
  const open = lists.open.filter((x) => x.id !== n.id);
  const done = lists.done.filter((x) => x.id !== n.id);
  if (n.doneAt) return { open, done: [n, ...done] };
  return { open: sortNotes([...open, n]), done };
}

export function dropNote(lists: { open: NoteView[]; done: NoteView[] }, id: string) {
  return { open: lists.open.filter((x) => x.id !== id), done: lists.done.filter((x) => x.id !== id) };
}
