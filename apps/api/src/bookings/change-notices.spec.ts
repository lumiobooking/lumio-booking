import { changeNoticeTargets, changePushText, ownerNoticeText } from './change-notices';

const on = { enabled: true, email: true, sms: true };
const cust = { email: 'anna@x.test', phone: '+15125550100' };
const tech = { email: 'alan@salon.test', phone: '+15125550200' };

describe('who hears about a cancellation or a move', () => {
  it('cancel: customer and technician, email and SMS when each is on', () => {
    const t = changeNoticeTargets({ kind: 'cancelled', market: 'US', customer: cust, customerTpl: on, staff: tech, staffTpl: on });
    expect(t.map((x) => `${x.to}:${x.channel}`)).toEqual(['customer:email', 'customer:sms', 'staff:email', 'staff:sms']);
  });

  it('a template that is off sends nothing; a missing address or number drops that channel only', () => {
    expect(changeNoticeTargets({ kind: 'cancelled', market: 'US', customer: cust, customerTpl: { ...on, enabled: false }, staff: tech, staffTpl: { ...on, enabled: false } })).toEqual([]);
    const t = changeNoticeTargets({ kind: 'cancelled', market: 'US', customer: { email: null, phone: cust.phone }, customerTpl: on, staff: { email: tech.email, phone: null }, staffTpl: on });
    expect(t.map((x) => `${x.to}:${x.channel}`)).toEqual(['customer:sms', 'staff:email']);
  });

  it('a move tells the customer only (the technician gets the push); VN salons get email only', () => {
    expect(changeNoticeTargets({ kind: 'rescheduled', market: 'US', customer: cust, customerTpl: on, staff: tech, staffTpl: on }).map((x) => x.to)).toEqual(['customer', 'customer']);
    expect(changeNoticeTargets({ kind: 'cancelled', market: 'VN', customer: cust, customerTpl: on, staff: tech, staffTpl: on }).map((x) => `${x.to}:${x.channel}`)).toEqual(['customer:email', 'staff:email']);
  });

  it('the salon hears on the channels its new-booking alert uses — email and SMS, each under its own switch', () => {
    const owner = { email: 'owner@salon.test', phone: '+15125550300', emailOn: true, smsOn: true };
    const t = changeNoticeTargets({ kind: 'cancelled', market: 'US', customer: cust, customerTpl: on, staff: null, staffTpl: on, owner });
    expect(t.map((x) => `${x.to}:${x.channel}`)).toEqual(['customer:email', 'customer:sms', 'owner:email', 'owner:sms']);
    // A move reaches the owner too (the technician's note is cancel-only).
    expect(changeNoticeTargets({ kind: 'rescheduled', market: 'US', customer: cust, customerTpl: on, staff: tech, staffTpl: on, owner }).filter((x) => x.to === 'owner')).toHaveLength(2);
    // Switch off = silent; VN = email only; no address = nothing.
    expect(changeNoticeTargets({ kind: 'cancelled', market: 'US', customer: cust, customerTpl: on, staff: null, staffTpl: on, owner: { ...owner, emailOn: false, smsOn: false } }).filter((x) => x.to === 'owner')).toEqual([]);
    expect(changeNoticeTargets({ kind: 'cancelled', market: 'VN', customer: cust, customerTpl: on, staff: null, staffTpl: on, owner }).filter((x) => x.to === 'owner').map((x) => x.channel)).toEqual(['email']);
    expect(changeNoticeTargets({ kind: 'cancelled', market: 'US', customer: cust, customerTpl: on, staff: null, staffTpl: on, owner: { ...owner, email: null } }).filter((x) => x.to === 'owner').map((x) => x.channel)).toEqual(['sms']);
  });

  it('the owner\'s written note says who, what, when and by whom', () => {
    const o = ownerNoticeText({ kind: 'cancelled', vi: true, salon: 'Lumio Salon', customer: 'Anna Lee', phone: '+1 512 555 0100', service: 'Gel', staff: 'Lan', when: 'T5 15/10 14:00', by: 'customer' });
    expect(o.subject).toBe('Lịch bị huỷ — Anna Lee · T5 15/10 14:00');
    expect(o.body).toMatch(/Khách: Anna Lee · \+1 512 555 0100/);
    expect(o.body).toMatch(/Ai thực hiện: Khách tự huỷ/);
    expect(o.sms).toBe('Lumio Salon: Anna Lee • Gel • T5 15/10 14:00 • Khách tự huỷ');
    const m = ownerNoticeText({ kind: 'rescheduled', vi: false, salon: 'Lumio Salon', customer: 'Anna', phone: '', service: 'Gel', staff: 'Lan', when: 'Thu 10/15 4:00 PM', from: 'Thu 10/15 2:00 PM', by: 'staff', byName: 'Lan' });
    expect(m.subject).toMatch(/^Booking moved — Anna/);
    expect(m.body).toMatch(/Was: Thu 10\/15 2:00 PM/);
    expect(m.body).toMatch(/Now: Thu 10\/15 4:00 PM/);
  });

  it('the owner push names who cancelled', () => {
    expect(changePushText({ kind: 'cancelled', vi: true, customer: 'Anna', service: 'Gel', when: 'T5 15/10 14:00', by: 'customer' }).body).toBe('Anna • Gel • T5 15/10 14:00 • Khách tự huỷ');
    expect(changePushText({ kind: 'cancelled', vi: false, customer: 'Anna', service: 'Gel', when: 'Thu 10/15 2:00 PM', by: 'staff', byName: 'Lan' }).body).toMatch(/Cancelled by Lan$/);
    expect(changePushText({ kind: 'rescheduled', vi: true, customer: 'Anna', service: 'Gel', when: '16:00', from: '14:00' }).body).toBe('Anna • Gel • 14:00 → 16:00');
  });
});
