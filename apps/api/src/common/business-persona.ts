/**
 * Who the AI is, per line of business — in ONE place.
 *
 * The voice agent introduced every tenant as "a nail salon". That was true
 * for the first customers and silently wrong for everyone since: a restaurant
 * got a manicure receptionist, and the first real-estate client (Family Smart
 * Homes) would have had callers offered a gel set. The identity of the AI is
 * tenant data, not prose baked into a prompt.
 *
 * Each persona answers the three questions every prompt needs:
 *   - WHO am I? (identity line: "phone receptionist for X, a real estate team")
 *   - WHAT is a successful call/chat? (book a service ↔ reserve a table ↔
 *     capture the lead and set up a callback or viewing)
 *   - WHAT WORDS does this trade use? (appointment / reservation / consultation)
 *
 * Services stay the booking backbone for every type — a real-estate tenant
 * lists "Buyer consultation" or "Home valuation" as its services, a restaurant
 * can list "Table for 2/4/6" — so the create_booking tool works unchanged.
 * The persona only changes what the AI SAYS, never what it can DO.
 *
 * TWO LAYERS, AND WHY
 *
 * `businessType` is a database enum with four values, and widening it means a
 * migration on a live database. The content engine meanwhile already knows
 * eleven finer TRADES (NAIL, HAIR, LASH… RESTAURANT), declared per tenant in
 * settings, because a lash studio and a nail salon want different ad words.
 *
 * A coffee shop showed why the coarse layer alone is not enough. It is a
 * RESTAURANT to the database — there is nothing else for it to be — and so the
 * AI opened with "take a table reservation", which is not a thing a café does.
 * The same is true of a bakery, a bubble tea shop and a takeaway counter: they
 * are all RESTAURANT in the enum and none of them seat people by appointment.
 *
 * So the fine trade REFINES the persona when it has something to say, and the
 * business type answers when it does not. No migration, and a tenant that
 * declares nothing keeps exactly the persona it has today.
 */

export type BusinessTypeKey = 'SALON' | 'RESTAURANT' | 'REAL_ESTATE' | 'SERVICE';

/**
 * Trades that need their own voice, beyond what the four business types say.
 * Only trades whose CONVERSATION differs belong here — a lash studio and a
 * nail salon both book an appointment and both say "salon", so neither needs
 * an entry; a bakery taking a cake order for Saturday needs one.
 */
export type TradePersonaKey = 'CAFE' | 'BAKERY' | 'BUBBLE_TEA' | 'FAST_FOOD' | 'DENTAL';

export interface BusinessPersona {
  key: BusinessTypeKey;
  /** For dropdowns and admin UI. */
  labelEn: string;
  labelVi: string;
  /** "…for "Name", a nail salon" — the clause after the tenant's name. */
  identity: string;
  /** What a successful phone call is, in imperative prompt prose. */
  voiceGoal: string;
  /** The word for the bookable thing, singular ("appointment"). */
  bookableNoun: string;
  /** Word for the venue in caller-facing lines ("the salon is closed then"). */
  venueNoun: string;
}

const PERSONAS: Record<BusinessTypeKey, BusinessPersona> = {
  SALON: {
    key: 'SALON',
    labelEn: 'Nail salon / Beauty', labelVi: 'Tiệm nail / Làm đẹp',
    identity: 'a nail salon',
    voiceGoal: 'Goal: book an appointment. You still need their first name, which service they want, and a specific date and time. Ask for what is missing, ONE thing at a time, and confirm details by repeating them back.',
    bookableNoun: 'appointment',
    venueNoun: 'salon',
  },
  RESTAURANT: {
    key: 'RESTAURANT',
    labelEn: 'Restaurant', labelVi: 'Nhà hàng',
    identity: 'a restaurant',
    voiceGoal: 'Goal: take a table reservation. You still need their first name, party size, and a specific date and time. Ask for what is missing, ONE thing at a time, and confirm details by repeating them back. If they ask about the menu, share only what is written here.',
    bookableNoun: 'reservation',
    venueNoun: 'restaurant',
  },
  REAL_ESTATE: {
    key: 'REAL_ESTATE',
    labelEn: 'Real estate', labelVi: 'Bất động sản',
    identity: 'a real estate team',
    voiceGoal: 'Goal: capture the lead and set up a consultation. Find out, ONE question at a time: their first name, whether they are buying, selling or renting, which area or city, and their rough timeline. Then offer to book a consultation call or viewing at a specific date and time. Never quote prices, valuations, commission rates or legal advice — an agent covers those on the consultation.',
    bookableNoun: 'consultation',
    venueNoun: 'office',
  },
  SERVICE: {
    key: 'SERVICE',
    labelEn: 'Other services', labelVi: 'Dịch vụ khác',
    identity: 'a local business',
    voiceGoal: 'Goal: book an appointment or, if nothing fits, take a clear message. You still need their first name, what they need help with, and a specific date and time. Ask for what is missing, ONE thing at a time, and confirm details by repeating them back.',
    bookableNoun: 'appointment',
    venueNoun: 'business',
  },
};

