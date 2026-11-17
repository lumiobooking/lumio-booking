/**
 * THE GOLDEN RUN — what a build must pass before a new AI behaviour may reach
 * every salon.
 *
 * The release channel (./ai-release) ships a new behaviour to the platform's
 * own test accounts first. "Looks fine on the test page" was the only bar for
 * taking it to every salon's customers — one person's impression of a few
 * messages. The golden run is the bar made exact: on each test account, the
 * scripted customers (ai-brain/simulations) are put through the LIVE
 * assistant itself (messenger/dry-run — the real prompt, gates and owner's
 * instructions; nothing sent, nothing saved), with the behaviours being tried
 * switched on, and three things are measured:
 *
 *   - conduct: each reply graded against its script and the salon's own
 *     sources (two independent gradings; a fail needs both);
 *   - hard faults, by rule and not by opinion: the AI failed, apologised for
 *     being slow, held the reply, talked about its instructions, or wrote a
 *     wall of text;
 *   - speed: how long the AI worked on each reply, and where that time went.
 *
 * Moving any behaviour to "every salon" then requires the golden run OF THE
 * BUILD THAT IS RUNNING to have passed, with that behaviour switched on for
 * the test accounts while it ran. Taking a behaviour away ("off", or back to
 * the test accounts) is never held up by anything.
 *
 * Pure: the record, the verdict and the gate. The run is messenger/ai-golden.service.
 */

export const GOLDEN_KEY = 'ai_golden';

/** Scripts passing on each account, at least. Two gradings of a non-deterministic model: a single flip is noise. */
export const GOLDEN_MIN_PASS = 0.85;
/**
 * …or, for an account that has been run before on the same scripts: not worse
 * than its own best by more than one script. The run asks "did this build make
 * the AI worse?" — an account whose own notes contradict each other must not
 * hold every release back for ever (its real score stays on the screen, to be
 * fixed). Never below this floor, whatever it scored before.
 */
export const GOLDEN_FLOOR_PASS = 0.6;
/** The AI's own working time on a reply (median over the run), at most. The customer's wait adds the pause and the send. */
export const GOLDEN_MAX_MEDIAN_MS = 6_000;
/** A passed run stops counting after this long: the salon's knowledge and the model both move. */
export const GOLDEN_FRESH_MS = 24 * 3600_000;

export type HardFault = 'error' | 'apology' | 'held' | 'leak' | 'wall';

export interface GoldenItem { id: string; lang: string; pass: boolean; why: string; ms: number; hard: HardFault[] }
export interface GoldenAccount {
  name: string; mode: 'booking' | 'sales';
  passed: number; total: number;
  /** `id:lang` of every script that failed its grading or had a hard fault. */
  failed: string[];
  hard: number;
  medianMs: number | null; p90Ms: number | null;
  /** Share of replies whose first draft was sent back or repaired. */
  rewriteRate: number | null;
  /** Median milliseconds: preparing, the model writing, checking the draft. */
  steps: { prepMs: number; modelMs: number; checkMs: number } | null;
  /** The most scripts this account has passed on an earlier run of the SAME scripts (null = never run on them). */
  best?: number | null;
}
export interface GoldenRecord {
  commit: string; at: string; state: 'running' | 'done' | 'error';
  /** Behaviours that were live on the test accounts while this ran. */
  live: string[];
  accounts: GoldenAccount[];
  ok: boolean;
  /** Why it did not pass, in the operator's words (Vietnamese). */
  why: string[];
  by?: string | null;
  error?: string;
}

export function goldenFrom(raw: string | null | undefined): GoldenRecord | null {
  try {
    const j = JSON.parse(String(raw ?? '')) as GoldenRecord;
    if (!j || typeof j.commit !== 'string' || typeof j.at !== 'string' || !['running', 'done', 'error'].includes(j.state)) return null;
    return { ...j, live: Array.isArray(j.live) ? j.live.map(String) : [], accounts: Array.isArray(j.accounts) ? j.accounts : [], why: Array.isArray(j.why) ? j.why.map(String) : [], ok: j.ok === true };
  } catch { return null; }
}

export function pctlMs(values: number[], p: number): number | null {
  const v = values.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
}

/** One account's numbers, from its graded items and the step times of its replies. */
export function accountResult(o: { name: string; mode: 'booking' | 'sales'; items: GoldenItem[]; steps: { p: number; m: number; j: number; r: number }[]; best?: number | null }): GoldenAccount {
  const bad = o.items.filter((i) => !i.pass || i.hard.length);
  const times = o.items.map((i) => i.ms).filter((n) => n > 0);
  return {
    name: o.name, mode: o.mode,
    passed: o.items.length - bad.length, total: o.items.length,
    failed: bad.map((i) => `${i.id}:${i.lang}`),
    hard: o.items.filter((i) => i.hard.length).length,
    medianMs: pctlMs(times, 0.5), p90Ms: pctlMs(times, 0.9),
    rewriteRate: o.steps.length ? o.steps.filter((s) => s.r > 0).length / o.steps.length : null,
    steps: o.steps.length ? { prepMs: pctlMs(o.steps.map((s) => s.p), 0.5) as number, modelMs: pctlMs(o.steps.map((s) => s.m), 0.5) as number, checkMs: pctlMs(o.steps.map((s) => s.j), 0.5) as number } : null,
    best: typeof o.best === 'number' && Number.isFinite(o.best) ? o.best : null,
  };
}

