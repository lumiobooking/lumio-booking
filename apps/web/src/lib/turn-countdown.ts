/**
 * The countdown on a conversation that will pass to the next person if
 * nobody answers (chia turn). Pure: the screen ticks, this only words it.
 */
export function countdown(dueIso: string | null | undefined, now: number): { text: string; tone: 'bad' | 'warn' | 'info' } | null {
  if (!dueIso) return null;
  const due = new Date(dueIso).getTime();
  if (!Number.isFinite(due)) return null;
  const left = Math.round((due - now) / 1000);
  if (left <= 0) return { text: 'đang chuyển…', tone: 'bad' };
  const m = Math.floor(left / 60);
  const s = left % 60;
  const text = m >= 60 ? `${Math.floor(m / 60)}g${String(m % 60).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return { text: `còn ${text}`, tone: left <= 60 ? 'bad' : left <= 180 ? 'warn' : 'info' };
}
