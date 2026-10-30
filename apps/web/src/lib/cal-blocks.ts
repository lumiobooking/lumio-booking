/**
 * BLOCK TẠM THỜI on the Calendar — hours or days the salon closed for one
 * technician or for everyone. The server stores them as approved time off
 * (GET/POST/DELETE /calendar-blocks) and refuses bookings inside them; this
 * file only turns them into what the Calendar paints and says.
 *
 * Dates are salon days ("YYYY-MM-DD"), times salon wall clock ("HH:mm"):
 * no timezone maths here.
 */

export interface CalBlock {
  id: string;
  staffId: string | null;
  wholeSalon: boolean;
  name: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  /** Made by the salon itself (a block, or leave the owner marked) — removable from the Calendar. */
  byOwner: boolean;
}

const hm = (s: string | null): number => {
  const m = /^(\d{2}):(\d{2})$/.exec(s || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Does this block cover salon day `day`? */
export function onDay(b: CalBlock, day: string): boolean {
  return b.startDate <= day && day <= b.endDate;
}

/** Does it take this column's time? (Whole-salon blocks take every column, the unassigned lane included.) */
export function forColumn(b: CalBlock, staffId: string | null): boolean {
  return b.wholeSalon || b.staffId == null || (!!staffId && b.staffId === staffId);
}

/** The minutes of `day` a block takes: its hours, or the whole day. */
export function spanOn(b: CalBlock, day: string): { s: number; e: number } | null {
  if (!onDay(b, day)) return null;
  const s = hm(b.startTime), e = hm(b.endTime);
  if (b.startTime && b.endTime && b.startDate === b.endDate && Number.isFinite(s) && Number.isFinite(e) && e > s) return { s, e };
  return { s: 0, e: 24 * 60 };
}

/** The bands to paint in one column on one day. */
export function bandsFor(blocks: CalBlock[], staffId: string | null, day: string): { s: number; e: number; b: CalBlock }[] {
  const out: { s: number; e: number; b: CalBlock }[] = [];
  for (const b of blocks) {
    if (!forColumn(b, staffId)) continue;
    const sp = spanOn(b, day);
    if (sp) out.push({ ...sp, b });
  }
  return out.sort((x, y) => x.s - y.s);
}

/** Is minute `m` of `day` blocked for this column? */
export function blockedAt(blocks: CalBlock[], staffId: string | null, day: string, m: number): CalBlock | null {
  return bandsFor(blocks, staffId, day).find((x) => m >= x.s && m < x.e)?.b ?? null;
}

const dm = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${Number(m[3])}/${Number(m[2])}` : d; };
const md = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? `${Number(m[2])}/${Number(m[3])}` : d; };

/** "13:00–15:00" · "cả ngày" · "31/10 → 2/11". */
export function blockWhen(b: CalBlock, vi: boolean): string {
  if (b.startTime && b.endTime && b.startDate === b.endDate) return `${b.startTime}–${b.endTime}`;
  if (b.startDate === b.endDate) return vi ? 'cả ngày' : 'all day';
  return vi ? `${dm(b.startDate)} → ${dm(b.endDate)}` : `${md(b.startDate)} → ${md(b.endDate)}`;
}

/** "Cả tiệm khoá 13:00–15:00 · Training" / "Kim nghỉ cả ngày". */
export function blockLabel(b: CalBlock, vi: boolean): string {
  const who = b.wholeSalon || b.staffId == null ? (vi ? 'Cả tiệm khoá' : 'Salon blocked') : (vi ? `${b.name || 'Thợ'} nghỉ` : `${b.name || 'Technician'} off`);
  return `${who} ${blockWhen(b, vi)}${b.reason ? ` · ${b.reason}` : ''}`;
}

/** The body the API takes, from the sheet's fields. Null + reason when something is missing. */
export function blockBody(f: { who: string; kind: 'hours' | 'day' | 'days'; date: string; endDate: string; from: string; to: string; reason: string }):
  { ok: true; body: { staffId?: string; startDate: string; endDate: string; startTime?: string; endTime?: string; reason?: string } } | { ok: false; why: 'date' | 'time' | 'order' } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return { ok: false, why: 'date' };
  const base = { ...(f.who && f.who !== 'ALL' ? { staffId: f.who } : {}), ...(f.reason.trim() ? { reason: f.reason.trim().slice(0, 300) } : {}) };
  if (f.kind === 'hours') {
    const s = hm(f.from), e = hm(f.to);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, why: 'time' };
    if (e <= s) return { ok: false, why: 'order' };
    return { ok: true, body: { ...base, startDate: f.date, endDate: f.date, startTime: f.from, endTime: f.to } };
  }
  if (f.kind === 'day') return { ok: true, body: { ...base, startDate: f.date, endDate: f.date } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.endDate)) return { ok: false, why: 'date' };
  if (f.endDate < f.date) return { ok: false, why: 'order' };
  return { ok: true, body: { ...base, startDate: f.date, endDate: f.endDate } };
}

/** "HH:mm" plus n minutes, clamped to 23:59 (a block ends the same day). */
export function addMin(t: string, n: number): string {
  const s = hm(t);
  if (!Number.isFinite(s)) return t;
  const v = Math.min(23 * 60 + 59, Math.max(0, s + n));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
