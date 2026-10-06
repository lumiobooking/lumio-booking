/**
 * THE DESK MAY ONLY BOOK WHILE THE SALON IS OPEN.
 *
 * A receptionist picked "11:40" in a 12-hour picker and got 11:40 PM: the
 * booking landed at 23:40 on a salon that closes at 6, and nothing said a word.
 * The booking form now checks the START time against the opening hours (same
 * rule as the server, see api settings/business-hours startsInBusinessHours)
 * and reads the chosen time back in words, so AM/PM mistakes are visible.
 *
 * The datetime-local value is the SALON's wall clock — no timezone maths here.
 */

export interface DayHoursLike { closed?: boolean; openMinutes?: number; closeMinutes?: number; intervals?: { open: number; close: number }[] | null }
export interface HoursRules { businessHours?: DayHoursLike[] | null; daysOff?: string[] | null }

export function windowsForDay(day: DayHoursLike | null | undefined): { open: number; close: number }[] {
  if (!day || day.closed) return [];
  const ivs = Array.isArray(day.intervals) ? day.intervals : [];
  const clean = ivs
    .map((iv) => ({ open: Math.round(Number(iv?.open)), close: Math.round(Number(iv?.close)) }))
    .filter((iv) => Number.isFinite(iv.open) && Number.isFinite(iv.close) && iv.close > iv.open);
  if (clean.length) return clean.sort((a, b) => a.open - b.open);
  const open = Math.round(Number(day.openMinutes));
  const close = Math.round(Number(day.closeMinutes));
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) return [];
  return [{ open, close }];
}

/** "YYYY-MM-DDTHH:mm" → its weekday (0 = Sunday), date and minutes from midnight. */
export function wallParts(local: string): { ymd: string; weekday: number; minutes: number; d: number; mo: number; h: number; mi: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { ymd: `${m[1]}-${m[2]}-${m[3]}`, weekday, minutes: h * 60 + mi, d, mo, h, mi };
}

export function clockText(min: number, vi: boolean): string {
  const h = Math.floor(min / 60) % 24; const mi = min % 60;
  if (vi) return `${h}:${String(mi).padStart(2, '0')}`;
  const ap = h < 12 ? 'AM' : 'PM'; const h12 = h % 12 || 12;
  return `${h12}:${String(mi).padStart(2, '0')} ${ap}`;
}

const VI_DAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Thứ Hai 5/10 lúc 23:40 (tối)" / "Monday 10/5 at 11:40 PM" — the readback under the picker. */
export function wallLabel(local: string, vi: boolean): string {
  const p = wallParts(local);
  if (!p) return '';
  if (vi) {
    const part = p.h < 12 ? 'sáng' : p.h < 18 ? 'chiều' : 'tối';
    return `${VI_DAYS[p.weekday]} ${p.d}/${p.mo} lúc ${clockText(p.minutes, true)} (${part})`;
  }
  return `${EN_DAYS[p.weekday]} ${p.mo}/${p.d} at ${clockText(p.minutes, false)}`;
}

export type HoursCheck =
  | { ok: true }
  | { ok: false; reason: 'dayOff' | 'closed' | 'outside'; open: string };

/** Does a booking starting at this salon wall time start while the salon is open? */
export function deskHoursCheck(local: string, rules: HoursRules | null | undefined, vi: boolean): HoursCheck {
  const p = wallParts(local);
  const days = rules?.businessHours;
  if (!p || !Array.isArray(days) || days.length !== 7) return { ok: true }; // nothing to check against
  if ((rules?.daysOff ?? []).includes(p.ymd)) return { ok: false, reason: 'dayOff', open: '' };
  const wins = windowsForDay(days[p.weekday]);
  if (!wins.length) return { ok: false, reason: 'closed', open: '' };
  if (wins.some((w) => p.minutes >= w.open && p.minutes < w.close)) return { ok: true };
  return { ok: false, reason: 'outside', open: wins.map((w) => `${clockText(w.open, vi)}–${clockText(w.close, vi)}`).join(', ') };
}