/** What this account's next run is compared with: its best so far, when the scripts are the same ones. */
export function bestBefore(previous: GoldenRecord | null, name: string, total: number): number | null {
  if (!previous || previous.state !== 'done') return null;
  const a = previous.accounts.find((x) => x.name === name);
  if (!a || a.total !== total || !total) return null;
  return Math.max(a.passed, typeof a.best === 'number' ? a.best : 0);
}

/** Enough scripts right? The bar outright, or not worse than this account's own best by more than one (never under the floor). */
export function conductOk(a: Pick<GoldenAccount, 'passed' | 'total' | 'best'>): boolean {
  if (!a.total) return false;
  const rate = a.passed / a.total;
  if (rate >= GOLDEN_MIN_PASS) return true;
  return typeof a.best === 'number' && a.passed >= a.best - 1 && rate >= GOLDEN_FLOOR_PASS;
}

/** Did the run pass? Every account must: enough scripts, no hard fault, fast enough. */
export function goldenVerdict(accounts: GoldenAccount[]): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (!accounts.length) why.push('Không có tài khoản thử nào để chạy.');
  for (const a of accounts) {
    if (!a.total) { why.push(`${a.name}: không chạy được kịch bản nào.`); continue; }
    if (!conductOk(a)) why.push(`${a.name}: chỉ ${a.passed}/${a.total} kịch bản đạt (cần ít nhất ${Math.round(GOLDEN_MIN_PASS * 100)}%${typeof a.best === 'number' ? `, hoặc không kém lần tốt nhất trước đó là ${a.best}/${a.total} quá 1 kịch bản` : ''}).`);
    if (a.hard > 0) why.push(`${a.name}: ${a.hard} câu trả lời có lỗi nặng (AI lỗi, bị giữ lại, nói về dặn dò, hoặc viết quá dài).`);
    if (a.medianMs !== null && a.medianMs > GOLDEN_MAX_MEDIAN_MS) why.push(`${a.name}: AI soạn chậm — trung vị ${(a.medianMs / 1000).toFixed(1)} giây (tối đa ${GOLDEN_MAX_MEDIAN_MS / 1000} giây).`);
  }
  return { ok: why.length === 0, why };
}

export type GateRefusal = 'never-run' | 'other-build' | 'running' | 'error' | 'failed' | 'stale' | 'not-live';

/**
 * May `feature` be moved to every salon now? Only on the strength of a golden
 * run of THIS build that passed, recently, with the behaviour live on the
 * test accounts while it ran. A development build (no commit) is not gated.
 */
export function promotionGate(o: { record: GoldenRecord | null; commit: string; feature: string; nowMs: number }): { ok: true } | { ok: false; why: GateRefusal; vi: string } {
  const commit = String(o.commit ?? '').trim();
  if (!commit || commit === 'dev') return { ok: true };
  const r = o.record;
  if (!r) return { ok: false, why: 'never-run', vi: 'Chưa chạy bộ kiểm tra trên tài khoản thử. Bấm “Chạy bộ kiểm tra” trước.' };
  if (r.commit !== commit) return { ok: false, why: 'other-build', vi: `Bộ kiểm tra gần nhất chạy trên bản ${r.commit}, bản đang chạy là ${commit}. Chạy lại bộ kiểm tra cho bản này.` };
  if (r.state === 'running') return { ok: false, why: 'running', vi: 'Bộ kiểm tra đang chạy — chờ xong (khoảng 3 phút) rồi bật.' };
  if (r.state === 'error') return { ok: false, why: 'error', vi: `Bộ kiểm tra bị lỗi giữa chừng${r.error ? ` (${r.error})` : ''}. Chạy lại.` };
  if (!r.ok) return { ok: false, why: 'failed', vi: `Bộ kiểm tra chưa đạt: ${r.why.slice(0, 3).join(' ') || 'xem chi tiết bên dưới.'}` };
  const age = o.nowMs - Date.parse(r.at);
  if (!Number.isFinite(age) || age > GOLDEN_FRESH_MS) return { ok: false, why: 'stale', vi: 'Bộ kiểm tra đã chạy hơn 24 giờ trước. Chạy lại rồi bật.' };
  if (!r.live.includes(o.feature)) return { ok: false, why: 'not-live', vi: 'Lúc chạy bộ kiểm tra, tính năng này chưa bật trên tài khoản thử. Chuyển sang “Chỉ tài khoản thử”, chạy lại bộ kiểm tra, rồi mới bật cho mọi tiệm.' };
  return { ok: true };
}
