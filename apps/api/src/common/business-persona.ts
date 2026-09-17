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
export type TradePersonaKey = 'CAFE' | 'BAKERY' | 'BUBBLE_TEA' | 'FAST_FOOD';

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
  FAST_FOOD: {
    labelEn: 'Takeaway / Quick service', labelVi: 'Quán ăn nhanh / Mang đi',
    identity: 'a takeaway restaurant',
    voiceGoal: 'Goal: ANSWER the question. Callers want the hours, the address, the menu, or how long a wait is — answer from the notes below and nothing else. Seating is first come first served, so do not offer a table reservation. A LARGE or catering order is booked in advance: for that you need their first name, roughly how many people it is for, and a specific pickup date and time.',
    bookableNoun: 'order',
    venueNoun: 'restaurant',
  },
};

/** Unknown/legacy values fall back to SALON — the product's original truth,
 *  so existing tenants keep byte-identical prompts. */
export function personaFor(
  businessType: string | null | undefined,
  /** The finer trade the tenant declared, when it has one. */
  trade?: string | null,
): BusinessPersona {
  const k = String(businessType || '').toUpperCase() as BusinessTypeKey;
  const base = PERSONAS[k] ?? PERSONAS.SALON;
  // A declared trade refines; it never invents. An unknown trade — including
  // every beauty trade, which has nothing to add here — leaves the base alone.
  const t = String(trade || '').toUpperCase() as TradePersonaKey;
  const fine = TRADE_PERSONAS[t];
  return fine ? { ...base, ...fine, key: base.key } : base;
}

export const ALL_PERSONAS: BusinessPersona[] = Object.values(PERSONAS);

/** Trades that carry a persona of their own — for the picker and for tests. */
export const TRADE_PERSONA_KEYS: TradePersonaKey[] = Object.keys(TRADE_PERSONAS) as TradePersonaKey[];
