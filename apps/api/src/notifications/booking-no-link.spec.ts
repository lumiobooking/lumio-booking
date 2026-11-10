import { customerBookingSms } from './booking-sms';
import { smsSegments, toGsm7 } from './sms-text';
import { renderBookingEmailHtml, renderBookingEmailText, changeLine, type BookingTemplateData } from './email-template';

/**
 * "khách đang cancel nhiều … xác nhận booking qua email và sms không có mục
 * cancel. chỉ thông báo booking thành công và có đầy đủ thông tin tên tiệm địa
 * chỉ service thợ và ngày giờ" (10/11/2026). No link unless the salon turns it on.
 */
const seg = (t: string) => smsSegments(toGsm7(t));
const one = [{ name: 'Jessica', services: ['Gel Manicure + Pedicure Deluxe'] }];

describe('confirmation without the view / change / cancel link', () => {
  it('US SMS: booked, date/time, service, tech, address, call to change — no link, ≤ 2 segments', () => {
    const t = customerBookingSms({ salon: 'Lux Nail Spa', dateShort: 'Sat Nov 21', timeStart: '10:00 AM', people: one, tech: 'Tiffany', address: '1234 Main St, Houston, TX', phone: '(713) 555-0142' });
    expect(t).toContain("You're booked!");
    expect(t).toContain('Sat Nov 21, 10:00 AM');
    expect(t).toContain('Gel Manicure + Pedicure Deluxe');
    expect(t).toContain('Tiffany');
    expect(t).toContain('1234 Main St');
    expect(t).toContain('Call (713) 555-0142 to change');
    expect(t).not.toMatch(/https?:|Manage|cancel/i);
    expect(seg(t).segments).toBeLessThanOrEqual(2);
  });
  it('VN SMS: "Dat lich thanh cong", address and the number to call', () => {
    const t = customerBookingSms({ salon: 'Lux Nail Spa', dateShort: 'T7 21/11', timeStart: '10:00', people: one, tech: 'Tiffany', address: '12 Le Loi, Q1, HCM', phone: '0901 234 567', vi: true });
    expect(t).toContain('Dat lich thanh cong!');
    expect(t).toContain('12 Le Loi');
    expect(t).toContain('Doi lich goi 0901 234 567');
    expect(t).not.toMatch(/https?:|huy/i);
  });
  it('a very long address / services still fits 2 segments and keeps no link', () => {
    const big = [{ name: 'A', services: ['Signature Deluxe Spa Pedicure With Hot Stone Massage And Paraffin Wax'] }, { name: 'B', services: ['Gel X Full Set With Chrome And Hand Painted Nail Art Design'] }];
    const t = customerBookingSms({ salon: 'MT. HAWTHORN NAIL SPA & BEAUTY LOUNGE', dateShort: 'Sun Dec 6', timeStart: '6:00 PM', people: big, address: '98765 Very Long Boulevard Name, Building C, Suite 1200, Some Long City Name, TX 77002', phone: '(713) 555-0142' });
    expect(seg(t).segments).toBeLessThanOrEqual(2);
    expect(t).not.toMatch(/https?:/);
  });
  it('with the link turned on, the old message is unchanged', () => {
    const t = customerBookingSms({ salon: 'Lux', dateShort: 'Sat Nov 21', timeStart: '10:00 AM', people: one, link: 'https://lumiobooking.com/a/x' });
    expect(t).toContain('Manage: https://lumiobooking.com/a/x');
  });

  const d = {
    audience: 'customer', salon: 'Lux Nail Spa', customer: 'Jessica', service: 'Gel Manicure', date: 'Sat, Nov 21', time: '10:00 AM',
    staff: 'Tiffany', address: '1234 Main St', contact: '(713) 555-0142', salonPhone: '(713) 555-0142', accent: '#6366f1',
  } as unknown as BookingTemplateData;
  it('email: no manage button, "please call" line with the salon number', () => {
    const html = renderBookingEmailHtml({ heading: "You're booked!", intro: 'Hi Jessica', footer: '', d, audience: 'customer', lang: 'en' });
    const text = renderBookingEmailText("You're booked!", 'Hi Jessica', '', d, null, 'customer', 'en');
    expect(html).not.toMatch(/Manage|cancel/i);
    expect(html).toContain(changeLine('en', '(713) 555-0142'));
    expect(text).toContain('(713) 555-0142');
    expect(text).not.toMatch(/cancel/i);
  });
  it('change line in Vietnamese', () => {
    expect(changeLine('vi', '0901 234 567')).toContain('Vui lòng gọi tiệm: 0901 234 567');
  });
});
