import { twilioSenderFor } from './sms-routing';

describe('which Twilio sender a salon texts from', () => {
  it('US, Canada and anything unknown keep the platform default — unchanged', () => {
    for (const m of ['US', 'CA', '', null, undefined, 'xx']) {
      expect(twilioSenderFor({ market: m, lineNumber: '+61412345678', auFallback: '+61400000000' })).toEqual({ kind: 'default' });
    }
  });
  it('Australian salons share ONE platform +61 SMS number, like the US — even when they have a hotline number', () => {
    expect(twilioSenderFor({ market: 'AU', lineNumber: '+61412345678', auFallback: '+61400000000' })).toEqual({ kind: 'from', from: '+61400000000' });
    expect(twilioSenderFor({ market: 'au', lineNumber: '+18655868812', auFallback: '+61400000000' })).toEqual({ kind: 'from', from: '+61400000000' });
  });
  it("falls back to the salon's own +61 hotline number only when no shared number is set", () => {
    expect(twilioSenderFor({ market: 'AU', lineNumber: '+61412345678', auFallback: '' })).toEqual({ kind: 'from', from: '+61412345678' });
  });
  it('and never from the US number — it refuses with a reason instead', () => {
    const r = twilioSenderFor({ market: 'AU', lineNumber: null, auFallback: '' });
    expect(r.kind).toBe('refuse');
    expect(r.kind === 'refuse' && r.error).toMatch(/\+61/);
  });
  it('a Vietnamese salon without eSMS is refused, not sent into a carrier block', () => {
    const r = twilioSenderFor({ market: 'VN' });
    expect(r.kind === 'refuse' && r.error).toMatch(/eSMS/);
  });
});
