import {
  classifyAiFailure, aiFailureAdvice, freshAiHealth, recordAiSuccess, recordAiFailure,
  aiIsDown, shouldAlert, markAlerted, aiAlertLine, aiHealthReport, OUTAGE_STREAK, ALERT_EVERY_MS,
} from './ai-health';

/**
 * The outage these lock in: every salon's bot fell back to the holding line
 * for hours because the API account had run out of credit, and the agency
 * learned of it from a customer's screenshot. Nothing in the process had said
 * a word.
 */

describe('telling the kinds of failure apart', () => {
  it('reads "out of credit" off a 400 body — the code alone says "bad request"', () => {
    // The exact body from the outage. A 400 is normally "we sent something
    // wrong"; this one is "the account has no money", and the two need
    // opposite reactions.
    const body = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
    expect(classifyAiFailure(400, body)).toBe('credit');
    expect(aiFailureAdvice('credit').vi).toMatch(/Billing/);
  });

  it('separates a revoked key from a missing one', () => {
    expect(classifyAiFailure(401, '')).toBe('auth');
    expect(classifyAiFailure(403, '')).toBe('auth');
    expect(aiFailureAdvice('no-key').vi).toMatch(/ANTHROPIC_API_KEY đang trống/);
    expect(aiFailureAdvice('auth').vi).toMatch(/thu hồi|đổi/);
  });

  it('knows a retired model from a rate limit from their weather', () => {
    expect(classifyAiFailure(404, '{"error":{"type":"not_found_error","message":"model: claude-x"}}')).toBe('model');
    expect(classifyAiFailure(429, 'rate_limit_error')).toBe('rate-limit');
    expect(classifyAiFailure(529, 'overloaded')).toBe('server');
    expect(classifyAiFailure(500, '')).toBe('server');
  });

  it('tells a timeout from a dead network when there was no response at all', () => {
    expect(classifyAiFailure(null, 'The operation was aborted due to timeout')).toBe('timeout');
    expect(classifyAiFailure(null, 'fetch failed: getaddrinfo ENOTFOUND api.anthropic.com')).toBe('network');
  });

  it('gives every kind an instruction, not a description', () => {
    for (const k of ['no-key', 'auth', 'credit', 'rate-limit', 'model', 'timeout', 'server', 'network', 'other'] as const) {
      const a = aiFailureAdvice(k);
      expect(a.vi.length).toBeGreaterThan(20);
      expect(a.en.length).toBeGreaterThan(20);
    }
  });
});

describe('one flaky call is weather; a streak is an outage', () => {
  it('does not call two failures an outage', () => {
    const s = freshAiHealth();
    recordAiFailure(s, 'server', '529');
    recordAiFailure(s, 'server', '529');
    expect(aiIsDown(s)).toBe(false);
    expect(shouldAlert(s)).toBe(false);
  });

  it(`calls ${OUTAGE_STREAK} in a row an outage`, () => {
    const s = freshAiHealth();
    for (let i = 0; i < OUTAGE_STREAK; i++) recordAiFailure(s, 'credit', '400');
    expect(aiIsDown(s)).toBe(true);
    expect(shouldAlert(s)).toBe(true);
  });

  it('a missing key is an outage on the FIRST failure — it will never heal on its own', () => {
    const s = freshAiHealth();
    recordAiFailure(s, 'no-key', 'unset');
    expect(aiIsDown(s)).toBe(true);
    expect(shouldAlert(s)).toBe(true);
    const t = freshAiHealth();
    recordAiFailure(t, 'auth', '401');
    expect(aiIsDown(t)).toBe(true);
  });

  it('a success ends the streak and re-arms the alarm', () => {
    const s = freshAiHealth();
    for (let i = 0; i < OUTAGE_STREAK; i++) recordAiFailure(s, 'credit', '400');
    markAlerted(s);
    recordAiSuccess(s);
    expect(aiIsDown(s)).toBe(false);
    expect(s.alertedAt).toBeNull();
    // A second outage after a recovery is announced immediately.
    for (let i = 0; i < OUTAGE_STREAK; i++) recordAiFailure(s, 'credit', '400');
    expect(shouldAlert(s)).toBe(true);
  });
});

describe('shouting once, not once per customer', () => {
  it('alerts on the way in, then stays quiet for half an hour', () => {
    const t0 = 1_000_000;
    const s = freshAiHealth();
    for (let i = 0; i < OUTAGE_STREAK; i++) recordAiFailure(s, 'credit', '400', t0);
    expect(shouldAlert(s, t0)).toBe(true);
    markAlerted(s, t0);
    // A thousand more failing customers in the next 29 minutes: one line, not a thousand.
    for (let i = 0; i < 1000; i++) recordAiFailure(s, 'credit', '400', t0 + i * 1000);
    expect(shouldAlert(s, t0 + ALERT_EVERY_MS - 1)).toBe(false);
    expect(shouldAlert(s, t0 + ALERT_EVERY_MS)).toBe(true);
  });

  it('writes a line a log search can find, with the fix in it', () => {
    const s = freshAiHealth();
    for (let i = 0; i < OUTAGE_STREAK; i++) recordAiFailure(s, 'credit', '400 credit balance is too low');
    const line = aiAlertLine(s, true);
    expect(line).toMatch(/^AI-DOWN \[credit\]/);
    expect(line).toMatch(/Billing/);
    expect(line).toMatch(/3 consecutive failures/);
  });
});

describe('what the public probe publishes', () => {
  it('reports ok with no key problem and no streak', () => {
    const r = aiHealthReport(freshAiHealth(), true);
    expect(r.ok).toBe(true);
    expect(r.keyPresent).toBe(true);
    expect(r.kind).toBeNull();
  });

  it('reports not-ok the moment the key is absent, before a single call', () => {
    // The probe does not have to wait for a customer to be let down.
    const r = aiHealthReport(freshAiHealth(), false);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('no-key');
    expect(r.advice).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('never publishes the error body — it can quote a customer', () => {
    const s = freshAiHealth();
    for (let i = 0; i < OUTAGE_STREAK; i++) recordAiFailure(s, 'credit', 'customer said: my phone is 555-0100');
    const r = aiHealthReport(s, true);
    expect(JSON.stringify(r)).not.toMatch(/555-0100/);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('credit');
  });

  it('measures ages in seconds so a dashboard can read them without the clock', () => {
    const s = freshAiHealth();
    recordAiSuccess(s, 1_000_000);
    const r = aiHealthReport(s, true, 1_090_000);
    expect(r.lastOkAgoSec).toBe(90);
    expect(r.lastFailAgoSec).toBeNull();
  });
});
