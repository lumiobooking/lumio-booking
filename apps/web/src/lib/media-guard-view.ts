/**
 * The wrong-salon warning (api uploads/media-guard) as sentences.
 * A salon is told "another salon"; only Lumio staff get the other salon's name
 * — the server already strips it for everyone else, this only words it.
 */

export type GuardKind = 'same-file' | 'same-picture' | 'phone' | 'name' | 'link';
export interface GuardWarn { kind: GuardKind; salon?: string; found?: string; at?: string }
export interface MediaGuardView { sha256: string; warnings: GuardWarn[]; checked: { fingerprint: boolean; picture: boolean } }

function day(iso: string | undefined, vi: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return ` (${d.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'numeric', year: 'numeric' })})`;
}

export function guardLines(g: MediaGuardView, vi: boolean, staff: boolean): string[] {
  const other = (w: GuardWarn) => (staff && w.salon ? (vi ? `tiệm ${w.salon}` : w.salon) : (vi ? 'một tiệm khác' : 'another salon'));
  return (g?.warnings ?? []).map((w) => {
    switch (w.kind) {
      case 'same-file': return vi ? `File này đã được tải lên cho ${other(w)}${day(w.at, vi)}.` : `This exact file was already uploaded for ${other(w)}${day(w.at, vi)}.`;
      case 'same-picture': return vi ? `Ảnh này giống ảnh đã dùng cho ${other(w)}${day(w.at, vi)}.` : `This picture matches one used for ${other(w)}${day(w.at, vi)}.`;
      case 'phone': return vi
        ? `Trong ảnh có số điện thoại ${w.found ?? ''} — không phải số của tiệm này${w.salon && staff ? ` (là số của tiệm ${w.salon})` : ''}.`
        : `The picture shows the phone number ${w.found ?? ''}, which is not this salon’s${w.salon && staff ? ` (it is ${w.salon}’s)` : ''}.`;
      case 'name': return vi ? `Trong ảnh có tên "${w.found ?? ''}" — giống ${other(w)}.` : `The picture shows "${w.found ?? ''}", which looks like ${other(w)}.`;
      case 'link': return vi ? `Trong ảnh có link ${w.found ?? ''} của ${other(w)}.` : `The picture shows the link ${w.found ?? ''}, belonging to ${other(w)}.`;
      default: return vi ? 'File này có thể không phải của tiệm này.' : 'This file may not belong to this salon.';
    }
  });
}

/** Two checks on one item (a clip and its still frame) as one list, without repeats. */
export function mergeGuards(a: MediaGuardView | undefined, b: MediaGuardView): MediaGuardView {
  if (!a) return b;
  const seen = new Set(a.warnings.map((w) => `${w.kind}|${w.salon ?? ''}|${w.found ?? ''}`));
  const extra = b.warnings.filter((w) => !seen.has(`${w.kind}|${w.salon ?? ''}|${w.found ?? ''}`));
  return { sha256: a.sha256, warnings: [...a.warnings, ...extra], checked: { fingerprint: a.checked.fingerprint || b.checked.fingerprint, picture: a.checked.picture || b.checked.picture } };
}
