import { readFileSync } from 'fs';
import { join } from 'path';
import { hiddenHrefsFor, iconFor, industryText, INDUSTRY_OPTIONS, isIndustryKey } from './ui-industry';

/**
 * Each line of business reads the salon screens in its own words. A nail
 * salon — every salon on the platform today — must see NOTHING change.
 */
describe('a nail salon sees exactly what it saw before', () => {
  it('no word changes, nothing hidden, no icon swapped', () => {
    for (const s of ['Thợ rảnh 2/2', 'Lịch hẹn', 'Free techs', 'Salon customers', 'Tiệm nail của bạn']) expect(industryText(s, 'NAIL')).toBe(s);
    expect(hiddenHrefsFor('NAIL')).toEqual([]);
    expect(iconFor('nailPolish', 'NAIL')).toBe('nailPolish');
  });
});

describe('every other trade speaks its own language', () => {
  it('a dental clinic: bác sĩ, phòng khám, bệnh nhân, lịch khám', () => {
    expect(industryText('Thợ rảnh 2/2', 'DENTAL')).toBe('Bác sĩ rảnh 2/2');
    expect(industryText('Lượt hôm nay của từng thợ', 'DENTAL')).toBe('Lượt hôm nay của từng bác sĩ');
    expect(industryText('Khách hàng của tiệm', 'DENTAL')).toBe('Bệnh nhân của phòng khám');
    expect(industryText('Lịch hẹn', 'DENTAL')).toBe('Lịch khám');
    expect(industryText('Free techs · salon customers', 'DENTAL')).toBe('Free dentists · clinic patients');
    expect(industryText('Dịch vụ & Thợ', 'DENTAL')).toBe('Dịch vụ & Bác sĩ');
  });

  it('a restaurant and a café: nhân viên, đặt bàn; no chairs or turn board in the menu', () => {
    expect(industryText('Đặt lịch', 'RESTAURANT')).toBe('Đặt bàn');
    expect(industryText('Lịch hẹn', 'CAFE')).toBe('Lịch đặt bàn');
    expect(industryText('Thợ rảnh', 'CAFE')).toBe('Nhân viên rảnh');
    expect(industryText('New appointment', 'RESTAURANT')).toBe('New reservation');
    expect(hiddenHrefsFor('CAFE')).toEqual(expect.arrayContaining(['/salon/walkins', '/salon/stations']));
  });

  it('real estate: môi giới, văn phòng, lịch tư vấn; no retail or floor screens', () => {
    expect(industryText('Thợ', 'REAL_ESTATE')).toBe('Môi giới');
    expect(industryText('Lịch hẹn của tiệm', 'REAL_ESTATE')).toBe('Lịch tư vấn của văn phòng');
    expect(hiddenHrefsFor('REAL_ESTATE')).toEqual(expect.arrayContaining(['/salon/walkins', '/salon/products', '/salon/gift-cards']));
  });

  it('beauty trades keep "thợ" and only swap the nail words', () => {
    expect(industryText('Tiệm nail của bạn', 'LASH')).toBe('Tiệm mi của bạn');
    expect(industryText('Thợ rảnh', 'LASH')).toBe('Thợ rảnh');
    expect(industryText('Free techs', 'HAIR')).toBe('Free stylists');
    expect(industryText('Thợ rảnh · Ghế 3', 'SPA')).toBe('Kỹ thuật viên rảnh · Phòng 3');
  });

  it('whole words only, any case', () => {
    expect(industryText('technology', 'DENTAL')).toBe('technology'); // not "dentistnology"
    expect(industryText('THỢ', 'DENTAL')).toBe('BÁC SĨ');
    expect(industryText('khách khách', 'DENTAL')).toBe('bệnh nhân bệnh nhân');
  });

  it('never rewrites a {placeholder} or the business’s own name', () => {
    expect(industryText('Texts from {salon} about your appointment', 'DENTAL')).toBe('Texts from {salon} about your appointment');
    expect(industryText('Lumio Salon — salon hours', 'DENTAL', ['Lumio Salon'])).toBe('Lumio Salon — clinic hours');
    expect(industryText('Tiệm Lumio Salon', 'DENTAL', ['Lumio Salon'])).toBe('Phòng khám Lumio Salon');
  });

  it('the icon on Services names the trade', () => {
    expect(iconFor('nailPolish', 'DENTAL')).toBe('tooth');
    expect(iconFor('nailPolish', 'HAIR')).toBe('scissors');
    expect(iconFor('calendar', 'DENTAL')).toBe('calendar');
  });
});

describe('the list matches the server and is wired in', () => {
  it('same eleven industries as api common/industry.ts', () => {
    const api = readFileSync(join(__dirname, '..', '..', '..', 'api', 'src', 'common', 'industry.ts'), 'utf8');
    for (const o of INDUSTRY_OPTIONS) {
      expect(api).toContain(`key: '${o.key}', businessType: '${o.businessType}'`);
      expect(isIndustryKey(o.key)).toBe(true);
    }
  });
  it('tr(), the shell menu, the icons and the pages’ own L()/T() all go through it', () => {
    const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
    expect(read('lib', 'i18n.tsx')).toMatch(/return ind\(applyCurrency\(/);
    expect(read('components', 'SalonShell.tsx')).toMatch(/!hiddenHrefsFor\(industry\)\.includes\(item\.href\)/);
    expect(read('components', 'NavIcon.tsx')).toMatch(/iconFor\(name, uiIndustry\(\)\)/);
    expect(read('app', 'salon', 'front-desk', 'page.tsx')).toMatch(/=> ind\(vi \? v : e\)/);
    expect(read('app', 'super-admin', 'tenants', 'page.tsx')).toMatch(/body: \{ industry \}/);
    expect(read('app', 'salon', 'settings', 'page.tsx')).toMatch(/<IndustryPicker \/>/);
    // The customer page too: bt() speaks the salon's trade.
    expect(read('lib', 'i18n-book.ts')).toMatch(/industryText\(out, currentIndustry, currentNames\)/);
    expect(read('app', 'book', '[slug]', 'page.tsx')).toMatch(/setBookIndustry\(salon\?\.industry, salon\?\.name\)/);
  });
});

describe('the customer booking page', () => {
  it('a clinic’s patients read "dentist"; a nail salon’s page is untouched', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const b = require('./i18n-book') as typeof import('./i18n-book');
    b.setBookLang('en');
    b.setBookIndustry('NAIL', 'Zb Nails');
    expect(b.bt('Choose your nail tech')).toBe('Choose your nail tech');
    b.setBookIndustry('DENTAL', 'Smile Salon Dental');
    expect(b.bt('Choose your nail tech')).toBe('Choose your dentist');
    expect(b.bt('Any technician')).toBe('Any dentist');
    b.setBookIndustry('nonsense', null);
    expect(b.bt('Any technician')).toBe('Any technician');
  });
});
