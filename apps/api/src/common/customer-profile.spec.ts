/**
 * Phase 3: a customer's habits, read from her finished visits — and the bot
 * offering "same as last time?" from them.
 */
import { habitLine, profileFrom } from './customer-profile';
import { customerDossier } from '../messenger/lead-memory';
import { readFileSync } from 'fs';
import { join } from 'path';

const LA = 'America/Los_Angeles';
// Saturdays 10:00 AM LA (17:00Z), with Ivy, gel manicure; one Tuesday evening pedicure with Kim.
const visits = [
  { at: new Date('2026-09-26T17:00:00Z'), services: ['Gel Manicure'], staff: 'Ivy', priceCents: 4500 },
  { at: new Date('2026-09-12T17:00:00Z'), services: ['Gel Manicure', 'Nail Art'], staff: 'Ivy', priceCents: 5500 },
  { at: new Date('2026-08-29T17:30:00Z'), services: ['Gel Manicure'], staff: 'Ivy', priceCents: 4500 },
  { at: new Date('2026-08-12T02:00:00Z'), services: ['Pedicure'], staff: 'Kim', priceCents: 3500 },
];

describe('her habits', () => {
  const p = profileFrom(visits, LA);
  it('favourite services, usual technician, usual day and time of day', () => {
    expect(p.visits).toBe(4);
    expect(p.favourites[0]).toEqual({ name: 'Gel Manicure', count: 3 });
    expect(p.preferredStaff).toEqual({ name: 'Ivy', count: 3 });
    expect(p.usualWeekday).toBe(6); // Saturday, in the SALON's timezone
    expect(p.usualPart).toBe('morning');
    expect(p.avgSpendCents).toBe(4500);
    expect(p.lastServices).toEqual(['Gel Manicure']);
    expect(p.lastStaff).toBe('Ivy');
  });
  it('one visit, or no clear pattern, is not a habit', () => {
    const one = profileFrom([visits[0]], LA);
    expect(one.preferredStaff).toBeNull();
    expect(one.usualWeekday).toBeNull();
    expect(habitLine(one, true)).toBe('');
    const mixed = profileFrom([{ ...visits[0], staff: 'A' }, { ...visits[1], staff: 'B' }, { ...visits[2], staff: 'C' }], LA);
    expect(mixed.preferredStaff).toBeNull();
  });
  it('reads as one line for the bot and the desk', () => {
    expect(habitLine(p, true)).toBe('Gel Manicure · with Ivy · Saturday mornings');
    expect(habitLine(p, false)).toBe('Gel Manicure · thợ Ivy · thứ Bảy buổi sáng');
  });
});

describe('the bot uses it', () => {
  it('the dossier carries the habit and the "same as last time?" offer', () => {
    const d = customerDossier({ firstName: 'Anna', phone: '512', usual: 'Gel Manicure · with Ivy · Saturday mornings', lastTime: 'Gel Manicure with Ivy', visits: 4 }, 'en');
    expect(d).toMatch(/- Usual: Gel Manicure · with Ivy · Saturday mornings/);
    expect(d).toMatch(/"Same as last time — Gel Manicure with Ivy\?"/);
    expect(customerDossier({ firstName: 'Anna' }, 'en')).not.toMatch(/Same as last time/);
  });
  it('the bot and the customer page read THIS salon’s visits only', () => {
    const m = readFileSync(join(__dirname, '..', 'messenger', 'messenger.service.ts'), 'utf8');
    expect(m).toMatch(/where: \{ tenantId, customerId: c\.id, status: \{ in: \['COMPLETED'\] as never \} \},\s*orderBy: \{ startTime: 'desc' \}, take: 30/);
    const c = readFileSync(join(__dirname, '..', 'customers', 'customers.service.ts'), 'utf8');
    expect(c).toMatch(/profile = profileFrom\(/);
  });
});
