import { THEME_BOOT_SCRIPT } from './theme-boot';

function boot(stored: string | null | 'throw') {
  const dataset: Record<string, string> = {};
  const localStorage = { getItem: () => { if (stored === 'throw') throw new Error('private'); return stored; } };
  new Function('document', 'localStorage', THEME_BOOT_SCRIPT)({ documentElement: { dataset } }, localStorage);
  return dataset.theme ?? 'dark';
}

describe('rt249 light by default, dark only when chosen', () => {
  it('a first visit is light', () => expect(boot(null)).toBe('light'));
  it('someone who chose light stays light', () => expect(boot('light')).toBe('light'));
  it('someone who chose dark stays dark', () => expect(boot('dark')).toBe('dark'));
  it('private mode (storage blocked) is light', () => expect(boot('throw')).toBe('light'));
});
