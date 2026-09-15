/**
 * WHETHER THE BRAIN IS ANSWERING — and how anybody finds out.
 *
 * THE OUTAGE THIS EXISTS BECAUSE OF
 *
 * Every salon's bot stopped answering. Every customer on every channel got the
 * holding line — "hệ thống đang hơi chậm một chút, em đã chuyển cho nhân viên"
 * — and every thread was flagged for a human who did not know fifty-five
 * shops' worth of threads had just landed on them.
 *
 * The agency found out from a SCREENSHOT A CUSTOMER SENT. Not from a log, not
 * from an alert, not from a screen. That is the real defect, and it is worse
 * than whatever broke the API call:
 *
 *   - A missing ANTHROPIC_API_KEY returned the holding line and logged
 *     NOTHING. Not a warning, not once at boot. Silence is indistinguishable
 *     from working.
 *   - An API error logged one `warn` per message, which in a busy hour is a
 *     thousand identical lines nobody is watching and no alert fires on.
 *   - /api/health reported the process and the database and said nothing about
 *     the one dependency that every conversation on the platform runs through.
 *
 * So this module does three things the code around it was not doing: it tells
 * the KINDS of failure apart (a missing key and a rate limit need opposite
 * reactions), it keeps a small rolling verdict so one flaky call is not an
 * outage and a genuine outage is, and it makes the verdict readable from
 * outside the process — on the public health endpoint, where a free uptime
 * monitor can watch it and ring a phone.
 *
 * DELIBERATELY IN MEMORY, DELIBERATELY NOT A METRIC SYSTEM
 *
 * The state lives in the process and dies with it. An outage that ends when
 * the service restarts is an outage that ended; there is nothing to persist.
 * What matters is that the answer is available WHILE it is happening, which no
 * amount of after-the-fact analytics provides.
 */

/**
 * What went wrong, in the only categories that lead to different actions.
 *
 * 'no-key' is separated from every other kind on purpose. The rest may be a
 * bad minute; a missing key is a configuration mistake that will never heal on
 * its own, so it raises the alarm on the FIRST occurrence rather than waiting
 * for a streak.
 */
export type AiFailureKind =
  /** ANTHROPIC_API_KEY is not set on this instance. Config, not weather. */
  | 'no-key'
  /** 401/403 — the key exists and is refused. Revoked, rotated, or wrong. */
  | 'auth'
  /** Out of credit, or a spend cap was hit. Billing, not code. */
  | 'credit'
  /** 429 — too many requests, or an org rate limit. */
  | 'rate-limit'
  /** 404 on the model — retired, renamed, or a typo in ANTHROPIC_AGENT_MODEL. */
  | 'model'
  /** The request did not come back in time. */
  | 'timeout'
  /** 5xx — their side, usually a moment. */
  | 'server'
  /** Never reached them at all: DNS, egress, TLS. */
  | 'network'
  | 'other';

/** Bodies that mean "out of money" arrive as a 400, which otherwise means
 *  "we sent something wrong" — so the body has to be read, not just the code. */
const CREDIT = /credit balance|billing|payment|insufficient (funds|credit)|spend (limit|cap)/i;
const MODEL_GONE = /model[^a-z]{0,3}(not[_ ]found|does not exist|is deprecated|has been retired)|not_found_error/i;

/**
 * The kind, from what the API said.
 *
 * `status` is null when the request never produced a response at all — pass
 * the thrown error's message as `body` and a timeout is told from a network
 * failure, which are different problems with different fixes.
 */
export function classifyAiFailure(status: number | null, body?: string | null): AiFailureKind {
  const text = String(body ?? '');
  if (status === null) {
    if (/abort|timeout|timed out|ETIMEDOUT/i.test(text)) return 'timeout';
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|certificate|TLS/i.test(text)) return 'network';
    return 'other';
  }
  if (status === 401 || status === 403) return 'auth';
  if (status === 404 && MODEL_GONE.test(text)) return 'model';
  if (status === 429) return CREDIT.test(text) ? 'credit' : 'rate-limit';
  if (status === 400 && CREDIT.test(text)) return 'credit';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  return 'other';
}

