/**
 * THE "TECHNICIAN IS BUSY" REFUSAL, SAID EXACTLY.
 *
 * "Staff member is already booked for this time slot" left the desk guessing
 * (Amy's Lash, 16/11: the tech picker just jumped back). The refusal now names
 * the technician and the visit's own time in the salon's clock, behind a code
 * the web turns into Vietnamese or English:
 *
 *   STAFF_BUSY: Amy already has a client on 2026-11-16 10:00-10:30. Change the time first, or pick another technician.
 *
 * Never the other client's name: the same check runs for the public booking page.
 */
export function staffBusyMessage(o: { staffName: string | null; start: Date; end: Date; tz: string; bufferMin?: number }): string {
  const name = (o.staffName ?? '').trim() || 'This technician';
  let date = '', from = '', to = '';
  try {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: o.tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: o.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    date = d.format(o.start); from = t.format(o.start); to = t.format(o.end);
  } catch {
    date = o.start.toISOString().slice(0, 10); from = o.start.toISOString().slice(11, 16); to = o.end.toISOString().slice(11, 16);
  }
  const gap = o.bufferMin && o.bufferMin > 0 ? ` (the salon keeps ${o.bufferMin} minutes between appointments)` : '';
  return `STAFF_BUSY: ${name} already has a client on ${date} ${from}-${to}${gap}. Change the time first, or pick another technician.`;
}
