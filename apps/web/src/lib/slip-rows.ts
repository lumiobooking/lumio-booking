/** The guest check's printer text, read line by line for the on-screen copy. Pure. */
import { QR_LINE } from './vietqr';

const TWO_COL = /^(.*?\S)\s{2,}(\S(?:.*\S)?)$/;
const TITLE = /^(PHIẾU TẠM TÍNH|BÀN |MANG VỀ|GUEST CHECK|TABLE )/i;

export function slipRows(text: string): Array<{ kind: 'rule' | 'qr' | 'line'; text: string; right?: string; centre?: boolean; size?: 'title' | 'bold' | 'normal' }> {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // Centred the way the printer decides it: as much space on the left as on the right.
  const cols = Math.max(32, Math.min(48, lines.reduce((m, l) => (QR_LINE.test(l) ? m : Math.max(m, l.length)), 0)));
  let first = true;
  return lines.map((l) => {
    const qr = QR_LINE.exec(l);
    if (qr) return { kind: 'qr' as const, text: qr[1] };
    if (/^\s*[-=_]{8,}\s*$/.test(l)) return { kind: 'rule' as const, text: '' };
    const body = l.trim();
    const lead = l.length - l.trimStart().length;
    const centre = !!body && lead >= 2 && Math.abs(lead - (cols - lead - body.length)) <= 2;
    const size = body && first ? 'title' : centre && TITLE.test(body) ? 'title' : /^(TỔNG|TOTAL)/i.test(body) ? 'bold' : 'normal';
    if (body) first = false;
    const m = !centre ? TWO_COL.exec(l) : null;
    return m && /\d/.test(m[2]) ? { kind: 'line' as const, text: m[1], right: m[2], size } : { kind: 'line' as const, text: centre ? body : l, centre, size };
  });
}