/**
 * The food trades. Each one keeps the RESTAURANT backbone — services are the
 * bookable thing, create_booking is unchanged — and changes only what the AI
 * says it is there to do.
 *
 * What they have in common, and why it is written into every goal here: most
 * callers to a café or a bakery are not booking anything. They want the hours,
 * the address, whether there is parking, whether you have a table free right
 * now. An assistant that answers "what time do you close?" by trying to take a
 * reservation is worse than no assistant, so the goal says ANSWER first and
 * book only when there is really something to book.
 */
const TRADE_PERSONAS: Record<TradePersonaKey, Partial<BusinessPersona> & { labelEn: string; labelVi: string }> = {
  CAFE: {
    labelEn: 'Café / Coffee shop', labelVi: 'Quán cà phê',
    identity: 'a coffee shop',
    voiceGoal: 'Goal: ANSWER the question. Most callers want the hours, the address, parking, wifi, whether it is busy, or what is on the menu — answer from the notes below and nothing else. A café does not seat people by appointment, so do NOT offer a reservation unthinkingly. Book only when they ask for something that really is booked in advance: a large group, a private event, or a catering order. Then you need their first name, how many people, and a specific date and time.',
    bookableNoun: 'booking',
    venueNoun: 'café',
  },
  BAKERY: {
    labelEn: 'Bakery / Bánh mì', labelVi: 'Tiệm bánh / Bánh mì',
    identity: 'a bakery',
    voiceGoal: 'Goal: ANSWER the question, and take custom orders. Most callers want the hours, the address, or whether something is in stock today — answer from the notes below and nothing else; never promise an item is available unless it says so. The thing this shop books is a CUSTOM ORDER — a cake, a party tray, a bulk order — and for that you need their first name, what they want, the size or how many people it feeds, and the date and time they will collect it. Repeat the pickup day and time back to them. Never invent a price, a flavour or a decoration you were not given; if they ask for something unusual, take their name and number and say the shop will call to confirm.',
    bookableNoun: 'order',
    venueNoun: 'bakery',
  },
  BUBBLE_TEA: {
    labelEn: 'Bubble tea / Drinks', labelVi: 'Trà sữa / Đồ uống',
    identity: 'a bubble tea shop',
    voiceGoal: 'Goal: ANSWER the question. Callers want the hours, the address, the menu, toppings, or sugar and ice levels — answer from the notes below and nothing else. This shop does not take table reservations, so do not offer one. What it does take in advance is a LARGE or catering order: for that you need their first name, roughly how many drinks, and a specific pickup date and time.',
    bookableNoun: 'order',
    venueNoun: 'shop',
  },
  // A clinic is a SERVICE in the enum; what it books is an exam, for a patient.
  DENTAL: {
    labelEn: 'Dental / Clinic', labelVi: 'Nha khoa / Phòng khám',
    identity: 'a dental clinic',
    voiceGoal: 'Goal: book an exam or treatment appointment. You still need the patient\'s first name, what they need (check-up, cleaning, a tooth that hurts, a follow-up…), and a specific date and time. Ask for what is missing, ONE thing at a time, and confirm details by repeating them back. Never diagnose, never quote a treatment price that is not written here, and for severe pain, swelling or bleeding tell them to come in as soon as possible or seek emergency care.',
    bookableNoun: 'appointment',
    venueNoun: 'clinic',
  },
  FAST_FOOD: {
    labelEn: 'Takeaway / Quick service', labelVi: 'Quán ăn nhanh / Mang đi',
    identity: 'a takeaway restaurant',
    voiceGoal: 'Goal: ANSWER the question. Callers want the hours, the address, the menu, or how long a wait is — answer from the notes below and nothing else. Seating is first come first served, so do not offer a table reservation. A LARGE or catering order is booked in advance: for that you need their first name, roughly how many people it is for, and a specific pickup date and time.',
    bookableNoun: 'order',
    venueNoun: 'restaurant',
  },
};

