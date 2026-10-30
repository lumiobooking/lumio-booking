import { readFileSync } from 'fs';
import { join } from 'path';
import { wantsOff } from './no-autofill';

/** No name suggestions in text boxes — but sign-in and passwords keep working. */
const el = (tagName: string, attrs: Record<string, string> = {}) => ({ tagName, getAttribute: (n: string) => attrs[n] ?? null });

describe('which boxes get autocomplete="off"', () => {
  it('every text box, textarea, phone and email box with no wish of its own', () => {
    expect(wantsOff(el('INPUT'))).toBe(true);
    expect(wantsOff(el('INPUT', { type: 'tel' }))).toBe(true);
    expect(wantsOff(el('INPUT', { type: 'email' }))).toBe(true);
    expect(wantsOff(el('INPUT', { type: 'search' }))).toBe(true);
    expect(wantsOff(el('TEXTAREA'))).toBe(true);
  });
  it('a box that asked for name suggestions loses them too', () => {
    expect(wantsOff(el('INPUT', { autocomplete: 'given-name' }))).toBe(true);
    expect(wantsOff(el('INPUT', { autocomplete: 'name' }))).toBe(true);
  });
  it('sign-in and password boxes are left alone (password managers)', () => {
    expect(wantsOff(el('INPUT', { autocomplete: 'username' }))).toBe(false);
    expect(wantsOff(el('INPUT', { type: 'password' }))).toBe(false);
    expect(wantsOff(el('INPUT', { autocomplete: 'new-password' }))).toBe(false);
    expect(wantsOff(el('INPUT', { autocomplete: 'one-time-code' }))).toBe(false);
  });
  it('checkboxes, buttons, files and already-off boxes are untouched', () => {
    for (const type of ['checkbox', 'radio', 'file', 'submit', 'hidden']) expect(wantsOff(el('INPUT', { type }))).toBe(false);
    expect(wantsOff(el('INPUT', { autocomplete: 'off' }))).toBe(false);
    expect(wantsOff(el('SELECT'))).toBe(false);
  });
});

describe('wired in', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
  it('the root layout mounts it once, for every screen', () => {
    expect(read('app', 'layout.tsx')).toMatch(/<NoAutofill \/>/);
  });
  it('the booking page no longer asks the browser for names, phone or email', () => {
    const src = read('app', 'book', '[slug]', 'page.tsx');
    expect(src).not.toMatch(/autoComplete="(given-name|family-name|tel|email|street-address)"/);
    expect(src).toMatch(/name="lb-first" autoComplete="off"/);
  });
});
