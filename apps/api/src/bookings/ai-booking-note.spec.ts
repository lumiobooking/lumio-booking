import { aiBookingNote, noteLangForMarket } from './ai-booking-note';

describe('the note an AI booking carries', () => {
  it('says the channel, the phone, the technician asked for, the group and the request', () => {
    const n = aiBookingNote({ channel: 'hotline', lang: 'vi', phone: '+15125550101', techName: 'Kim', partyNames: ['Anna', 'Lisa', 'Mai'], request: '  no acrylic   smell ' });
    expect(n).toBe('☎️ AI Hotline · 📞 +15125550101 · Thợ yêu cầu: Kim · Nhóm 3: Anna, Lisa, Mai\nKhách dặn: "no acrylic smell"');
  });
  it('one person, nothing special: one short line', () => {
    expect(aiBookingNote({ channel: 'messenger', lang: 'en', phone: '5125550101', partyNames: ['Anna'] })).toBe('💬 AI Messenger · 📞 5125550101');
  });
  it('lists the services only when there is more than one', () => {
    expect(aiBookingNote({ channel: 'web', lang: 'en', services: ['Gel Manicure', 'Pedicure'] })).toContain('Services: Gel Manicure + Pedicure');
    expect(aiBookingNote({ channel: 'web', lang: 'en', services: ['Gel Manicure'] })).not.toContain('Services');
  });
  it('a request is capped so a monologue cannot swallow the calendar card', () => {
    expect(aiBookingNote({ channel: 'zalo', lang: 'vi', request: 'x'.repeat(500) }).length).toBeLessThan(360);
  });
  it('Vietnamese salons read Vietnamese; everyone else English', () => {
    expect(noteLangForMarket('VN')).toBe('vi');
    expect(noteLangForMarket('US')).toBe('en');
    expect(noteLangForMarket(null)).toBe('en');
  });
});
