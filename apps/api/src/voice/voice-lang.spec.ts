import { agentLangRule, cannedLines, effectiveLang, isBilingual, menuLines, parseLangChoice, voiceFor } from './voice-lang';

describe('which language a turn runs in', () => {
  it('monolingual lines ignore the call — nothing changes for existing tenants', () => {
    expect(effectiveLang('en-US', null)).toBe('en-US');
    expect(effectiveLang('vi-VN', 'en-US')).toBe('vi-VN');
    expect(effectiveLang(null, null)).toBe('en-US');
  });
  it('bilingual lines follow the caller’s menu choice', () => {
    expect(effectiveLang('bilingual', 'vi-VN')).toBe('vi-VN');
    expect(effectiveLang('bilingual', 'en-US')).toBe('en-US');
  });
  it('bilingual with no choice yet → English, never a crash', () => {
    expect(effectiveLang('bilingual', null)).toBe('en-US');
    expect(effectiveLang('bilingual', 'garbage')).toBe('en-US');
  });
  it('isBilingual is case-tolerant and null-safe', () => {
    expect(isBilingual('bilingual')).toBe(true);
    expect(isBilingual('Bilingual')).toBe(true);
    expect(isBilingual('vi-VN')).toBe(false);
    expect(isBilingual(null)).toBe(false);
  });
});

describe('reading the menu answer', () => {
  it('digits are authoritative: 1 → English, 2 → Vietnamese', () => {
    expect(parseLangChoice('1', null)).toBe('en-US');
    expect(parseLangChoice('2', null)).toBe('vi-VN');
  });
  it('speech works as a courtesy — even mangled by en-US recognition', () => {
    expect(parseLangChoice('', 'Vietnamese please')).toBe('vi-VN');
    expect(parseLangChoice('', 'viet')).toBe('vi-VN');
    expect(parseLangChoice('', 'English')).toBe('en-US');
  });

  it('saying the digit counts too — "two"/"hai" happen more than keypresses', () => {
    expect(parseLangChoice('', 'two')).toBe('vi-VN');
    expect(parseLangChoice('', 'hai')).toBe('vi-VN');
    expect(parseLangChoice('', 'one')).toBe('en-US');
    // a plain greeting must NOT flip the language
    expect(parseLangChoice('', 'hi')).toBeNull();
  });
  it('anything else is "no answer", so the menu can repeat once', () => {
    expect(parseLangChoice('5', '')).toBeNull();
    expect(parseLangChoice('', 'uhh')).toBeNull();
    expect(parseLangChoice(null, null)).toBeNull();
  });
});

describe('what the caller hears', () => {
  it('the menu speaks each half in its own language and discloses the assistant', () => {
    const m = menuLines('Family Smart Homes');
    expect(m.en).toContain('Family Smart Homes');
    expect(m.en).toContain('press 1');
    expect(m.en).toMatch(/automated/);
    expect(m.vi).toContain('nhấn phím 2');
  });
  it('Vietnamese canned lines exist for every situation the English ones cover', () => {
    const vi = cannedLines('vi-VN'); const en = cannedLines('en-US');
    for (const k of ['didntCatch', 'lostYou', 'trouble', 'defaultGreeting', 'slowRetry'] as const) {
      expect(vi[k]).toBeTruthy();
      expect(vi[k]).not.toBe(en[k]);
    }
    expect(vi.disclosure('Tiệm A')).toContain('Tiệm A');
    expect(vi.disclosure('Tiệm A')).toContain('trợ lý tự động');
  });
  it('English canned lines keep today’s exact wording — zero drift for live lines', () => {
    const en = cannedLines('en-US');
    expect(en.didntCatch).toBe("Sorry, I didn't catch that. How can I help you book?");
    expect(en.lostYou).toBe('It looks like I lost you. Please call back any time to book. Goodbye!');
  });
});

describe('the mouth matches the language', () => {
  it('Vietnamese gets a REAL neural Vietnamese voice — alice has no vi-VN and read it as English noise', () => {
    expect(voiceFor('vi-VN', null)).toEqual({ voice: 'Google.vi-VN-Wavenet-A', sayLanguage: 'vi-VN' });
  });
  it('a configured voice wins only for languages it can speak', () => {
    // English Polly on an English turn: respected.
    expect(voiceFor('en-US', 'Polly.Joanna')).toEqual({ voice: 'Polly.Joanna', sayLanguage: null });
    // English Polly on a VIETNAMESE turn: overridden — it cannot speak it.
    expect(voiceFor('vi-VN', 'Polly.Joanna')).toEqual({ voice: 'Google.vi-VN-Wavenet-A', sayLanguage: 'vi-VN' });
    // A Vietnamese-capable configured voice is respected.
    expect(voiceFor('vi-VN', 'Google.vi-VN-Wavenet-D')).toEqual({ voice: 'Google.vi-VN-Wavenet-D', sayLanguage: null });
  });
  it('English default is neural too — the robotic Twilio default is retired', () => {
    expect(voiceFor('en-US', null)).toEqual({ voice: 'Polly.Joanna-Neural', sayLanguage: null });
  });
});

describe('the brain matches the mouth', () => {
  it('tells the agent which language the call is in', () => {
    expect(agentLangRule('vi-VN')).toContain('VIETNAMESE');
    expect(agentLangRule('vi-VN')).toContain('anh/chị');
    expect(agentLangRule('en-US')).toContain('ENGLISH');
  });
});
