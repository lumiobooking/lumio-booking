/**
 * The salon picks its hotline voice: one per language, only names from the
 * list, and Vietnamese is never read by an English voice.
 */
import { VOICE_CATALOG, cleanVoiceSetting, parseVoices, pickVoice } from './voice-catalog';
import { voiceFor } from './voice-lang';

describe('choosing the hotline voice', () => {
  it('the list covers young to older, both genders, every language, one default each', () => {
    for (const lang of ['en-US', 'en-AU', 'vi-VN'] as const) {
      const vs = VOICE_CATALOG.filter((v) => v.lang === lang);
      expect(vs.filter((v) => v.isDefault)).toHaveLength(1);
      expect(new Set(vs.map((v) => v.gender))).toEqual(new Set(['female', 'male']));
    }
    const us = VOICE_CATALOG.filter((v) => v.lang === 'en-US').map((v) => v.age);
    expect(Math.min(...us)).toBe(1);
    expect(Math.max(...us)).toBe(4);
  });

  it('stores one voice per language and drops anything not on the list', () => {
    expect(cleanVoiceSetting(['Polly.Ruth-Neural', 'Google.vi-VN-Wavenet-B'])).toBe('Polly.Ruth-Neural,Google.vi-VN-Wavenet-B');
    expect(cleanVoiceSetting('Polly.Ruth-Neural,Polly.Ruth-Neural,alice,"><Hangup/>')).toBe('Polly.Ruth-Neural');
    expect(cleanVoiceSetting('polly.gregory-neural')).toBe('Polly.Gregory-Neural');
    expect(cleanVoiceSetting('')).toBeNull();
    expect(cleanVoiceSetting([])).toBeNull();
    expect(parseVoices('Polly.Joey-Neural,Polly.Ruth-Neural').map((v) => v.id)).toEqual(['Polly.Joey-Neural']);
  });

  it('each turn speaks with the pick for its language; Vietnamese only with a Vietnamese voice', () => {
    const both = 'Polly.Gregory-Neural,Google.vi-VN-Wavenet-B';
    expect(pickVoice('en-US', both)).toBe('Polly.Gregory-Neural');
    expect(pickVoice('vi-VN', both)).toBe('Google.vi-VN-Wavenet-B');
    expect(pickVoice('vi-VN', 'Polly.Gregory-Neural')).toBeNull();
    expect(pickVoice('en-AU', 'Polly.Gregory-Neural')).toBe('Polly.Gregory-Neural');
    expect(voiceFor('en-US', both).voice).toBe('Polly.Gregory-Neural');
    expect(voiceFor('vi-VN', both)).toEqual({ voice: 'Google.vi-VN-Wavenet-B', sayLanguage: 'vi-VN' });
    // Nothing chosen: the defaults stay exactly as before.
    expect(voiceFor('en-US', null).voice).toBe('Polly.Joanna-Neural');
    expect(voiceFor('vi-VN', 'Polly.Gregory-Neural').voice).toBe('Google.vi-VN-Wavenet-A');
    expect(voiceFor('en-AU', null).voice).toBe('Polly.Olivia-Neural');
  });
});
