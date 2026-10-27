import { contactModeOf, isTechViewer, maskPhone, maskText, redactContacts } from './contact-privacy';

describe('client contacts on the technician app', () => {
  it('defaults to the last 4 digits', () => {
    expect(contactModeOf(null)).toBe('last4');
    expect(contactModeOf({ contact: 'hidden' })).toBe('hidden');
    expect(contactModeOf({ contact: 'everything' })).toBe('last4');
  });
  it('only technicians are masked; owners, managers and the desk see all', () => {
    expect(isTechViewer({ role: 'STAFF', staffRole: 'TECHNICIAN' })).toBe(true);
    expect(isTechViewer({ role: 'STAFF', staffRole: null })).toBe(true);
    expect(isTechViewer({ role: 'STAFF', staffRole: 'RECEPTIONIST' })).toBe(false);
    expect(isTechViewer({ role: 'STAFF', staffRole: 'MANAGER' })).toBe(false);
    expect(isTechViewer({ role: 'SALON_ADMIN' })).toBe(false);
  });
  it('phone: last 4, nothing, or all', () => {
    expect(maskPhone('+1 (403) 991-2832', 'last4')).toBe('••• 2832');
    expect(maskPhone('+14039912832', 'hidden')).toBeNull();
    expect(maskPhone('+14039912832', 'full')).toBe('+14039912832');
    expect(maskPhone(null, 'last4')).toBeNull();
  });
  it('a note keeps its words, loses its numbers and emails', () => {
    expect(maskText('Medium pressure. Running late? text me at 403-991-2832 or jen@mail.com', 'last4'))
      .toBe('Medium pressure. Running late? text me at ••• 2832 or (email hidden)');
    expect(maskText('call 403 991 2832', 'hidden')).toBe('call (phone hidden)');
    expect(maskText('French tips, 2 coats, size 10', 'hidden')).toBe('French tips, 2 coats, size 10');
  });
  it('deep in a response: booking.customer, a ticket, a list', () => {
    const at = new Date('2026-10-27T10:00:00Z');
    const r = redactContacts([{ id: 'a', startTime: at, notes: 'gate code 4411', customer: { firstName: 'Jennifer', phone: '+14039912832', email: 'jen@mail.com' } }, { phone: '4039912832', customerName: 'Walk-in' }], 'last4');
    expect(r[0].customer).toEqual({ firstName: 'Jennifer', phone: '••• 2832', email: null });
    expect(r[0].startTime).toBe(at);
    expect(r[0].notes).toBe('gate code 4411');
    expect(r[1].phone).toBe('••• 2832');
  });
  it('"full" returns the response untouched', () => {
    const o = { phone: '+14039912832', email: 'a@b.co' };
    expect(redactContacts(o, 'full')).toBe(o);
  });
});