/**
 * WHAT TO DO ABOUT IT, written for the person who will be woken up.
 *
 * Not a description of the error — the status code already is one. Each line
 * names the screen to open and the thing to change there, because an alert
 * that requires a diagnosis before it can be acted on will be read and put
 * down again.
 */
export function aiFailureAdvice(kind: AiFailureKind): { vi: string; en: string } {
  switch (kind) {
    case 'no-key':
      return {
        vi: 'Render → lumio-api → Environment: biến ANTHROPIC_API_KEY đang trống. Dán key vào rồi deploy lại.',
        en: 'Render → lumio-api → Environment: ANTHROPIC_API_KEY is empty. Paste the key in and redeploy.',
      };
    case 'auth':
      return {
        vi: 'Key bị từ chối (401/403) — có thể đã bị thu hồi hoặc đổi. Tạo key mới ở console.anthropic.com rồi cập nhật trên Render.',
        en: 'The key was refused (401/403) — revoked or rotated. Create a new one at console.anthropic.com and update it on Render.',
      };
    case 'credit':
      return {
        vi: 'Hết credit hoặc chạm hạn mức chi tiêu. console.anthropic.com → Billing: nạp thêm hoặc nâng hạn mức.',
        en: 'Out of credit, or a spend cap was hit. console.anthropic.com → Billing: top up or raise the limit.',
      };
    case 'rate-limit':
      return {
        vi: 'Đang bị giới hạn số lượt gọi (429). Thường tự hết sau vài phút; nếu kéo dài thì xin nâng rate limit.',
        en: 'Rate limited (429). Usually clears in minutes; if it persists, request a higher limit.',
      };
    case 'model':
      return {
        vi: 'Model trong ANTHROPIC_AGENT_MODEL không còn dùng được. Đổi sang model đang hoạt động rồi deploy lại.',
        en: 'The model in ANTHROPIC_AGENT_MODEL is no longer available. Point it at a live model and redeploy.',
      };
    case 'timeout':
      return {
        vi: 'Gọi sang Anthropic quá hạn chờ. Nếu lặp lại liên tục thì kiểm tra mạng ra ngoài của Render.',
        en: 'The call to Anthropic timed out. If it keeps happening, check Render outbound networking.',
      };
    case 'network':
      return {
        vi: 'Không ra được tới api.anthropic.com từ máy chủ. Kiểm tra DNS / tường lửa / egress của Render.',
        en: 'Cannot reach api.anthropic.com from the server. Check Render DNS, firewall or egress.',
      };
    case 'server':
      return {
        vi: 'Lỗi phía Anthropic (5xx). Thường tự hết; theo dõi status.anthropic.com.',
        en: 'Anthropic-side error (5xx). Usually clears; watch status.anthropic.com.',
      };
    default:
      return {
        vi: 'Lỗi chưa phân loại — xem log lumio-api, tìm chữ "Anthropic".',
        en: 'Unclassified error — check the lumio-api logs and search for "Anthropic".',
      };
  }
}

// ---- the rolling verdict ----------------------------------------------------

export interface AiHealthState {
  okCount: number;
  failCount: number;
  /** Failures since the last success. One flaky call is not an outage. */
  streak: number;
  lastOkAt: number | null;
  lastFailAt: number | null;
  lastKind: AiFailureKind | null;
  /** Trimmed, never the request body — it can contain a customer's words. */
  lastDetail: string | null;
  /** When the alarm last went off, so it does not go off every message. */
  alertedAt: number | null;
}

/** Three consecutive failures. Below that it is weather, not an outage. */
export const OUTAGE_STREAK = 3;
/** How often a continuing outage is allowed to shout. */
export const ALERT_EVERY_MS = 30 * 60_000;

export function freshAiHealth(): AiHealthState {
  return {
    okCount: 0, failCount: 0, streak: 0,
    lastOkAt: null, lastFailAt: null, lastKind: null, lastDetail: null, alertedAt: null,
  };
}

