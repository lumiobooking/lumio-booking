/**
 * BẢN TIN THỨ HAI — one push a week to the salon's OWNER: how the AI did.
 *
 * "AI tự xử lý 82% · đặt 41 lịch · 3 câu cần dạy" — the three numbers that
 * tell an owner whether to open the AI page this week, and a tap that opens
 * it on Tổng quan.
 *
 * Rules:
 *   - OFF until the salon switches it on (setting `ai_digest`, per salon) —
 *     the platform does not start notifying anyone by itself;
 *   - to the owner(s) of that salon only (SALON_ADMIN), never to staff and
 *     never to customers;
 *   - Monday, 9 o'clock in the SALON's own time zone, once per week (the week
 *     sent is kept on the setting, so a restart or a second instance does not
 *     send it twice);
 *   - nothing is sent for a week with no conversations: silence is not news.
 *
 * Pure: no database, no clock of its own (ai-digest.spec.ts).
 */

export const DIGEST_KEY = 'ai_digest';
export interface DigestSetting { on: boolean; lastWeek: string | null }

export function digestSettingFrom(raw: unknown): DigestSetting {
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  const o = (v ?? {}) as { on?: unknown; lastWeek?: unknown };
  return { on: o.on === true, lastWeek: typeof o.lastWeek === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.lastWeek) ? o.lastWeek : null };
}

/** Weekday (0 = Sunday), hour and calendar date of `now` in the salon's zone. */
export function localParts(now: Date, tz: string): { weekday: number; hour: number; date: string } {
  let zone = tz || 'America/New_York';
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { zone = 'America/New_York'; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday));
  return { weekday, hour: Number(p.hour) % 24, date: `${p.year}-${p.month}-${p.day}` };
}

/** Send now? Switched on, Monday 9:00–9:59 local, and this Monday not sent yet. Returns the week key to store, or null. */
export function digestDue(setting: DigestSetting, now: Date, tz: string): string | null {
  if (!setting.on) return null;
  const l = localParts(now, tz);
  if (l.weekday !== 1 || l.hour !== 9) return null;
  return setting.lastWeek === l.date ? null : l.date;
}

export interface DigestNumbers { conversations: number; selfHandledRate: number | null; booked: number; toTeach: number; happyRate: number | null }

/** The push itself — or null when there is nothing to say (no conversations that week). */
export function digestPush(n: DigestNumbers, vi: boolean): { title: string; body: string; url: string; tag: string } | null {
  if (!n.conversations) return null;
  const pct = (x: number | null) => (x == null ? null : `${Math.round(x * 100)}%`);
  const self = pct(n.selfHandledRate); const happy = pct(n.happyRate);
  const parts = vi
    ? [self ? `AI tự xử lý ${self} trong ${n.conversations} cuộc trò chuyện` : `${n.conversations} cuộc trò chuyện`, `${n.booked} lịch đã chốt`, happy ? `${happy} khách hài lòng` : '', n.toTeach > 0 ? `${n.toTeach} câu cần dạy AI` : 'không có câu nào cần dạy']
    : [self ? `The AI handled ${self} of ${n.conversations} chats alone` : `${n.conversations} chats`, `${n.booked} booked`, happy ? `${happy} happy` : '', n.toTeach > 0 ? `${n.toTeach} questions to teach` : 'nothing to teach'];
  return {
    title: vi ? 'AI của tiệm tuần qua' : 'Your AI last week',
    body: parts.filter(Boolean).join(' · '),
    url: n.toTeach > 0 ? '/salon/ai?tab=learn' : '/salon/ai?tab=home',
    tag: 'lumio-ai-digest',
  };
}
