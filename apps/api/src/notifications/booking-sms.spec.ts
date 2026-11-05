import { customerBookingSms, ownerBookingSms, servicesSummary } from './booking-sms';
import { smsSegments, toGsm7 } from './sms-text';
import { renderBookingEmailHtml, renderBookingEmailText, bookingRowValues, type BookingTemplateData } from './email-template';

/**
 * "Thông báo phải về đầy đủ thông tin khách đặt (số người, dịch vụ). Email đẹp,
 * gọn, dễ nhìn. SMS đủ thông tin nhưng không rườm rà, không tốn phí" (4 Nov 2026).
 */
const link = 'https://lumiobooking.com/a/AbCdEfGhIjKlMnOpQrStUv01234567890';
const party = [
  { name: 'Rinata', services: ['Manicure & Pedicure Deluxe'] },
  { name: 'Guest 2', services: ['Manicure & Pedicure Deluxe'] },
  { name: 'Guest 3', services: ['Manicure & Pedicure Deluxe'] },
  { name: 'Guest 4', services: ['Gel X Full Set'] },
  { name: 'Guest 5', services: ['Manicure & Pedicure Deluxe'] },
];
const seg = (t: string) => smsSegments(toGsm7(t));

describe('the booking text: complete, short, cheap', () => {
  it('a party of five: how many, every service with its count, total and link — GSM-7, at most 2 segments', () => {
    const t = customerBookingSms({ salon: 'MT. HAWTHORN NAIL SPA', dateShort: 'Sun, Dec 6', timeStart: '6:00 PM', people: party, total: '$250.00', link });
    expect(t).toContain('5 people');
    expect(t).toContain('Manicure & Pedicure Deluxe x4');
    expect(t).toContain('Gel X Full Set');
    expect(t).toContain('$250.00');
    expect(t).toContain(link);
    expect(seg(t)).toMatchObject({ encoding: 'GSM-7' });
    expect(seg(t).segments).toBeLessThanOrEqual(2);
  });
  it('a single visit fits ONE segment, dropping the extras before the facts', () => {
    const t = customerBookingSms({ salon: 'Lumio Nails', dateShort: 'Sat, Jun 20', timeStart: '2:00 PM', people: [{ services: ['Gel Manicure', 'Nail Design'] }], tech: 'Anna Tran', total: '$76.05', link });
    expect(seg(t).segments).toBe(1);
    expect(t).toMatch(/Sat, Jun 20, 2:00 PM/);
    expect(t).toContain('Gel Manicure, Nail Design');
    expect(t).toContain(link);
  });
  it('never more than two segments, however long the menu names are', () => {
    const long = Array.from({ length: 8 }, (_, i) => ({ services: [`Signature Deluxe Spa Pedicure With Hot Stone Massage ${i}`] }));
    const t = customerBookingSms({ salon: 'A Very Long Salon Name Nail Lounge & Spa', dateShort: 'Wed, Dec 30', timeStart: '11:30 AM', people: long, total: '$1,240.00', link });
    expect(seg(t).segments).toBeLessThanOrEqual(2);
    expect(t).toContain('8 people');
  });
  it('the owner\'s text: who (+ how many), phone, when, what, total — one segment', () => {
    const t = ownerBookingSms({ salon: 'x', dateShort: 'Sun, Dec 6', timeStart: '6:00 PM', people: party, total: '$250.00', customer: 'Rinata', customerPhone: '+61412345678' });
    expect(t).toBe('New booking: Rinata +4 +61412345678 - Sun, Dec 6 6:00 PM (5 ppl): Manicure & Pedicure Deluxe x4, Gel X Full Set - $250.00');
    expect(seg(t).segments).toBe(1);
  });
  it('Vietnamese wording without accents (GSM-7), so a text is not billed at the 70-character rate', () => {
    const t = customerBookingSms({ salon: 'Tiệm Nail Hoa', dateShort: 'CN, 6 thg 12', timeStart: '18:00', people: party, total: '250.000 đ', link, vi: true });
    expect(t).toContain('5 nguoi');
    expect(seg(t).encoding).toBe('GSM-7');
  });
  it('each service once, with how many people are having it', () => {
    expect(servicesSummary(party)).toBe('Manicure & Pedicure Deluxe x4, Gel X Full Set');
  });
});

describe('the booking email: person by person, nothing said twice', () => {
  const d: BookingTemplateData = {
    salon: 'MT. HAWTHORN NAIL SPA', customer: 'Rinata', service: 'Group of 3 · Mani, Gel X', date: 'Sun, December 6, 2026', time: '6:00 PM',
    technician: 'Lisa', total: '$150.00', duration: '', addons: '', addonsOnly: '', accent: '#c026d3', contact: 'shop@example.com',
    reference: 'A82C3F', address: '128 Flinders St', manageUrl: 'https://lumiobooking.com/appt/x', dateShort: 'Sun, Dec 6', timeStart: '6:00 PM',
    people: [
      { name: 'Rinata', lines: [{ service: 'Mani & Pedi', tech: 'Lisa' }], addons: 'French tip' },
      { name: 'Mai', lines: [{ service: 'Gel X', tech: 'Kim' }] },
      { name: 'Guest 3', lines: [{ service: 'Mani & Pedi' }] },
    ],
  };
  it('the party size up top and every person with their service and technician', () => {
    const html = renderBookingEmailHtml({ heading: 'Booking confirmed', intro: 'Hi', footer: '', d, lang: 'en' });
    expect(html).toContain('3 people');
    for (const x of ['Rinata', 'Mai', 'Guest 3', 'Mani &amp; Pedi', 'Gel X', 'Kim', 'Lisa', 'French tip', 'to be assigned', '$150.00']) expect(html).toContain(x);
  });
  it('the shared rows do not repeat what the block already shows', () => {
    const labels = bookingRowValues(d, 'customer', 'en').map(([l]) => l);
    expect(labels).not.toContain('Service');
    expect(labels).not.toContain('Technician');
    expect(labels).toEqual(expect.arrayContaining(['Reference', 'Party', 'Total']));
  });
  it('plain-text copy lists everyone too', () => {
    const text = renderBookingEmailText('Booking confirmed', 'Hi', '', d, null, 'owner', 'en');
    expect(text).toContain('- Rinata: Mani & Pedi — Lisa (+ French tip)');
    expect(text).toContain('- Guest 3: Mani & Pedi — to be assigned');
  });
});
