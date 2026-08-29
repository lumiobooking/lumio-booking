import { ALL_PERSONAS, personaFor } from './business-persona';

describe('who the AI is, per line of business', () => {
  it('a real-estate tenant gets a real-estate receptionist — never a manicure script', () => {
    const p = personaFor('REAL_ESTATE');
    expect(p.identity).toBe('a real estate team');
    expect(p.voiceGoal).toContain('capture the lead');
    expect(p.voiceGoal).not.toMatch(/service they want/);
    expect(p.bookableNoun).toBe('consultation');
  });

  it('real estate never quotes prices or valuations on the phone', () => {
    // A wrong number read aloud on a call is a liability, not a convenience.
    expect(personaFor('REAL_ESTATE').voiceGoal).toContain('Never quote prices');
  });

  it('a restaurant books tables, and asks for party size', () => {
    const p = personaFor('RESTAURANT');
    expect(p.identity).toBe('a restaurant');
    expect(p.voiceGoal).toContain('party size');
    expect(p.bookableNoun).toBe('reservation');
  });

  it('legacy and unknown values fall back to the original salon persona', () => {
    // Existing tenants must keep byte-identical prompts after this change.
    for (const v of ['SALON', '', null, undefined, 'salon', 'WAREHOUSE']) {
      const p = personaFor(v as never);
      expect(p.identity).toBe('a nail salon');
      expect(p.venueNoun).toBe('salon');
    }
  });

  it('case-insensitive on the way in — enum casing is not a trap', () => {
    expect(personaFor('real_estate').key).toBe('REAL_ESTATE');
  });

  it('every persona answers all three questions', () => {
    for (const p of ALL_PERSONAS) {
      expect(p.identity.length).toBeGreaterThan(3);
      expect(p.voiceGoal).toContain('Goal:');
      expect(p.bookableNoun).toBeTruthy();
      expect(p.venueNoun).toBeTruthy();
      expect(p.labelVi).toBeTruthy();
    }
  });
});