/**
 * Beauty studios that are not nail salons. Only applied when the owner (or
 * Super Admin) EXPLICITLY chose the industry — never from the marketing trade,
 * which the profile scan may have guessed. A nail salon that never chose keeps
 * "a nail salon", word for word.
 */
const BEAUTY_IDENTITIES: Record<string, Partial<BusinessPersona>> = {
  LASH: { identity: 'a lash and brow studio', venueNoun: 'studio' },
  HAIR: { identity: 'a hair salon' },
  SPA: { identity: 'a day spa', venueNoun: 'spa' },
  MASSAGE: { identity: 'a massage studio', venueNoun: 'studio' },
};

/** Unknown/legacy values fall back to SALON — the product's original truth,
 *  so existing tenants keep byte-identical prompts. */
export function personaFor(
  businessType: string | null | undefined,
  /** The finer trade the tenant declared, when it has one. */
  trade?: string | null,
  /** The industry the tenant EXPLICITLY chose (settings `industry`), when it did. */
  industry?: string | null,
): BusinessPersona {
  const k = String(businessType || '').toUpperCase() as BusinessTypeKey;
  const base = PERSONAS[k] ?? PERSONAS.SALON;
  // An explicit industry wins over the (possibly guessed) trade.
  const ik = String(industry || '').toUpperCase();
  if (ik && TRADE_PERSONAS[ik as TradePersonaKey]) return { ...base, ...TRADE_PERSONAS[ik as TradePersonaKey], key: base.key };
  if (ik && base.key === 'SALON' && BEAUTY_IDENTITIES[ik]) return { ...base, ...BEAUTY_IDENTITIES[ik], key: base.key };
  // A declared trade refines; it never invents. An unknown trade — including
  // every beauty trade, which has nothing to add here — leaves the base alone.
  const t = String(trade || '').toUpperCase() as TradePersonaKey;
  const fine = TRADE_PERSONAS[t];
  return fine ? { ...base, ...fine, key: base.key } : base;
}

/** The explicitly chosen industry from a settings `industry` row value, or null. */
export function chosenIndustry(value: unknown): string | null {
  const k = (value as { key?: string } | null)?.key;
  return typeof k === 'string' && k ? k.toUpperCase() : null;
}

export const ALL_PERSONAS: BusinessPersona[] = Object.values(PERSONAS);

/** Trades that carry a persona of their own — for the picker and for tests. */
export const TRADE_PERSONA_KEYS: TradePersonaKey[] = Object.keys(TRADE_PERSONAS) as TradePersonaKey[];

/* ------------------------------------------------------------------------ *
 * THE TRADE'S OWN VOICE
 *
 * The identity line above says "a restaurant" or "a dental clinic", and then
 * four thousand words of prompt written for nail salons follow it: "salon",
 * "technician", "gel fill", "deluxe spa pedicure". A model reads all of it,
 * and a clinic's patient was asked which technician they prefer.
 *
 * Rewriting every sentence per trade would change the prompt the nail salons
 * run on today. Instead the trade is named ONCE, with its own words, and the
 * prompt is told what its nail-salon wording means here. A nail salon gets no
 * rule at all — its prompt stays byte-identical.
 *
 * And the business is read from its OWN DATA: a SALON that never chose an
 * industry but lists haircuts, facials or lash sets is not a nail salon, and
 * is no longer introduced as one.
 * ------------------------------------------------------------------------ */

export type VoiceKey =
  | 'NAIL' | 'BEAUTY' | 'LASH' | 'HAIR' | 'SPA' | 'MASSAGE' | 'DENTAL'
  | 'RESTAURANT' | 'CAFE' | 'BAKERY' | 'BUBBLE_TEA' | 'FAST_FOOD' | 'REAL_ESTATE' | 'SERVICE';

const NAIL_WORDS = /nail|mani|pedi|\bgel\b|acrylic|\bdip\b|shellac|polish|full ?set|\bfill\b|french tip|móng|mong tay|sơn|\bbột\b|uñas|manicura|pedicura|美甲|네일/i;
const KIND_WORDS: [VoiceKey, RegExp][] = [
  ['LASH', /lash|brow|\bmi\b|nối mi|chân mày|phun xăm|pestañ/i],
  ['HAIR', /hair|haircut|\bcut\b|colou?r|blow ?dry|perm|balayage|barber|tóc|uốn|nhuộm|gội|cabello|corte/i],
  ['MASSAGE', /massage|mát ?xa|bấm huyệt|masaje/i],
  ['SPA', /facial|\bspa\b|skin|peel|body scrub|chăm sóc da|triệt lông|wax/i],
];