export function recordAiSuccess(s: AiHealthState, now = Date.now()): AiHealthState {
  s.okCount += 1;
  s.streak = 0;
  s.lastOkAt = now;
  // The alarm is rearmed by a success, so a second outage after a recovery is
  // announced immediately rather than swallowed by the throttle window.
  s.alertedAt = null;
  return s;
}

export function recordAiFailure(s: AiHealthState, kind: AiFailureKind, detail?: string | null, now = Date.now()): AiHealthState {
  s.failCount += 1;
  s.streak += 1;
  s.lastFailAt = now;
  s.lastKind = kind;
  s.lastDetail = detail ? String(detail).slice(0, 200) : null;
  return s;
}

/**
 * Is the brain down?
 *
 * A missing key counts on the first failure: it is a fact about configuration,
 * not a sample of anything, and waiting for three customers to be let down
 * before saying so serves nobody.
 */
export function aiIsDown(s: AiHealthState): boolean {
  if (s.streak === 0) return false;
  if (s.lastKind === 'no-key' || s.lastKind === 'auth') return true;
  return s.streak >= OUTAGE_STREAK;
}

/** Shout now? True on the way into an outage, then at most every half hour. */
export function shouldAlert(s: AiHealthState, now = Date.now()): boolean {
  if (!aiIsDown(s)) return false;
  if (s.alertedAt === null) return true;
  return now - s.alertedAt >= ALERT_EVERY_MS;
}

export function markAlerted(s: AiHealthState, now = Date.now()): AiHealthState {
  s.alertedAt = now;
  return s;
}

/**
 * The line that goes in the log when the alarm fires.
 *
 * One searchable marker at the front. Render's log search and any log-based
 * alerting need a string that appears when and only when this is true, and
 * `AI-DOWN` is that string.
 */
export function aiAlertLine(s: AiHealthState, keyPresent: boolean, fallbackActive = false): string {
  const kind = s.lastKind ?? (keyPresent ? 'other' : 'no-key');
  return `AI-DOWN [${kind}] ${s.streak} consecutive failures — ${aiFailureAdvice(kind).en}`
    + (fallbackActive ? ' · OpenAI fallback is answering customers meanwhile' : ' · NO fallback: customers are getting the holding line')
    + (s.lastDetail ? ` · last: ${s.lastDetail}` : '');
}

/**
 * What /api/health publishes.
 *
 * Public and unauthenticated, like the rest of that endpoint, so it has to be
 * safe to read by anyone: a boolean for whether a key exists (never the key,
 * never a prefix of it), counts, and a category. `lastDetail` is deliberately
 * NOT published — an API error body can quote the message that caused it, and
 * that message is a customer's words.
 */
export function aiHealthReport(s: AiHealthState, keyPresent: boolean, now = Date.now()): {
  ok: boolean; keyPresent: boolean; kind: AiFailureKind | null;
  streak: number; replies: number; failures: number;
  lastOkAgoSec: number | null; lastFailAgoSec: number | null; advice: string | null;
} {
  const down = !keyPresent || aiIsDown(s);
  const kind = !keyPresent ? 'no-key' : (down ? s.lastKind : null);
  return {
    ok: !down,
    keyPresent,
    kind: kind ?? null,
    streak: s.streak,
    replies: s.okCount,
    failures: s.failCount,
    lastOkAgoSec: s.lastOkAt === null ? null : Math.round((now - s.lastOkAt) / 1000),
    lastFailAgoSec: s.lastFailAt === null ? null : Math.round((now - s.lastFailAt) / 1000),
    advice: kind ? aiFailureAdvice(kind).en : null,
  };
}

// ---- the one shared instance ------------------------------------------------

/**
 * One state per process, reachable from both the code that CALLS the API and
 * the endpoint that REPORTS on it — which live in different Nest modules and
 * have no reason to depend on each other. Everything above is pure and tested
 * on its own; this is the single mutable thing, kept in one place where it can
 * be seen.
 */
const shared = freshAiHealth();
export function sharedAiHealth(): AiHealthState { return shared; }
