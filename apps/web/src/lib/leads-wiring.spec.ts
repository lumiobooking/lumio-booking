import { readFileSync } from 'fs';
import { join } from 'path';

/** "Hỏi nhưng chưa đặt" and the TikTok post count, wired where people look. */
const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('asked but not booked', () => {
  it('the list is on Customers (desk) and Marketing (owner), with the 5th programme card', () => {
    expect(read('app', 'salon', 'customers', 'page.tsx')).toMatch(/<AskedNotBookedBox compact \/>/);
    const mk = read('app', 'salon', 'marketing', 'page.tsx');
    expect(mk).toMatch(/<AskedNotBookedBox compact \/>/);
    expect(mk).toMatch(/campKey="askedNotBooked"/);
  });
  it('"Trả lời ngay" opens that very conversation in the inbox', () => {
    expect(read('components', 'AskedNotBookedBox.tsx')).toMatch(/\/salon\/inbox\?thread=\$\{encodeURIComponent\(r\.refId\)\}/);
    expect(read('components', 'InboxView.tsx')).toMatch(/get\('thread'\)/);
  });
  it('the box says why a chat past 24h cannot be answered', () => {
    expect(read('components', 'AskedNotBookedBox.tsx')).toMatch(/!r\.canMessage/);
  });
});

describe('TikTok posts in the monthly report', () => {
  it('labels a count that came from Lumio’s own publish log', () => {
    expect(read('app', 'salon', 'marketing', 'monthly', 'page.tsx')).toMatch(/postsSource === 'lumio'/);
  });
});

describe('the record each line of business keeps', () => {
  it('the customer page shows it, fields from the server', () => {
    expect(read('app', 'salon', 'customers', '[id]', 'page.tsx')).toMatch(/<IndustryRecordCard token=\{token\} customerId=\{c\.id\}/);
    expect(read('components', 'IndustryRecordCard.tsx')).toMatch(/\/customers\/industry-fields/);
  });
  it('a real-estate office gets a lead pipeline with the same stages as the server', () => {
    const page = read('app', 'salon', 'customers', 'page.tsx');
    expect(page).toMatch(/const isLeads = uiIndustry\(\) === 'REAL_ESTATE'/);
    const api = readFileSync(join(__dirname, '..', '..', '..', 'api', 'src', 'common', 'industry-fields.ts'), 'utf8');
    for (const v of ['new', 'contacted', 'viewing', 'negotiating', 'won', 'lost']) {
      expect(page).toContain(`v: '${v}'`);
      expect(api).toContain(`opt('${v}'`);
    }
  });
  it('the bot report and the customer habits are on screen', () => {
    expect(read('app', 'salon', 'messenger', 'page.tsx')).toMatch(/<BotReportBox token=\{token\}/);
    expect(read('app', 'salon', 'customers', '[id]', 'page.tsx')).toMatch(/c\.profile && c\.profile\.visits >= 2/);
  });
});