/**
 * What a SALON's own menu says it is. Null = nothing to conclude (too few
 * services, or it does list nail services) — the caller keeps today's answer.
 */
export function kindFromMenu(serviceNames: readonly string[] | null | undefined): VoiceKey | null {
  const names = (serviceNames ?? []).map((n) => String(n ?? '').trim()).filter(Boolean);
  if (names.length < 3) return null;
  if (names.some((n) => NAIL_WORDS.test(n))) return null;
  let best: VoiceKey = 'BEAUTY'; let bestN = 0;
  for (const [key, re] of KIND_WORDS) {
    const n = names.filter((x) => re.test(x)).length;
    if (n > bestN) { best = key; bestN = n; }
  }
  return bestN * 2 >= names.length ? best : 'BEAUTY';
}

/** Which voice this tenant speaks in — the same precedence as personaFor, plus its own menu. */
export function voiceKeyFor(
  businessType: string | null | undefined,
  trade?: string | null,
  industry?: string | null,
  serviceNames?: readonly string[] | null,
): VoiceKey {
  const k = String(businessType || '').toUpperCase();
  const base: BusinessTypeKey = (PERSONAS as Record<string, BusinessPersona>)[k] ? (k as BusinessTypeKey) : 'SALON';
  const ik = String(industry || '').toUpperCase();
  if (ik && TRADE_PERSONAS[ik as TradePersonaKey]) return ik as VoiceKey;
  if (ik && base === 'SALON' && BEAUTY_IDENTITIES[ik]) return ik as VoiceKey;
  const t = String(trade || '').toUpperCase();
  if (TRADE_PERSONAS[t as TradePersonaKey]) return t as VoiceKey;
  if (base !== 'SALON') return base;
  // The owner said "Nail": believe them, whatever the menu looks like.
  if (ik === 'NAIL') return 'NAIL';
  return kindFromMenu(serviceNames) ?? 'NAIL';
}

/** personaFor, but a SALON whose own menu is plainly not nails is named for what it is. */
export function personaWithMenu(
  businessType: string | null | undefined,
  trade: string | null | undefined,
  industry: string | null | undefined,
  serviceNames: readonly string[] | null | undefined,
): { persona: BusinessPersona; voice: VoiceKey } {
  const persona = personaFor(businessType, trade, industry);
  const voice = voiceKeyFor(businessType, trade, industry, serviceNames);
  if (persona.key === 'SALON' && persona.identity === PERSONAS.SALON.identity && voice !== 'NAIL') {
    const fine = BEAUTY_IDENTITIES[voice] ?? { identity: 'a beauty salon' };
    return { persona: { ...persona, ...fine, key: 'SALON' }, voice };
  }
  return { persona, voice };
}

interface VoiceWords {
  /** Who serves the customer, English / Vietnamese. Empty = nobody is chosen (a table, not a person). */
  staffEn: string; staffVi: string;
  /** What the place is called to the customer in Vietnamese. */
  venueVi: string;
  /** What the customer is called here. */
  customerEn: string;
  /** One extra line this trade needs. */
  extra: string;
}

