import { kindFromMenu, personaFor, personaWithMenu, tradeVoiceRule, voiceKeyFor, venueViFor } from './business-persona';
import { scenarioTurns, SCENARIOS } from '../ai-brain/simulations';

const NAIL_MENU = ['Gel Manicure', 'Deluxe Pedicure', 'Acrylic Full Set', 'Eyebrow Wax'];
const HAIR_MENU = ['Women haircut', 'Men haircut', 'Balayage', 'Blow dry'];

describe('the trade\'s own voice', () => {
  it('a nail salon keeps its prompt unchanged: no rule, same persona', () => {
    for (const menu of [NAIL_MENU, [], ['Wax'], null]) {
      const { persona, voice } = personaWithMenu('SALON', null, null, menu);
      expect(voice).toBe('NAIL');
      expect(persona).toEqual(personaFor('SALON', null, null));
      expect(tradeVoiceRule(persona, voice)).toBe('');
    }
    // unknown / legacy business type, and an owner who chose Nail, stay nail salons
    expect(voiceKeyFor(null, null, null, NAIL_MENU)).toBe('NAIL');
    expect(voiceKeyFor('SALON', null, 'NAIL', HAIR_MENU)).toBe('NAIL');
  });

  it('reads the business from its own menu: a SALON that lists no nail service is not a nail salon', () => {
    expect(kindFromMenu(HAIR_MENU)).toBe('HAIR');
    expect(kindFromMenu(['Classic lash set', 'Volume lash set', 'Brow lamination'])).toBe('LASH');
    expect(kindFromMenu(['Thai massage 60', 'Deep tissue massage', 'Foot massage'])).toBe('MASSAGE');
    expect(kindFromMenu(['Consultation', 'Package A', 'Package B'])).toBe('BEAUTY');
    expect(kindFromMenu(NAIL_MENU)).toBeNull();
    expect(kindFromMenu(['Haircut', 'Color'])).toBeNull(); // too few to conclude
    const { persona, voice } = personaWithMenu('SALON', null, null, HAIR_MENU);
    expect(voice).toBe('HAIR');
    expect(persona.identity).toBe('a hair salon');
    expect(personaWithMenu('SALON', null, null, ['Consultation', 'Package A', 'Package B']).persona.identity).toBe('a beauty salon');
  });

  it('every other trade is told its own words and to forget the nail examples', () => {
    const cases: [string, string | null, string | null, RegExp][] = [
      ['RESTAURANT', null, null, /TABLE/],
      ['RESTAURANT', 'CAFE', null, /café/i],
      ['SERVICE', null, 'DENTAL', /patient/],
      ['REAL_ESTATE', null, null, /viewing/],
      ['SERVICE', null, null, /team member/],
      ['SALON', null, 'SPA', /therapist/],
    ];
    for (const [type, trade, industry, re] of cases) {
      const { persona, voice } = personaWithMenu(type, trade, industry, []);
      const rule = tradeVoiceRule(persona, voice);
      expect(rule).toMatch(/NOT A NAIL SALON/);
      expect(rule).toMatch(/OWN DATA EXACTLY/);
      expect(rule).toMatch(re);
    }
    expect(tradeVoiceRule(...Object.values(personaWithMenu('RESTAURANT', null, null, [])) as [never, never])).toMatch(/never ask the customer which one they prefer/);
    expect(tradeVoiceRule(...Object.values(personaWithMenu('SERVICE', null, 'DENTAL', [])) as [never, never])).toMatch(/Never diagnose/);
    expect(venueViFor('DENTAL')).toBe('phòng khám');
    expect(venueViFor('NAIL')).toBe('tiệm');
  });

  it('the scripted customers ask about this trade, not about nails', () => {
    const by = (id: string) => SCENARIOS.find((s) => s.id === id)!;
    // nail salon: word for word
    for (const s of SCENARIOS) expect(scenarioTurns(s, 'vi', { nail: true, table: false })).toBe(s.turns.vi);
    const rest = { nail: false, table: true, sampleService: 'Phở bò' };
    expect(scenarioTurns(by('price'), 'vi', rest)[0]).toContain('Phở bò');
    expect(scenarioTurns(by('group'), 'en', rest)[0]).toMatch(/table for four/);
    const clinic = { nail: false, table: false, sampleService: 'Teeth cleaning' };
    expect(scenarioTurns(by('price'), 'en', clinic)[0]).toBe('How much is Teeth cleaning?');
    for (const s of SCENARIOS.filter((x) => x.modes.includes('booking'))) {
      for (const lang of ['vi', 'en'] as const) {
        expect(scenarioTurns(s, lang, clinic).join(' ')).not.toMatch(/manicure|pedicure|gel|móng|làm chân/i);
      }
    }
  });
});
