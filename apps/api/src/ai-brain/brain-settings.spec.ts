import { brainFromLegacy, brainPromptBlocks, defaultBrain, languageRule, sanitizeBrain } from './brain-settings';

describe('the salon\'s AI brain settings', () => {
  it('starts in the salon\'s own language and with sane limits', () => {
    expect(defaultBrain('US').languages.primary).toBe('en');
    expect(defaultBrain('VN').languages.primary).toBe('vi');
    const d = defaultBrain('US');
    expect(d.booking).toEqual(expect.objectContaining({ canBook: true, allowGroup: true, maxParty: 6, canCancel: false }));
    expect(d.handoff.silenceRetries).toBe(3);
  });

  it('keeps what was not sent, clamps numbers and drops junk', () => {
    const base = defaultBrain('US');
    const s = sanitizeBrain({ persona: { agentName: '  Linh ', tone: 'nope' }, booking: { maxParty: 99, canCancel: true }, handoff: { silenceRetries: 0, transferNumber: '+1 (512) 555-0147 x' }, hacker: 1, languages: { primary: 'es', allowed: ['vi', 'xx'] } }, base);
    expect(s.persona.agentName).toBe('Linh');
    expect(s.persona.tone).toBe('warm');
    expect(s.booking.maxParty).toBe(10);
    expect(s.booking.canCancel).toBe(true);
    expect(s.handoff.silenceRetries).toBe(1);
    expect(s.handoff.transferNumber).toBe('+1 (512) 555-0147 ');
    // The primary language is always allowed; unknown codes vanish.
    expect(s.languages.primary).toBe('es');
    expect(s.languages.allowed).toEqual(['es', 'vi']);
    expect((s as unknown as Record<string, unknown>).hacker).toBeUndefined();
  });

  it('cleans the facts: no empties, a label from the value when missing', () => {
    const s = sanitizeBrain({ knowledge: { facts: [{ label: 'Parking', value: 'Behind the shop' }, { value: 'Kids from 8', on: false }, { label: '', value: '' }, 'junk'] } }, defaultBrain('US'));
    expect(s.knowledge.facts).toEqual([{ label: 'Parking', value: 'Behind the shop', on: true }, { label: 'Kids from 8', value: 'Kids from 8', on: false }]);
  });

  it('assembles the old screens into one brain, so nothing changes until the owner saves', () => {
    const b = brainFromLegacy({
      market: 'US',
      messenger: { greeting: 'Hi!', agentName: 'Mai', bizIntro: 'Nails in Austin', aiInstruction: 'chat rule', botFacts: [{ label: 'Parking', value: 'Free', on: true }] },
      voice: { greeting: 'Thanks for calling', language: 'vi-VN', aiInstruction: 'phone rule', transferNumber: '+15125550147' },
      aiNotes: 'Shared rule',
    });
    expect(b.persona.agentName).toBe('Mai');
    expect(b.languages.primary).toBe('vi');
    expect(b.knowledge.rules).toBe('Shared rule');
    expect(b.knowledge.facts[0].label).toBe('Parking');
    expect(b.channels.voice).toEqual({ greeting: 'Thanks for calling', extra: 'phone rule' });
    expect(b.channels.chat.extra).toBe('chat rule');
    expect(b.handoff.transferNumber).toBe('+15125550147');
    expect(brainFromLegacy({ voice: { language: 'bilingual' } }).languages.voiceOpening).toBe('menu');
  });
});

describe('the prompt lines every assistant shares', () => {
  const brain = sanitizeBrain({
    persona: { agentName: 'Linh', tone: 'brief', intro: 'Nails in Austin', signoff: 'See you soon' },
    knowledge: { facts: [{ label: 'Parking', value: 'Behind', on: true }, { label: 'Off', value: 'x', on: false }], rules: 'Full set from $60' },
    booking: { allowGroup: true, maxParty: 4, canCancel: false, whenFull: 'waitlist' },
    channels: { voice: { extra: 'Speak slowly' }, chat: { extra: 'Use emoji' } },
  }, defaultBrain('US'));

  it('names the persona, lists only the facts that are on, and merges the owner\'s rules with the channel extra', () => {
    const v = brainPromptBlocks(brain, { channel: 'voice', salonName: 'Lux', venueNoun: 'salon', lang: 'en' });
    expect(v.persona).toMatch(/Your name is Linh/);
    expect(v.persona).toMatch(/brief/);
    expect(v.facts).toBe('- Parking: Behind');
    expect(v.rules).toBe('Full set from $60\nSpeak slowly');
    const c = brainPromptBlocks(brain, { channel: 'chat', salonName: 'Lux', venueNoun: 'salon', lang: 'vi' });
    expect(c.rules).toBe('Full set from $60\nUse emoji');
  });

  it('turns the booking policy into instructions: group size, no cancelling, waiting list', () => {
    const v = brainPromptBlocks(brain, { channel: 'chat', salonName: 'Lux', venueNoun: 'salon', lang: 'en' });
    expect(v.booking).toMatch(/up to 4 people/);
    expect(v.booking).toMatch(/NOT cancel/);
    expect(v.booking).toMatch(/waiting list/);
    const off = brainPromptBlocks(sanitizeBrain({ booking: { canBook: false } }, defaultBrain('US')), { channel: 'chat', salonName: 'Lux', venueNoun: 'salon', lang: 'en' });
    expect(off.booking).toMatch(/does NOT take bookings through you/);
  });

  it('writes the language rule for the customer\'s language, in both directions', () => {
    expect(languageRule('vi', ['en', 'vi'])).toMatch(/VIETNAMESE/);
    expect(languageRule('vi', ['en', 'vi'])).toMatch(/dạ/);
    expect(languageRule('es', ['en', 'vi', 'es'])).toMatch(/SPANISH/);
    expect(languageRule('es', ['en', 'vi', 'es'])).toMatch(/English, Vietnamese/);
    expect(languageRule('en', ['en'])).not.toMatch(/\(\)/);
  });
});