const MENU_ONLY = 'most people writing in want an answer (hours, address, the menu, a price) — answer it from the menu and notes below, and only take a booking or an order when they ask for one.';
const VOICE_WORDS: Record<Exclude<VoiceKey, 'NAIL'>, VoiceWords> = {
  BEAUTY: { staffEn: 'staff member', staffVi: 'nhân viên', venueVi: 'tiệm', customerEn: 'customer', extra: '' },
  LASH: { staffEn: 'lash artist', staffVi: 'kỹ thuật viên', venueVi: 'tiệm', customerEn: 'customer', extra: '' },
  HAIR: { staffEn: 'stylist', staffVi: 'thợ tóc / stylist', venueVi: 'salon', customerEn: 'customer', extra: '' },
  SPA: { staffEn: 'therapist', staffVi: 'kỹ thuật viên', venueVi: 'spa', customerEn: 'guest', extra: '' },
  MASSAGE: { staffEn: 'therapist', staffVi: 'kỹ thuật viên', venueVi: 'tiệm', customerEn: 'guest', extra: '' },
  DENTAL: {
    staffEn: 'dentist / doctor', staffVi: 'bác sĩ', venueVi: 'phòng khám', customerEn: 'patient',
    extra: 'Never diagnose, never recommend a treatment or a medicine, never say what a symptom means: say what the clinic offers, and book the exam so the doctor can look. Severe pain, swelling, bleeding or an accident is urgent — offer the earliest time and give the clinic\'s phone number.',
  },
  RESTAURANT: {
    staffEn: '', staffVi: '', venueVi: 'nhà hàng', customerEn: 'guest',
    extra: 'A booking here is a TABLE: what you need is how many people, the date and the time (and a name and phone). Never ask which staff member they prefer and never ask "which service" when they want a table. Dishes and prices come only from the menu and notes below.',
  },
  CAFE: { staffEn: '', staffVi: '', venueVi: 'quán', customerEn: 'guest', extra: `A café does not seat people by appointment: ${MENU_ONLY}` },
  BAKERY: { staffEn: '', staffVi: '', venueVi: 'tiệm bánh', customerEn: 'customer', extra: `What is booked here is an ORDER for a day and time (a cake, a tray): ${MENU_ONLY} Never promise something is in stock today unless the notes say so.` },
  BUBBLE_TEA: { staffEn: '', staffVi: '', venueVi: 'quán', customerEn: 'customer', extra: `No table reservations: ${MENU_ONLY}` },
  FAST_FOOD: { staffEn: '', staffVi: '', venueVi: 'quán', customerEn: 'customer', extra: `Seating is first come, first served: ${MENU_ONLY}` },
  REAL_ESTATE: {
    staffEn: 'agent', staffVi: 'chuyên viên tư vấn', venueVi: 'văn phòng', customerEn: 'client',
    extra: 'A good chat here ends with a consultation or a viewing booked, or a clear lead: buying, selling or renting, which area, what timeline. Never state a property price, a rate, a fee, or legal or financial advice that is not in the notes below.',
  },
  SERVICE: { staffEn: 'team member', staffVi: 'nhân viên', venueVi: 'bên em', customerEn: 'customer', extra: '' },
};

/** What the place is called in Vietnamese ("tiệm" for a nail salon, "phòng khám" for a clinic). */
export function venueViFor(voice: VoiceKey): string {
  return voice === 'NAIL' ? 'tiệm' : VOICE_WORDS[voice].venueVi;
}

/**
 * The rule that makes a prompt written for nail salons speak for this trade.
 * EMPTY for a nail salon: its prompt does not change by one character.
 */
export function tradeVoiceRule(persona: BusinessPersona, voice: VoiceKey): string {
  if (voice === 'NAIL') return '';
  const w = VOICE_WORDS[voice];
  const what = persona.identity.replace(/^an? /, '').toUpperCase();
  return [
    `THIS BUSINESS IS ${what} — NOT A NAIL SALON. This rule outranks any wording above it.`,
    `- The instructions above were first written for nail salons. Wherever they say "salon", understand "${persona.venueNoun}"; wherever they say "appointment", understand "${persona.bookableNoun}"; ${w.staffEn ? `wherever they say "technician" or "tech", understand "${w.staffEn}".` : 'wherever they say "technician" or "tech": nobody is chosen here, so never ask the customer which one they prefer.'}`,
    `- Their example sentences that mention nail services (manicure, pedicure, gel, acrylic, fill, full set…) only show the SHAPE of a good reply. Never repeat them, never mention a nail service, and never call this business a nail salon or "tiệm nail".`,
    `- To the ${w.customerEn}, call this place "the ${persona.venueNoun}" (Vietnamese: "${w.venueVi}")${w.staffEn ? `, and the person who looks after them "${w.staffEn}" (Vietnamese: "${w.staffVi}")` : ''}. Write the way ${persona.identity} really talks to its ${w.customerEn}s.`,
    `- READ THIS BUSINESS'S OWN DATA EXACTLY. What it offers is what its menu, notes and documents below say — the names, prices and durations as written there, nothing else. If the ${w.customerEn} asks for something that is not listed, say you will check with the team; never assume it from what another kind of business would offer. The same for how long a result lasts, how long a visit takes, a distance or a drive time: say it only when it is written there.`,
    ...(w.extra ? [`- ${w.extra}`] : []),
  ].join('\n');
}
