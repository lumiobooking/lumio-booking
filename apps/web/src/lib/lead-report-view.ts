/**
 * rt245 — labels and small sums for the lead report screen. Pure.
 */
export type Grain = 'day' | 'week' | 'month';
export type Cell = { received: number; turns: number; answered: number; onTime: number; medianSec: number | null; lost: number; declined: number; selfTaken: number; contact: number; booked: number };
export type Rating = 'good' | 'ok' | 'weak' | 'few';
export type Reason = 'slow' | 'lost' | 'declines' | 'lowConv' | 'noBooking';
export type Person = {
  userId: string; name: string; rating: Rating; reasons: Reason[];
  cells: Record<string, Cell>;
  total: Cell & { convPct: number | null; onTimePct: number | null; lostPct: number | null; declinePct: number | null };
};
export type CompanyCell = { newChats: number; withContact: number; booked: number; bookedByStaff: number };
export type LeadReportResponse = {
  grain: Grain; tz: string; periods: string[]; teamConvPct: number | null; canSeeAll: boolean;
  people: Person[]; company: Record<string, CompanyCell> | null; companyTotal: CompanyCell | null;
};

const WD_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dm = (ymd: string) => `${Number(ymd.slice(8, 10))}/${Number(ymd.slice(5, 7))}`;

/** "T6 27/11", "23/11–29/11", "11/2026". */
export function periodLabel(key: string, grain: Grain, vi: boolean): string {
  if (grain === 'month') return `${Number(key.slice(5, 7))}/${key.slice(0, 4)}`;
  const d = new Date(`${key}T12:00:00Z`);
  if (grain === 'day') return `${(vi ? WD_VI : WD_EN)[d.getUTCDay()]} ${dm(key)}`;
  const end = new Date(d.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
  return `${dm(key)}–${dm(end)}`;
}

export const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n * 100) / d) : null);
export const pctText = (v: number | null) => (v == null ? '—' : `${v}%`);

/** 95 → "1p 35s", 4000 → "1g 6p". */
export function secText(s: number | null, vi: boolean): string {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return vi ? `${m}p ${s % 60}s` : `${m}m ${s % 60}s`;
  return vi ? `${Math.floor(m / 60)}g ${m % 60}p` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function ratingLabel(r: Rating, vi: boolean): string {
  return ({ good: vi ? 'Hiệu quả' : 'Strong', ok: vi ? 'Ổn' : 'OK', weak: vi ? 'Cần cải thiện' : 'Needs work', few: vi ? 'Chưa đủ dữ liệu' : 'Too few chats' })[r];
}

export function reasonText(r: Reason, vi: boolean): string {
  return ({
    slow: vi ? 'trả lời chậm (dưới 50% lượt giữ được trả lời đúng hạn)' : 'slow (under 50% of kept turns answered in time)',
    lost: vi ? 'để quá giờ nhiều (trên 30% lượt turn)' : 'lets many turns time out (over 30%)',
    declines: vi ? 'từ chối nhiều (trên 40% lượt turn)' : 'declines many turns (over 40%)',
    lowConv: vi ? 'tỉ lệ chốt dưới nửa mức của nhóm' : 'books under half the team rate',
    noBooking: vi ? 'chưa chốt được lịch nào' : 'no bookings yet',
  })[r];
}

/** The busiest period, for scaling the small bars. */
export function maxOf(values: number[]): number {
  return values.reduce((m, v) => (v > m ? v : m), 0) || 1;
}