/** The sentence the form shows when the check fails. */
export function hoursMessage(local: string, c: HoursCheck, vi: boolean): string {
  if (c.ok) return '';
  const when = wallLabel(local, vi);
  if (c.reason === 'dayOff') return vi ? `${when}: tiệm nghỉ ngày này.` : `${when}: the salon is closed that day.`;
  if (c.reason === 'closed') return vi ? `${when}: tiệm không mở cửa ngày này.` : `${when}: the salon is not open that day.`;
  return vi
    ? `${when} nằm ngoài giờ làm việc (${c.open}). Kiểm tra lại SA/CH (sáng/chiều) hoặc chọn giờ khác.`
    : `${when} is outside opening hours (${c.open}). Check AM/PM, or pick another time.`;
}

// ---------------------------------------------------------------- server refusals

const VI_WD: Record<string, string> = { Sun: 'Chủ nhật', Mon: 'Thứ Hai', Tue: 'Thứ Ba', Wed: 'Thứ Tư', Thu: 'Thứ Năm', Fri: 'Thứ Sáu', Sat: 'Thứ Bảy' };

/** True for the server's opening-hours refusal (message or body starts with OUTSIDE_HOURS). */
export function isOutsideHours(e: unknown): boolean {
  const body = (e as { body?: { message?: unknown } } | null)?.body;
  const raw = typeof body?.message === 'string' ? body.message : e instanceof Error ? e.message : String(e ?? '');
  return /^OUTSIDE_HOURS/.test(raw);
}

/**
 * The server's refusal, readable. The API speaks English with a code in front;
 * a receptionist reads "Thứ Bảy 20/6 lúc 23:40 nằm ngoài giờ mở cửa (…)".
 * Anything else comes back untouched.
 */
export function outsideHoursText(raw: string, vi: boolean): string {
  if (!/^OUTSIDE_HOURS/.test(raw || '')) return raw;
  const body = raw.replace(/^OUTSIDE_HOURS:\s*/, '');
  const m = /^(\w{3}) (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) \(salon time\) is outside opening hours \((.*)\)\./.exec(body);
  if (m) {
    const [, wd, , mo, d, hh, mi, open] = m;
    return vi
      ? `${VI_WD[wd] ?? wd} ${Number(d)}/${Number(mo)} lúc ${Number(hh)}:${mi} (giờ tiệm) nằm ngoài giờ mở cửa (${open}). Kiểm tra lại SA/CH hoặc chọn giờ khác.`
      : body;
  }
  const off = /^(\d{4})-(\d{2})-(\d{2}) is marked as a day off/.exec(body);
  if (off) return vi ? `Ngày ${Number(off[3])}/${Number(off[2])} tiệm nghỉ. Chọn ngày khác.` : body;
  const closed = /^the salon is closed on (\w{3})/.exec(body);
  if (closed) return vi ? `Tiệm không mở cửa ${VI_WD[closed[1]] ?? closed[1]}. Chọn ngày khác.` : body;
  return body;
}

/**
 * Run a move/booking; when the server refuses it as outside opening hours and
 * the person is the OWNER, ask once and retry on purpose. Everyone else gets
 * the readable refusal. `ask` is window.confirm in the app, a stub in tests.
 */
export async function withHoursOverride<T>(
  run: (outsideHours: boolean) => Promise<T>,
  o: { owner: boolean; vi: boolean; ask?: (q: string) => boolean },
): Promise<T> {
  try {
    return await run(false);
  } catch (e) {
    if (!isOutsideHours(e)) throw e;
    const raw = (e as { body?: { message?: string } })?.body?.message ?? (e instanceof Error ? e.message : '');
    const text = outsideHoursText(raw, o.vi);
    const ask = o.ask ?? ((q: string) => (typeof window !== 'undefined' ? window.confirm(q) : false));
    if (o.owner && ask(`${text}\n\n${o.vi ? 'Bạn là chủ tiệm: vẫn đặt vào giờ này?' : 'You are the owner: book this time anyway?'}`)) return run(true);
    throw new Error(text);
  }
}
