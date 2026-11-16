/**
 * WHEN THE DAILY GOOGLE FEED RUNS — even on a morning full of deploys.
 *
 * 16/11/2026: the first production upload never happened. The old timer ran
 * only between 03:00 and 03:15 UTC, ten minutes after the process started, and
 * remembered its run in memory. Ten deploys that morning (one at 03:01, one at
 * 03:08, one at 03:13 UTC) each restarted the clock, so no tick ever landed in
 * the window. Now: from the hour on, any tick that day runs it until it has
 * succeeded once; a failed try is retried at most hourly. The last run is
 * stored, so a restart neither forgets it nor uploads twice.
 */
export interface StoredRun { at: string; uploaded: boolean; error?: string | null }

/** A run that is "done for the day": it uploaded, or there was nothing to upload. */
export function finishedRun(r: StoredRun | null | undefined): boolean {
  return !!r && (r.uploaded || r.error === 'no salon ready');
}

export function dueToday(now: Date, hourUtc: number, last: StoredRun | null | undefined): boolean {
  if (now.getUTCHours() < hourUtc) return false;
  const today = now.toISOString().slice(0, 10);
  if (!last || last.at.slice(0, 10) !== today) return true;
  if (finishedRun(last)) return false;
  return now.getTime() - new Date(last.at).getTime() >= 60 * 60_000;
}
