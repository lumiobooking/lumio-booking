/**
 * rt244 — photos pasted (Ctrl/Cmd+V) or dropped onto the reply box (27/11/2026).
 * Pulls image files out of a clipboard / drag payload; the reply box then shows
 * them for a last look before they go (a stray paste must never reach a customer).
 * Pure: no DOM beyond the shapes below.
 */
export const MAX_PASTED = 5;
export const SENDABLE = /^image\/(jpeg|png|webp)$/;

type ItemLike = { kind: string; type: string; getAsFile(): File | null };
type TransferLike = { files?: ArrayLike<File> | null; items?: ArrayLike<ItemLike> | null } | null | undefined;

/** Image files in a clipboard or drop, at most `max`, without the same file twice. */
export function imageFiles(t: TransferLike, max = MAX_PASTED): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  const add = (f: File | null | undefined) => {
    if (!f || !/^image\//.test(f.type) || out.length >= max) return;
    const key = `${f.name}|${f.size}|${f.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  for (const f of Array.from(t?.files ?? [])) add(f);
  for (const it of Array.from(t?.items ?? [])) if (it.kind === 'file' && /^image\//.test(it.type)) add(it.getAsFile());
  return out;
}

/** Split into what can be sent and what cannot (GIF, HEIC…). */
export function splitSendable(files: File[]): { ok: File[]; bad: File[] } {
  return { ok: files.filter((f) => SENDABLE.test(f.type)), bad: files.filter((f) => !SENDABLE.test(f.type)) };
}

/** Does a drag carry files (so the reply box should light up)? */
export function dragHasFiles(types: ArrayLike<string> | null | undefined): boolean {
  return Array.from(types ?? []).includes('Files');
}
