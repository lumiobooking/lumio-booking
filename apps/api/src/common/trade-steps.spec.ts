/**
 * How a booking goes, trade by trade (18/11/2026): said only where it has
 * been released, never to a nail salon, and never with a price or a duration
 * of its own.
 */
import { personaFor, tradeVoiceRule, type VoiceKey } from './business-persona';
import { RELEASE_FEATURES, isUiFeature } from './ai-release';

const persona = personaFor('SALON' as never, null as never);

describe('booking steps per trade', () => {
  it('a nail salon\'s prompt does not change by one character, switched on or not', () => {
    expect(tradeVoiceRule(persona, 'NAIL')).toBe('');
    expect(tradeVoiceRule(persona, 'NAIL', { steps: true })).toBe('');
  });

  it('nothing is added until the behaviour is released', () => {
    for (const v of ['LASH', 'HAIR', 'SPA', 'MASSAGE', 'BEAUTY'] as VoiceKey[]) {
      expect(tradeVoiceRule(persona, v)).not.toContain('HOW A BOOKING GOES');
      expect(tradeVoiceRule(persona, v, { steps: false })).toBe(tradeVoiceRule(persona, v));
    }
  });

  it('released: each trade is told its own first question', () => {
    expect(tradeVoiceRule(persona, 'LASH', { steps: true })).toMatch(/NEW full set or a FILL/);
    expect(tradeVoiceRule(persona, 'LASH', { steps: true })).toMatch(/Brows are separate services/);
    expect(tradeVoiceRule(persona, 'HAIR', { steps: true })).toMatch(/what the hair is like NOW/);
    expect(tradeVoiceRule(persona, 'SPA', { steps: true })).toMatch(/two therapists free together/);
    expect(tradeVoiceRule(persona, 'MASSAGE', { steps: true })).toMatch(/two therapists free together/);
    // Trades with their own rule already keep it and get nothing new.
    expect(tradeVoiceRule(persona, 'RESTAURANT', { steps: true })).toBe(tradeVoiceRule(persona, 'RESTAURANT'));
    expect(tradeVoiceRule(persona, 'DENTAL', { steps: true })).toBe(tradeVoiceRule(persona, 'DENTAL'));
  });

  it('says nothing a business\'s own menu must say: no price, no minutes, no weeks', () => {
    for (const v of ['LASH', 'HAIR', 'SPA', 'MASSAGE', 'BEAUTY'] as VoiceKey[]) {
      const added = tradeVoiceRule(persona, v, { steps: true }).split('HOW A BOOKING GOES IN THIS TRADE:')[1];
      expect(added).toBeTruthy();
      expect(added).not.toMatch(/\$\s?\d|\d+\s?(min|minutes|phút|weeks?|tuần|days?|hours?)/i);
    }
  });

  it('ships to the test accounts first and is held by the golden run', () => {
    expect(RELEASE_FEATURES.tradeSteps.ships).toBe('canary');
    expect(isUiFeature('tradeSteps')).toBe(false);
  });
});
