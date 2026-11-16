/**
 * THE CANARY — after every deploy, the scripted customers run once against
 * the platform's own demo salon, and the team is told if the AI got worse.
 *
 * "Mọi cập nhật không được làm lỗi hệ thống đang vận hành." The unit guards
 * prove the code does what it did yesterday; they cannot say whether a change
 * to a prompt made the real model behave worse. The customer simulations can
 * (their first run found a reply that would have gone to customers), but only
 * when somebody presses the button. So the server presses it itself, once per
 * deployed commit, on a salon that is ours — never on a customer's.
 *
 * Which salon: AI_CANARY_SLUG (default "lumio-salon", the platform's demo).
 * AI_CANARY=off switches it off. No such salon = nothing runs.
 * Sandbox only: nothing is booked, nothing is sent, no customer is involved.
 *
 * Pure here: when to run, and what counts as "worse" (ai-canary.spec.ts).
 */

export const CANARY_KEY = 'ai_canary';
export interface CanaryRecord { commit: string; at: string; state: 'running' | 'done' | 'error'; passed?: number; total?: number; failed?: string[]; error?: string }

export function canaryFrom(raw: string | null | undefined): CanaryRecord | null {
  try {
    const j = JSON.parse(String(raw ?? '')) as CanaryRecord;
    return j && typeof j.commit === 'string' && typeof j.at === 'string' ? j : null;
  } catch { return null; }
}

export function canarySlug(env: Record<string, string | undefined> = process.env): string | null {
  if (String(env.AI_CANARY ?? '').toLowerCase() === 'off') return null;
  return (env.AI_CANARY_SLUG ?? '').trim() || 'lumio-salon';
}

/** Run for this commit? A real commit, not yet run (or claimed) for it. */
export function canaryDue(commit: string, last: CanaryRecord | null): boolean {
  const c = String(commit ?? '').trim();
  if (!c || c === 'dev') return false;
  return !last || last.commit !== c;
}

/**
 * Worse than before? Two scripts fewer than the last finished run, or under
 * 80% outright. One script flipping is noise (the model is not deterministic);
 * two is a change somebody should look at before the next customer does.
 */
export function canaryVerdict(now: { passed: number; total: number }, before: CanaryRecord | null): { alert: boolean; why: string } {
  const rate = now.total ? now.passed / now.total : 0;
  if (now.total > 0 && rate < 0.8) return { alert: true, why: `only ${now.passed}/${now.total} passed` };
  if (before && before.state === 'done' && typeof before.passed === 'number' && before.total === now.total && now.passed <= before.passed - 2) {
    return { alert: true, why: `${now.passed}/${now.total} now, ${before.passed}/${before.total} on ${before.commit}` };
  }
  return { alert: false, why: '' };
}

export function canaryPush(commit: string, now: { passed: number; total: number }, why: string, failed: string[]): { title: string; body: string; url: string; tag: string } {
  return {
    title: `AI sau bản ${commit}: ${now.passed}/${now.total} kịch bản đạt`,
    body: `Mô phỏng khách trên tiệm demo kém hơn trước (${why}). Trượt: ${failed.slice(0, 5).join(', ') || '—'}. Xem trước khi khách gặp.`,
    url: '/agency',
    tag: 'lumio-ai-canary',
  };
}
