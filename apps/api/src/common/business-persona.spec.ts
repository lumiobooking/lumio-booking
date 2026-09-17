import { personaFor, ALL_PERSONAS, TRADE_PERSONA_KEYS } from './business-persona';

// The bug this file exists to stop: a business that is not a nail salon being
// introduced to a real customer as one, or offered the wrong thing entirely.
describe('personaFor — the coarse business type', () => {
  it('keeps every existing tenant byte-identical: unknown and empty are SALON', () => {
    expect(personaFor(undefined).identity).toBe('a nail salon');
    expect(personaFor(null).identity).toBe('a nail salon');
    expect(personaFor('').identity).toBe('a nail salon');
    expect(personaFor('WHATEVER').identity).toBe('a nail salon');
  });

  it('answers each type in its own words', () => {
    expect(personaFor('RESTAURANT').identity).toBe('a restaurant');
    expect(personaFor('REAL_ESTATE').bookableNoun).toBe('consultation');
    expect(personaFor('SERVICE').venueNoun).toBe('business');
  });
});

describe('personaFor — a declared trade refines it', () => {
  it('a café is not asked to take a table reservation', () => {
    const p = personaFor('RESTAURANT', 'CAFE');
    expect(p.identity).toBe('a coffee shop');
    expect(p.venueNoun).toBe('café');
    // The whole point: answer first, and do not offer a reservation reflexively.
    expect(p.voiceGoal).toMatch(/ANSWER/);
    expect(p.voiceGoal).not.toMatch(/Goal: take a table reservation/);
  });

  it('a bakery books an ORDER with a pickup time, not an appointment', () => {
    const p = personaFor('RESTAURANT', 'BAKERY');
    expect(p.identity).toBe('a bakery');
    expect(p.bookableNoun).toBe('order');
    expect(p.voiceGoal).toMatch(/collect it|pickup/i);
  });

  it('bubble tea and takeaway keep their own words', () => {
    expect(personaFor('RESTAURANT', 'BUBBLE_TEA').identity).toBe('a bubble tea shop');
    expect(personaFor('RESTAURANT', 'FAST_FOOD').identity).toBe('a takeaway restaurant');
  });

  it('a beauty trade adds nothing — the salon persona is already right', () => {
    const base = personaFor('SALON');
    for (const t of ['NAIL', 'HAIR', 'LASH', 'BROW', 'SPA', 'MASSAGE', 'PMU']) {
      expect(personaFor('SALON', t)).toEqual(base);
    }
  });

  it('an unknown or blank trade never invents a persona', () => {
    expect(personaFor('SALON', 'NOT_A_TRADE')).toEqual(personaFor('SALON'));
    expect(personaFor('RESTAURANT', '')).toEqual(personaFor('RESTAURANT'));
    expect(personaFor('RESTAURANT', null)).toEqual(personaFor('RESTAURANT'));
  });

  it('keeps the business type key even when the trade renames everything else', () => {
    // The key is what the rest of the system routes on; a café is still a
    // RESTAURANT to the database and must stay one here.
    expect(personaFor('RESTAURANT', 'CAFE').key).toBe('RESTAURANT');
  });

  it('a trade persona cannot refine a type into nonsense', () => {
    // Someone declaring CAFE on a real-estate tenant gets the café words —
    // that is their declaration — but never a broken half-object.
    const p = personaFor('REAL_ESTATE', 'CAFE');
    expect(p.key).toBe('REAL_ESTATE');
    expect(p.identity).toBeTruthy();
    expect(p.voiceGoal).toBeTruthy();
    expect(p.bookableNoun).toBeTruthy();
    expect(p.venueNoun).toBeTruthy();
  });
});

describe('every persona is complete', () => {
  it('no base persona has an empty field', () => {
    for (const p of ALL_PERSONAS) {
      for (const f of ['identity', 'voiceGoal', 'bookableNoun', 'venueNoun', 'labelEn', 'labelVi'] as const) {
        expect(String(p[f] ?? '').trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every trade persona fills every field it is asked for', () => {
    for (const t of TRADE_PERSONA_KEYS) {
      const p = personaFor('RESTAURANT', t);
      for (const f of ['identity', 'voiceGoal', 'bookableNoun', 'venueNoun', 'labelEn', 'labelVi'] as const) {
        expect(String(p[f] ?? '').trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('no persona tells a non-salon business it is a nail salon', () => {
    for (const t of TRADE_PERSONA_KEYS) {
      expect(personaFor('RESTAURANT', t).identity).not.toMatch(/nail/i);
    }
    expect(personaFor('RESTAURANT').identity).not.toMatch(/nail/i);
    expect(personaFor('REAL_ESTATE').identity).not.toMatch(/nail/i);
  });
});
