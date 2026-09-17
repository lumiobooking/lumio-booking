import { canSelfCancel, CancelWindow, CancelAsk } from './self-cancel';

// A cancellation empties a chair and refunds money. Every refusal below is a
// slot the salon keeps, or a refund a person — not a bot — decided.
const W: CancelWindow = { enabled: true, noticeHours: 24 };
const NOW = Date.UTC(2026, 8, 17, 9, 0);
const ask = (o: Partial<CancelAsk> = {}): CancelAsk => ({
  now: NOW,
  startMs: NOW + 72 * 3_600_000, // three days out
  live: true,
  hasPaidDeposit: false,
  ...o,
});

describe('canSelfCancel', () => {
  it('allows a cancellation with plenty of notice', () => {
    const d = canSelfCancel(W, ask());
    expect(d.allowed).toBe(true);
    expect(d.code).toBe('ok');
    // The caller writes the confirmation, with the real appointment in it.
    expect(d.say).toBe('');
  });

  it('refuses when the salon turned self-cancel off, and says so without blaming the customer', () => {
    const d = canSelfCancel({ ...W, enabled: false }, ask());
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('disabled');
    expect(d.say).toMatch(/nhân viên/);
  });

  it('refuses inside the notice window and names the real reason', () => {
    const d = canSelfCancel(W, ask({ startMs: NOW + 3 * 3_600_000 }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('too-late');
    expect(d.say).toContain('24 tiếng');
    expect(d.detail).toContain('3h notice');
  });

  it('treats an appointment already past as too late, not as an error', () => {
    const d = canSelfCancel(W, ask({ startMs: NOW - 3_600_000 }));
    expect(d.code).toBe('too-late');
    expect(d.say).toContain('giờ hẹn đã qua');
  });

  it('never cancels an appointment that is not live', () => {
    const d = canSelfCancel(W, ask({ live: false }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('not-live');
  });

  // THE MONEY RULE. Cancelling refunds what was paid, so a paid deposit is a
  // human decision — the salon's no-show policy is the whole reason it exists.
  it('refuses a paid appointment and hands the refund to staff', () => {
    const d = canSelfCancel(W, ask({ hasPaidDeposit: true }));
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('deposit');
    expect(d.say).toMatch(/hoàn tiền|đặt cọc/);
  });

  it('answers a paid appointment with the DEPOSIT reason even when the notice also failed', () => {
    // Both would refuse. The customer's subject is their money; telling them
    // "too close to your appointment" answers a question they did not ask.
    const d = canSelfCancel(W, ask({ hasPaidDeposit: true, startMs: NOW + 3_600_000 }));
    expect(d.code).toBe('deposit');
  });

  it('honours a salon that asks for no notice at all', () => {
    const d = canSelfCancel({ enabled: true, noticeHours: 0 }, ask({ startMs: NOW + 10 * 60_000 }));
    expect(d.allowed).toBe(true);
  });
});
