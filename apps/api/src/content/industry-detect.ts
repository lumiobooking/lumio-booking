/**
 * Work out what trade a business is in, from what it already recorded.
 *
 * Every tenant on this platform defaults to SALON, and the industry-specific
 * engine reads that column. So a hundred businesses inherited nail advice by
 * default, and fixing that by hand is a hundred small acts of data entry that
 * someone has to remember to do. The shop already told us what it does — it
 * named its services, typed its menu, registered its tables. This reads that.
 *
 * TWO RULES THAT SHAPE THE WHOLE FILE
 *
 * 1. STRUCTURE OUTWEIGHS WORDS. A row in the menu table is a fact about how the
 *    business operates; the word "spa" in a name is a marketing choice. So
 *    having menu items scores far higher than any keyword, and a nail salon
 *    called "Home Nails" is not dragged into real estate by the word "home".
 *    Names are the weakest signal here on purpose: they are the most misleading.
 *
 * 2. IT PROPOSES, A PERSON DECIDES. Nothing here writes to the database.
 *    businessType changes what the AI hotline says to a real customer — an
 *    estate agency answering as a nail salon is worse than an unset field, and
 *    a confident wrong guess applied silently across a hundred tenants would be
 *    a very efficient way to embarrass a hundred clients at once. So the output
 *    is a suggestion, a confidence, and the evidence quoted verbatim so the
 *    person approving it can check the reasoning rather than trust it.
 */

export type Industry = 'SALON' | 'RESTAURANT' | 'REAL_ESTATE' | 'SERVICE';
export type Confidence = 'high' | 'low' | 'none';

export interface DetectInput {
  tenantName?: string | null;
  /** Service names, and their descriptions and categories if present. */
  serviceNames?: (string | null | undefined)[];
  /** Menu item names — their mere existence is a strong signal. */
  menuItemCount?: number;
  menuItemNames?: (string | null | undefined)[];
  /** Dining tables registered. Structural, and almost never a false positive. */
  tableCount?: number;
  website?: string | null;
  /**
   * What the business declared about itself.
   *
   * Weighted highest of all the text fields: a sentence the owner wrote is a
   * better description of the business than anything inferred from a menu.
   * Lumio Agency — "dịch vụ marketing cho người Việt tại Mỹ" — would have been
   * visible here on day one had this field existed.
   */
  declaredWhatWeDo?: string | null;
  currentIndustry?: string | null;
}

export interface Detection {
  detected: Industry | null;
  confidence: Confidence;
  /** Verbatim quotes of what led here, so a human can check the reasoning. */
  evidence: string[];
  scores: Record<Industry, number>;
  current: string;
  /** True when the stored industry already matches the detection. */
  agrees: boolean;
  /** One line for the operator, in their language. */
  summary: string;
  /**
   * The finer trade under `detected`, when the words say so clearly.
   * Null means "nothing beyond the business type" — which is the honest
   * answer for most shops and leaves the owner's own choice alone.
   */
  trade: FineTrade | null;
  /** Verbatim quotes behind `trade`, kept apart from the industry evidence. */
  tradeEvidence: string[];
}

/**
 * A word boundary that speaks Vietnamese.
 *
 * `\b` is defined on [A-Za-z0-9_], so a term ending in a letter it does not
 * recognise has no boundary after it: `/\bphở\b/` matches the word "phở" in
 * no sentence ever written. Silently. Every accented term in the tables below
 * — phở, cà phê, bánh mì, đặt cọc, chân mày — was dead code for exactly that
 * reason, which is to say the detector read English and pretended to read
 * Vietnamese, in a product whose owners write their menus in Vietnamese.
 *
 * Unicode lookarounds fix it: a match must not be glued to another LETTER or
 * DIGIT, in any alphabet. Same intent as `\b`, correct in both languages.
 */
