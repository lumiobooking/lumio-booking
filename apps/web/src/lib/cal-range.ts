/**
 * KÉO ĐỂ KHOÁ / MỞ LỊCH trên Calendar — what a drag over a technician's
 * column means. Pure (cal-range.spec.ts); the server does the same sums
 * (api staff/extra-hours.ts) and is the one that writes.
 */
import type { CalBlock } from './cal-blocks';

export interface Span { s: number; e: number }
/** Extra hours opened on the Calendar for one technician, one day. */
export interface OpenHours { id: string; staffId: string; day: string; startTime: string; endTime: string }

export const hmToMin = (v: string): number => { const [h, m] = String(v || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const minToHm = (m: number): string => {
  const v = Math.max(0, Math.min(24 * 60, Math.round(m)));
  return v >= 24 * 60 ? '24:00' : `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

export function union(spans: Span[]): Span[] {
  const xs = spans.filter((x) => x.e > x.s).map((x) => ({ ...x })).sort((a, b) => a.s - b.s);
  const out: Span[] = [];
  for (const x of xs) { const l = out[out.length - 1]; if (l && x.s <= l.e) l.e = Math.max(l.e, x.e); else out.push(x); }
  return out;
}
export function subtract(a: Span[], cut: Span[]): Span[] {
  let left = union(a);
  for (const c of union(cut)) {
    const next: Span[] = [];
    for (const x of left) {
      if (c.e <= x.s || c.s >= x.e) { next.push(x); continue; }
      if (c.s > x.s) next.push({ s: x.s, e: c.s });
      if (c.e < x.e) next.push({ s: c.e, e: x.e });
    }
    left = next;
  }
  return left;
}
const covers = (spans: Span[], r: Span) => subtract([r], spans).length === 0;
const touches = (spans: Span[], r: Span) => spans.some((x) => x.s < r.e && x.e > r.s);

/** Her working spans that day: weekly parts plus the extra hours opened for that day. */
export function partsWithOpen(parts: Span[], open: OpenHours[], staffId: string, day: string): Span[] {
  return union([...parts, ...open.filter((o) => o.staffId === staffId && o.day === day).map((o) => ({ s: hmToMin(o.startTime), e: hmToMin(o.endTime) }))]);
}

/** The hatched (off) spans of a column between `from` and `to`. No weekly hours on file = never off. */
export function offSpans(hasHours: boolean, parts: Span[], from: number, to: number): Span[] {
  if (!hasHours) return [];
  return subtract([{ s: from, e: to }], parts);
}

/** A drag from minute a to minute b, on the 15-minute grid, at least 15 minutes long. */
export function snapRange(a: number, b: number, min = 0, max = 24 * 60): Span {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const s = Math.max(min, Math.floor(lo / 15) * 15);
  const e = Math.min(max, Math.max(s + 15, Math.ceil(hi / 15) * 15));
  return { s, e };
}

export interface RangeChoices {
  /** Some of it is working time not yet blocked → "Khoá giờ". */
  close: boolean;
  /** Some of it is off (outside her hours) or blocked by the desk → "Mở lịch lại". */
  open: boolean;
  /** All of it is free working time → "Đặt lịch" is offered too. */
  book: boolean;
  /** Leave she asked for / a whole-salon block is inside: opening skips those. */
  leaveInside: boolean;
  salonInside: boolean;
}

export function rangeChoices(r: Span, col: { off: Span[]; blocks: { s: number; e: number; b: Pick<CalBlock, 'byOwner' | 'wholeSalon'> }[]; busy?: Span[] }): RangeChoices {
  const blocked = union(col.blocks.map((x) => ({ s: x.s, e: x.e })));
  const deskBlocks = col.blocks.filter((x) => x.b.byOwner && !x.b.wholeSalon);
  const closedAll = union([...col.off, ...blocked]);
  const close = !covers(closedAll, r);
  const open = touches(col.off, r) || touches(deskBlocks, r);
  const book = !touches(closedAll, r) && !touches(col.busy ?? [], r);
  return {
    close, open, book,
    leaveInside: touches(col.blocks.filter((x) => !x.b.byOwner && !x.b.wholeSalon), r),
    salonInside: touches(col.blocks.filter((x) => x.b.wholeSalon), r),
  };
}

/** What the desk is told after the server answered. */
export function rangeResultText(a: { action: 'close' | 'open'; name: string; range: Span; blocked?: number; bookingsInside?: number; unblocked?: number; extraHours?: number; leaveKept?: boolean; salonKept?: boolean }, vi: boolean): string {
  const r = `${minToHm(a.range.s)}–${minToHm(a.range.e)}`;
  if (a.action === 'close') {
    const base = (a.blocked ?? 0) > 0 ? (vi ? `Đã khoá ${r} của ${a.name}.` : `Blocked ${r} for ${a.name}.`) : (vi ? `${a.name} đã nghỉ sẵn trong ${r}.` : `${a.name} is already off ${r}.`);
    const inside = (a.bookingsInside ?? 0) > 0 ? (vi ? ` Có ${a.bookingsInside} lịch hẹn trong giờ này — nhớ dời lịch.` : ` ${a.bookingsInside} booking(s) sit inside — move them.`) : '';
    return base + inside;
  }
  const done = (a.unblocked ?? 0) + (a.extraHours ?? 0) > 0;
  let t = done ? (vi ? `Đã mở lịch ${r} cho ${a.name}.` : `Opened ${r} for ${a.name}.`) : (vi ? `Không có giờ nào để mở trong ${r}.` : `Nothing to open in ${r}.`);
  if (a.leaveKept) t += vi ? ' Ngày nghỉ phép thợ xin giữ nguyên — sửa ở trang Nhân viên.' : ' Leave the technician asked for is kept — change it on the Staff page.';
  if (a.salonKept) t += vi ? ' Giờ khoá cả tiệm giữ nguyên — gỡ ở nút “Khoá giờ”.' : ' The whole-salon block is kept — remove it under “Block time”.';
  return t;
}
