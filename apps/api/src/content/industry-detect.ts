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
    { re: /\b(manicure|pedicure|gel[- ]?x|dipping|acrylic|nail|móng|nails)\b/i, w: 10, label: 'từ ngành nail' },
    { re: /\b(lash|brow|wax|facial|massage|spa|hair|salon)\b/i, w: 4, label: 'từ ngành làm đẹp' },
  ],
  RESTAURANT: [
    { re: /\b(phở|bún|cơm|noodle|pho|appetizer|entree|dessert|beverage|combo|khai vị|tráng miệng|đồ uống)\b/i, w: 8, label: 'từ thực đơn' },
    { re: /\b(restaurant|kitchen|bistro|cafe|café|grill|bbq|quán|nhà hàng|deli|bakery)\b/i, w: 5, label: 'từ ngành ăn uống' },
  ],
  REAL_ESTATE: [
    { re: /\b(listing|escrow|mls|open house|home valuation|property tour|buyer consultation|seller consultation|đặt cọc|ký gửi)\b/i, w: 10, label: 'từ nghiệp vụ bất động sản' },
    { re: /\b(realty|real estate|realtor|broker|homes|property|properties|bất động sản|nhà đất|môi giới)\b/i, w: 5, label: 'từ ngành bất động sản' },
  ],
  SERVICE: [
    { re: /\b(repair|cleaning|plumbing|hvac|install|maintenance|inspection|sửa chữa|vệ sinh|lắp đặt|bảo trì)\b/i, w: 8, label: 'từ ngành dịch vụ' },
  ],
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

  return { detected, confidence, evidence: evidence.slice(0, 6), scores, current, agrees, summary };
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
      message: 'Chưa biết bang. Lịch lễ và xu hướng đang chạy theo cả nước thay vì theo khu vực của tiệm.',
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