function term(alts: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * Keywords, weighted.
 *
 * Deliberately short. A long list looks more thorough and behaves worse: every
 * extra generic word ("book", "service", "care") is another chance to pull a
 * business into the wrong trade, and the structural signals below do most of
 * the real work anyway.
 */
const WORDS: Record<Industry, { re: RegExp; w: number; label: string }[]> = {
  SALON: [
    { re: term('manicure|pedicure|gel[- ]?x|dipping|acrylic|nail|móng|nails'), w: 10, label: 'từ ngành nail' },
    // Written as shops actually write them. `hair` never matched "Haircut"
    // and `wax` never matched "Waxing", so a hair salon or a waxing bar
    // could score zero on a service list that says nothing else.
    { re: term('lash(es)?|brows?|wax(ing)?|facial|massage|spa|hair(cut|style|stylist)?|barber|balayage|salon|thẩm mỹ|làm đẹp'), w: 4, label: 'từ ngành làm đẹp' },
  ],
  RESTAURANT: [
    { re: term('phở|bún|cơm|noodle|pho|appetizer|entree|dessert|beverage|combo|khai vị|tráng miệng|đồ uống'), w: 8, label: 'từ thực đơn' },
    { re: term('restaurant|kitchen|bistro|cafe|café|grill|bbq|quán|nhà hàng|deli|bakery'), w: 5, label: 'từ ngành ăn uống' },
  ],
  REAL_ESTATE: [
    { re: term('listing|escrow|mls|open house|home valuation|property tour|buyer consultation|seller consultation|đặt cọc|ký gửi'), w: 10, label: 'từ nghiệp vụ bất động sản' },
    { re: term('realty|real estate|realtor|broker|homes|property|properties|bất động sản|nhà đất|môi giới'), w: 5, label: 'từ ngành bất động sản' },
  ],
  SERVICE: [
    { re: term('repair|cleaning|plumbing|hvac|install|maintenance|inspection|sửa chữa|vệ sinh|lắp đặt|bảo trì'), w: 8, label: 'từ ngành dịch vụ' },
  ],
};

/**
 * THE TRADE UNDER THE INDUSTRY.
 *
 * `Industry` is the database column and has four values, which is the right
 * size for a database column and far too coarse to write content with. Under
 * SALON sit seven beauty trades; under RESTAURANT sit five food trades. A lash
 * studio and a nail salon are both SALON and want completely different posts —
 * and until this existed, the lash studio got nail advice, because SALON
 * aliases to the nail playbook.
 *
 * Detected SEPARATELY and reported separately: `detected` stays the business
 * type (it is written to a four-value enum), `trade` is the finer answer that
 * goes to business_profile.trade. Nothing here widens the enum.
 */
export type FineTrade =
  | 'NAIL' | 'HAIR' | 'LASH' | 'BROW' | 'SPA' | 'MASSAGE' | 'PMU'
  | 'RESTAURANT' | 'CAFE' | 'BAKERY' | 'BUBBLE_TEA' | 'FAST_FOOD';

/**
 * The words that separate one trade from its neighbours — and ONLY those.
 *
 * The rule the coarse table above states is sharper here, because these trades
 * genuinely overlap: a café sells croissants, a bubble tea shop sells a matcha
 * latte, a bakery sells bánh mì and so does a phở restaurant. So a word earns
 * its place only if it points at ONE trade more than the others; "drink",
 * "fresh" and "combo" point nowhere and are absent on purpose.
 *
 * Where a word honestly belongs to two trades — microblading is both a brow
 * service and permanent makeup — it is listed in both, and the clear-winner
 * rule below then refuses to guess rather than picking the first one. A refusal
 * leaves the owner's own choice in place, which is the safe direction.
 */
const FINE_WORDS: Record<FineTrade, { re: RegExp; w: number }[]> = {
  // ---- under SALON ----
  NAIL: [
    { re: term('manicure|pedicure|gel[- ]?x|dip(ping)? powder|acrylic|nail art|nails?|móng'), w: 10 },
  ],
  HAIR: [
    { re: term('haircut|balayage|highlights?|keratin|blowout|hair colou?r|perm|tóc|nhuộm|uốn tóc|ép tóc'), w: 10 },
  ],
  LASH: [
    { re: term('lash(es)?|eyelash|volume lash|lash lift|classic set|nối mi'), w: 10 },
  ],
  BROW: [
    { re: term('brows?|eyebrow|microblading|brow lamination|threading|chân mày|tỉa mày'), w: 9 },
  ],
  SPA: [
    { re: term('facial|hydrafacial|skincare|chemical peel|extraction|chăm sóc da|trị mụn'), w: 10 },
  ],
  MASSAGE: [
    { re: term('massage|deep tissue|hot stone|reflexology|body scrub|xoa bóp|gội đầu dưỡng sinh'), w: 10 },
  ],
  PMU: [
    { re: term('permanent makeup|microblading|lip blush|powder brows|ombre brows|phun xăm|phun môi|phun mày'), w: 9 },
  ],
  // ---- under RESTAURANT ----
  RESTAURANT: [
    { re: term('phở|pho|bún|bun bo|cơm tấm|entr[ée]e|appetizer|main course|noodle soup|lẩu|nướng'), w: 10 },
  ],
  CAFE: [
    { re: term('latte|espresso|cappuccino|americano|cold brew|macchiato|cà phê|ca phe|bạc xỉu'), w: 10 },
  ],
  BAKERY: [
    { re: term('croissant|pastr(y|ies)|cupcakes?|sourdough|baguette|birthday cake|wedding cake|bánh kem|bánh ngọt|bánh mì'), w: 10 },
  ],
  BUBBLE_TEA: [
    { re: term('boba|bubble tea|milk tea|brown sugar|trân châu|trà sữa|tapioca'), w: 10 },
  ],
  FAST_FOOD: [
    { re: term('drive[- ]?thru|take ?out|take ?away|cơm hộp|mang đi|value meal|meal deal'), w: 9 },
  ],
};

/** Which fine trades live under which business type. A café cannot be detected
 *  under SALON, however the word "latte" got into the shop's name. */
const FAMILY: Record<Industry, FineTrade[]> = {
  SALON: ['NAIL', 'HAIR', 'LASH', 'BROW', 'SPA', 'MASSAGE', 'PMU'],
  RESTAURANT: ['RESTAURANT', 'CAFE', 'BAKERY', 'BUBBLE_TEA', 'FAST_FOOD'],
  REAL_ESTATE: [],
  SERVICE: [],
};

const ZERO: Record<Industry, number> = { SALON: 0, RESTAURANT: 0, REAL_ESTATE: 0, SERVICE: 0 };
const TRADE_VI: Record<Industry, string> = {
  SALON: 'nail / làm đẹp', RESTAURANT: 'ăn uống', REAL_ESTATE: 'bất động sản', SERVICE: 'dịch vụ',
};

function clean(xs?: (string | null | undefined)[]): string[] {
  return (xs ?? []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 60);
}

export function detectIndustry(input: DetectInput): Detection {
  const scores = { ...ZERO };
  const evidence: string[] = [];
  const services = clean(input.serviceNames);
  const menu = clean(input.menuItemNames);
  const current = String(input.currentIndustry ?? 'SALON').toUpperCase();

  // ---- structural signals, which are facts about how the business runs ----
  if ((input.tableCount ?? 0) > 0) {
    scores.RESTAURANT += 25;
    evidence.push(`Có ${input.tableCount} bàn ăn đã đăng ký`);
  }
  if ((input.menuItemCount ?? 0) >= 3) {
    scores.RESTAURANT += 20;
    evidence.push(`Có ${input.menuItemCount} món trong thực đơn`);
  }

  // ---- words, weighted by WHERE they appear ----
  // A service the shop sells outranks the name it trades under, and both
  // outrank a domain. The name is the easiest thing to choose for marketing
  // reasons and therefore the least reliable thing to reason from.
  const fields: { text: string[]; mult: number; where: string }[] = [
    { text: [String(input.declaredWhatWeDo ?? '')], mult: 4, where: 'mô tả tiệm tự khai' },
    { text: services, mult: 3, where: 'dịch vụ' },
    { text: menu, mult: 3, where: 'thực đơn' },
    { text: [String(input.tenantName ?? '')], mult: 1, where: 'tên tiệm' },
    { text: [String(input.website ?? '')], mult: 1, where: 'website' },
  ];

  for (const f of fields) {
    for (const raw of f.text) {
      if (!raw) continue;
      for (const ind of Object.keys(WORDS) as Industry[]) {
        for (const rule of WORDS[ind]) {
          const m = rule.re.exec(raw);
          if (!m) continue;
          scores[ind] += rule.w * f.mult;
          const quote = `"${m[0]}" trong ${f.where}${f.where === 'dịch vụ' || f.where === 'thực đơn' ? ` "${raw.slice(0, 40)}"` : ''}`;
          if (evidence.length < 8 && !evidence.some((e) => e.startsWith(`"${m[0]}"`))) evidence.push(quote);
        }
      }
    }
  }

  const ranked = (Object.keys(scores) as Industry[])
    .map((k) => ({ k, v: scores[k] }))
    .sort((a, b) => b.v - a.v);
  const top = ranked[0];
  const second = ranked[1];

  // A winner must be both strong enough to mean something and clear enough to
  // beat the runner-up. A shop scoring 12 to 11 has told us nothing, and saying
  // so is more useful than picking the 12.
  let confidence: Confidence = 'none';
  if (top.v >= 20 && top.v >= second.v * 2) confidence = 'high';
  else if (top.v >= 8) confidence = 'low';

  const detected = confidence === 'none' ? null : top.k;
  const agrees = detected !== null && detected === current;

  // A declared description outranks every heuristic here. Suggesting an
  // industry change to a business that has said in sentences what it does would
  // be this file overruling the only authoritative source it has.
  if (String(input.declaredWhatWeDo ?? '').trim().length > 20 && confidence === 'high' && detected !== current) {
    confidence = 'low';
  }

  const summary = detected === null
    ? 'Chưa đủ dữ liệu để đoán ngành. Tiệm chưa có dịch vụ hay thực đơn nào đáng kể — cần đặt tay.'
    : agrees
      ? `Khớp: dữ liệu của tiệm cũng chỉ về ngành ${TRADE_VI[detected]}.`
      : confidence === 'high'
        ? `Đang đặt là ${current}, nhưng dữ liệu của tiệm chỉ rõ ngành ${TRADE_VI[detected]}.`
        : `Đang đặt là ${current}. Dữ liệu nghiêng về ${TRADE_VI[detected]} nhưng tín hiệu còn yếu — kiểm lại trước khi đổi.`;

  const fine = detected ? detectFineTrade(fields, detected) : { trade: null, evidence: [] };

  return {
    detected, confidence, evidence: evidence.slice(0, 6), scores, current, agrees, summary,
    trade: fine.trade, tradeEvidence: fine.evidence,
  };
}

/**
 * Which trade inside the family, from the same fields and the same weighting.
 *
 * Only ever asked about the family that already won, so the question is never
 * "is this a café or a nail salon" — the coarse pass settled that — but "is
 * this café a café or a bakery", which is where the real ambiguity lives.
 *
 * The clear-winner rule is stricter than the coarse one (1.5× the runner-up is
 * not enough; it must be double) because the cost of being wrong is different:
 * a wrong INDUSTRY is obvious the moment anyone looks at the screen, while a
 * wrong TRADE quietly writes plausible content for the shop next door. Silence
 * costs a generic-but-correct playbook. A confident mistake costs trust.
 */
function detectFineTrade(
  fields: { text: string[]; mult: number; where: string }[],
  family: Industry,
): { trade: FineTrade | null; evidence: string[] } {
  const candidates = FAMILY[family];
  if (candidates.length < 2) return { trade: null, evidence: [] };

  const score = new Map<FineTrade, number>(candidates.map((c) => [c, 0]));
  const evidence: string[] = [];
  const seen = new Set<string>();

  for (const f of fields) {
    for (const raw of f.text) {
      if (!raw) continue;
      for (const t of candidates) {
        for (const rule of FINE_WORDS[t]) {
          const m = rule.re.exec(raw);
          if (!m) continue;
          score.set(t, (score.get(t) ?? 0) + rule.w * f.mult);
          const word = m[0].toLowerCase();
          if (evidence.length < 6 && !seen.has(word)) {
            seen.add(word);
            evidence.push(`"${m[0]}" trong ${f.where}`);
          }
        }
      }
    }
  }

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  // Double the runner-up, and enough of it to mean something. A shop scoring
  // 30 to 24 has told us it sells both, which is true of most shops.
  if (!top || top[1] < 20 || top[1] < (second?.[1] ?? 0) * 2) return { trade: null, evidence: [] };
  return { trade: top[0], evidence };
}

// ---- the wider health check ------------------------------------------------

export interface ConfigGap {
  key: 'industry' | 'region' | 'commission' | 'zips' | 'formats';
  /** How much it costs to leave this unset. */
  severity: 'blocking' | 'degraded';
  message: string;
}

/**
 * What is missing before this tenant's plan can be any good.
 *
 * Ordered by consequence, not by how easy each is to fix. `blocking` means the
 * feature genuinely does not work: no format library means the model invents
 * formats, and no commission means the promo engine refuses to name a discount
 * at all. `degraded` means it works but nationally instead of locally, which is
 * the difference between useful and merely present.
 */
export function configGaps(input: {
  detection: Detection;
  region?: string | null;
  commissionPct?: number | null;
  postalCode?: string | null;
  formatCount?: number;
}): ConfigGap[] {
  const gaps: ConfigGap[] = [];
  const d = input.detection;

  if (d.detected && !d.agrees && d.confidence === 'high') {
    gaps.push({
      key: 'industry', severity: 'blocking',
      message: `Ngành đang sai: đặt ${d.current} nhưng dữ liệu chỉ rõ ${TRADE_VI[d.detected]}. Mọi gợi ý nội dung, kịch bản hotline và khuyến mãi đều đang dùng sai ngành.`,
    });
  }
  if (!input.formatCount) {
    gaps.push({
      key: 'formats', severity: 'blocking',
      message: 'Thư viện định dạng cho ngành này đang rỗng. Thư viện rỗng là lệnh ngầm bảo AI tự ứng biến — ra nội dung chung chung. Bấm "Nạp định dạng mẫu".',
    });
  }
  if (!input.commissionPct) {
    gaps.push({
      key: 'commission', severity: 'blocking',
      message: 'Chưa có tỷ lệ ăn chia thợ, nên chưa tính được giảm bao nhiêu thì còn lãi. Hệ thống sẽ từ chối đề xuất mức giảm cho tới khi có số này.',
    });
  }
  if (!input.region) {
    gaps.push({
      key: 'region', severity: 'degraded',
      message: 'Chưa biết bang. Dịp lễ và xu hướng đang chạy theo cả nước thay vì theo khu vực của tiệm.',
    });
  }
  if (!input.postalCode) {
    gaps.push({
      key: 'zips', severity: 'degraded',
      message: 'Chưa có mã ZIP nên chưa lấy được số liệu dân cư quanh tiệm.',
    });
  }
  return gaps;
}

// ---- filling the trade from the scan -----------------------------------------

/**
 * Which trade the profile scan may write, if any.
 *
 * Two witnesses: the model that read the business's own website (asked to
 * name one trade from the engine's list) and the keyword detector above. A
 * trade is written when the model names one the engine knows and the
 * detector does not contradict it with high confidence — or, with no usable
 * answer from the model, when the detector alone is highly confident about a
 * non-salon trade. A person's own choice is never touched: that is what
 * `manual` is for.
 *
 * Returns null for "leave it as it is". Since the detector learned the fine
 * trades it is a real second witness rather than a coarse one: it can now say
 * LASH where it used to say only SALON. It is still the junior witness — the
 * model read the shop's own website, the detector read a word list — so the
 * model's answer is taken first and the detector's is used when the model has
 * none, or nothing the engine knows.
 */
export function pickTrade(args: {
  modelTrade?: string | null;
  detection: Detection;
  manual: boolean;
  known: string[];
}): string | null {
  if (args.manual) return null;
  const model = String(args.modelTrade ?? '').trim().toUpperCase();
  const d = args.detection;
  const known = new Set(args.known.map((k) => k.toUpperCase()));
  const beauty = new Set(['SALON', 'NAIL', 'HAIR', 'LASH', 'BROW', 'SPA', 'MASSAGE', 'PMU']);
  const food = new Set(['RESTAURANT', 'CAFE', 'BAKERY', 'BUBBLE_TEA', 'FAST_FOOD']);
  // Which of the four business types a trade sits under. Without this, a model
  // answer of "CAFE" was compared against the detected business type
  // RESTAURANT, did not equal it, and was thrown away — so the moment the food
  // trades existed, naming one correctly became the way to be ignored.
  const familyOf = (t: string): string => (beauty.has(t) ? 'SALON' : food.has(t) ? 'RESTAURANT' : t);
  // Strength read from the raw scores, not from `confidence`: detectIndustry
  // demotes a clear result to 'low' when a declared description disagrees
  // with the CURRENT setting — the right caution for a health check that
  // proposes changing a person's choice, and the wrong one here, where the
  // declared description is exactly the evidence being weighed.
  const ranked = (Object.keys(d.scores) as Industry[]).map((k) => ({ k, v: d.scores[k] })).sort((a, b) => b.v - a.v);
  const strong = ranked[0].v >= 20 && ranked[0].v >= ranked[1].v * 2 ? ranked[0].k : null;
  if (model && known.has(model)) {
    // The words may veto only when they point clearly at a different family.
    const family = familyOf(model);
    if (strong && strong !== family) return null;
    return model;
  }
  // The detected FINE trade outranks the coarse family: "this shop sells boba"
  // is a better answer than "this shop sells food", and it is the answer the
  // content engine can actually write from. Still gated on the family agreeing,
  // so a stray word cannot move a shop into another industry through here.
  if (d.trade && known.has(d.trade)) {
    if (!strong || strong === familyOf(d.trade)) return d.trade;
  }
  if (strong && strong !== 'SALON' && known.has(strong)) return strong;
  return null;
}
