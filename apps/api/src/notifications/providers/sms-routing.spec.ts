import { twilioSenderFor, vnEsmsFor, platformEsmsFromEnv } from './sms-routing';

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

describe('which eSMS account a Vietnamese salon sends through', () => {
  const SALON = { apiKey: 'sk', secretKey: 'ss', brandname: 'TIEMA', oaid: 'oa-salon', znsBookingTempId: 't1', znsReminderTempId: '' };
  const SHARED = { apiKey: 'pk', secretKey: 'ps', brandname: '', oaid: 'oa-lumio', znsBookingTempId: 'b1', znsReminderTempId: 'r1' };

  it('never for a salon outside Vietnam, whatever the environment holds', () => {
    expect(vnEsmsFor({ market: 'US', salon: SALON, platform: SHARED })).toBeNull();
    expect(vnEsmsFor({ market: 'AU', platform: SHARED })).toBeNull();
  });

  it("a salon with its own complete eSMS setup keeps it", () => {
    const c = vnEsmsFor({ market: 'VN', salon: SALON, platform: SHARED });
    expect(c?.source).toBe('salon');
    expect(c?.oaid).toBe('oa-salon');
  });

  it("every other VN salon uses Lumio's shared Zalo OA — no brandname needed", () => {
    const c = vnEsmsFor({ market: 'VN', salon: { apiKey: 'x' }, platform: SHARED });
    expect(c?.source).toBe('platform');
    expect(c?.oaid).toBe('oa-lumio');
    expect(c?.znsBookingTempId).toBe('b1');
    expect(c?.brandname).toBe('');
  });

  it('a shared brandname alone is also enough', () => {
    expect(vnEsmsFor({ market: 'VN', platform: { apiKey: 'a', secretKey: 'b', brandname: 'LUMIO' } })?.brandname).toBe('LUMIO');
  });

  it('keys with neither a brandname nor a ZNS template are not a channel', () => {
    expect(vnEsmsFor({ market: 'VN', platform: { apiKey: 'a', secretKey: 'b', oaid: 'oa' } })).toBeNull();
    expect(vnEsmsFor({ market: 'VN', platform: { apiKey: 'a', brandname: 'LUMIO' } })).toBeNull();
    expect(vnEsmsFor({ market: 'VN', platform: null })).toBeNull();
  });

  it('reads the shared account from the environment', () => {
    const p = platformEsmsFromEnv({ ESMS_API_KEY: 'k', ESMS_SECRET_KEY: 's', ESMS_ZNS_OAID: 'o', ESMS_ZNS_BOOKING_TEMP_ID: 'b' });
    expect(vnEsmsFor({ market: 'VN', platform: p })?.source).toBe('platform');
  });
});
