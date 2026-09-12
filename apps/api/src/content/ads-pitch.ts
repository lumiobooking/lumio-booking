import { bi, enOf, viOf, type Txt } from './i18n';
import { MIN_AD_MINUTES, type AdServicePick } from './ad-service';

/**
 * The ad budget, offered to the SALON in the salon's own words.
 *
 * WHY THE CLIENT SEES THIS AT ALL
 *
 * The owner asks for customers now and cannot follow the content argument.
 * The one thing that answers her directly is money: this much a day, for this
 * long, and here is the line under which each customer is profitable. Put on
 * her screen it stops being a pitch and becomes arithmetic she can check —
 * and arithmetic she can check is what makes a yes stick.
 *
 * WHAT IS TRANSLATED OUT
 *
 * The team's version of this carries the vocabulary of the trade: break-even
 * CPA, feasibility, lifetime ceilings, "a first campaign is a measurement".
 * None of that survives here. What survives is the shop's own numbers in the
 * shop's own sentences — what a new customer is worth after paying the tech,
 * how many are needed to get the money back, and whether there are chairs
 * free to seat them.
 *
 * THE STATE THAT MATTERS MOST IS THE ONE THAT SAYS NO
 *
 * When the smallest measurable budget needs more customers than the empty
 * hours can hold, this offers nothing and says why. An agency that answers
 * "yes, advertise" to every salon in every month is an agency whose
 * recommendation carries no information — and the shop finds that out with
 * its own money.
 */

export type PitchState = 'offer' | 'not-yet' | 'unknown';

/**
 * One numbered step of the plan. Four of them, and each answers a question the
 * owner would otherwise have to ask: where does the money go, what does the ad
 * sell, when does it run, and what happens when the fortnight is over.
 */
export interface PitchStep {
  /** The question, in three or four words. */
  title: Txt;
  /** The answer, in one line — this is what a skimmer reads. */
  head: Txt;
  /** Why that answer and not another. This is what makes it a plan. */
  body: Txt;
  /**
   * THE CONDITION THAT MOVES THIS STEP FORWARD.
   *
   * "Google trước, Meta sau" was the whole answer, and an agency owner asked
   * the obvious next question: sau là khi nào? A step with no trigger is not a
   * plan, it is an ordering — and an ordering nobody can act on, because there
   * is no day and no number at which anything changes.
   *
   * So a step may carry the test that has to come true, in the salon's own
   * figures: which day to look, what number decides it, and what to do with
   * either answer. Present only where there is a real condition to state.
   */
  when?: Txt | null;
  /**
   * What that box is called on this step.
   *
   * Not every `when` is a condition. The channel step's is a test that has to
   * come true; the weekly step's is what lands in the owner's hand. Printing
   * "điều kiện để sang bước sau" over the second one made a promise read as a
   * hurdle — the opposite of its point.
   */
  whenTitle?: Txt | null;
  /**
   * THE REASONING — BEHIND A TAP, NOT ON THE PAGE.
   *
   * Every gate, every figure and every thing deliberately left out used to be
   * printed in the body, and the card grew into forty lines of argument. An
   * agency owner put it plainly: khách hàng không có chuyên môn, và cái này
   * quá dài. He is right, and the mistake was mine — showing the work is not
   * the same as printing all of it.
   *
   * So `body` is now ONE short sentence: the answer. `detail` holds the
   * working, collapsed, for the owner who wants to check it and for the agency
   * that has to defend it. Nothing was deleted; it stopped being compulsory
   * reading. A card an owner finishes is worth more than one she abandons.
   */
  detail?: Txt | null;
  /** What the toggle over `detail` is called on this step. */
  detailTitle?: Txt | null;
}

export interface AdsPitch {
  state: PitchState;
  /** The three numbers, already in money. Empty for the states with no offer. */
  figures: { value: string; label: Txt }[];
  headline: Txt;
  why: Txt;
  /** The plan itself. Empty for the states that offer nothing. */
  steps: PitchStep[];
  /** The text of the button, when there is something to say yes to. */
  cta: Txt | null;
  /** What the team reads when the shop says yes. */
  request: string | null;
  /**
   * The one thing to do ALONGSIDE the campaign — or instead of it, in the one
   * state that still says no (no chairs free).
   *
   * It used to be the consolation prize attached to a refusal. It is now what
   * runs in parallel: ask every finished customer for a review while the ads
   * are live, rather than waiting for twenty of them before spending a dollar.
   */
  todo?: Txt | null;
  /**
   * EVERY SOURCE THIS RECOMMENDATION RESTS ON, AND WHETHER IT ANSWERED.
   *
   * The screen showed a conclusion and no working. An agency owner read it and
   * said, correctly, that it was built on too little — and there was no way for
   * him to check, because the one thing the screen would not show was what it
   * had looked at. A number with no provenance is not persuasive even when it
   * is right, and when it is wrong nobody can see why.
   *
   * So the sources travel with the answer: what a visit is worth and where that
   * came from, what the margin is, how the free capacity was worked out, what
   * Google says, what the Page says, which channel the salon's own customers
   * arrive through. Silence is listed too — a source that said nothing appears
   * as "chưa có", never omitted. An owner can then argue with the input rather
   * than with the conclusion, which is the only argument worth having.
   */
  basis?: { label: Txt; value: Txt; known: boolean }[];
}

const fmt = (c: number) => `$${Math.round(c / 100)}`;

/** 1st, 2nd, 3rd, 9th — only ever used on a small break-even count. */
const ordSuffix = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
};

export interface PitchPlanInput {
  /**
   * The assessment finding that decides where the paid clicks land. Read by
   * destinationStep; never a reason to withhold a budget.
   */
  aim?: { key: string; because: Txt; doNext: Txt | null } | null;
  /** The first channel's short name — "Google" — for use inside a sentence. */
  platformShort?: Txt | null;
  /** The second channel's short name — "Meta". */
  secondShort?: Txt | null;
  /**
   * How many bookings the first channel has to produce before its cost per
   * customer means anything — the same number the campaign is sized to break
   * even on. Below it, every rate pulled out of the result is noise, which is
   * exactly why the second channel must not be switched on yet.
   */
  provingBookings?: number | null;
  /** Where to start, and what comes after it. Both already named for a person. */
  platform?: { label: Txt; key: string } | null;
  secondPlatform?: Txt | null;
  /** True when the choice came from this salon's OWN bookings, not the default order. */
  platformFromData?: boolean;
  /**
   * WHAT THE AD SELLS, already gated — see ./ad-service.
   *
   * This used to be a bare list of names taken straight off the per-chair-hour
   * table, and on a real menu that table is topped by a five-minute chin wax.
   * The card said, in bold, to advertise "Chin". The pick now arrives with the
   * figures behind it and with what was ruled out, because an owner does not
   * trust a conclusion she cannot check — and she checks this one first.
   */
  sells?: AdServicePick | null;
  /** The week's offer, when there is one to put in the ad. */
  offerLine?: Txt | null;
  /** Weekday names to run on, and to stay off. */
  runDays?: Txt[];
  pauseDays?: Txt[];
  /** How far ahead this salon's customers book. */
  leadDays?: number | null;
  /** The blocks with room in them — where the customers will be seated. */
  quietBlocks?: Txt[];
  /** Median days between visits, for the "come back" step. */
  returnDays?: number | null;
}

const listOf = (xs: string[]) => {
  const clean = xs.map((x) => x.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  return `${clean.slice(0, -1).join(', ')} ${clean.length === 2 ? 'và' : 'và'} ${clean[clean.length - 1]}`;
};
const listEn = (xs: string[]) => {
  const clean = xs.map((x) => x.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
};

/**
 * WHAT THE AD SELLS — and, just as loudly, what it does not.
 *
 * THE FAILURE THIS REPLACES
 *
 * The step used to print the top of the per-chair-hour table and assert that
 * those were "the services that earn you the most per chair-hour". On a real
 * nail-salon menu the top of that table is a five-minute chin wax, so the card
 * on a paying salon's screen read: advertise Chin. The assertion was even true
 * of the formula — $8 for 5 minutes IS $96 an hour — and still the advice was
 * indefensible, because you cannot fill an hour with twelve chin waxes and
 * nobody drives across town for one.
 *
 * WHY THE REASONS ARE ON THE CARD NOW
 *
 * An owner with no marketing background cannot audit a recommendation; she can
 * only audit arithmetic about her own shop. So the step shows the three gates
 * with her numbers in them — booked how many times, priced at what against her
 * own average ticket, long enough to hold a chair — and names the add-ons it
 * deliberately left out. The ruled-out list is the part that reads as expertise:
 * it is the trap an amateur would have walked into, pointed at.
 */
function sellsStep(p: AdServicePick | null, offerVi: string, offerEn: string): PitchStep {
  const title = bi('Quảng cáo dịch vụ gì', 'What the ad sells');
  const rows = p?.rows ?? [];
  const names = rows.map((r) => r.name);
  const floor = p?.floorCents && p.floorCents > 0 ? p.floorCents : null;
  const f = floor ? fmt(floor) : '';

  // The offer is a second decision, not part of the answer to "which service",
  // and cramming both into one bold line made the line unreadable. It gets its
  // own labelled box.
  const offer: { when: Txt | null; whenTitle: Txt | null } = offerVi || offerEn
    ? {
      whenTitle: bi('Ưu đãi đi kèm', 'The offer that goes with it'),
      // The offer line and nothing else. The sentence that used to follow it
      // ("dán đúng câu đó vào quảng cáo…") was an instruction to ourselves
      // printed on the client's screen.
      when: bi(offerVi, offerEn),
    }
    : { when: null, whenTitle: null };

  if (!names.length) {
    return {
      title,
      head: bi(offerVi, offerEn),
      body: bi(
        'Bảng giá của tiệm chưa trả lời được câu này: mỗi dịch vụ cần có GIÁ và có THỜI LƯỢNG. Thiếu một trong hai thì mọi phép tính "dịch vụ nào đáng quảng cáo" đều là đoán. Điền hai ô đó xong, bên em chọn bằng số liệu của tiệm chứ không chọn bằng cảm tính.',
        'Your price list cannot answer this yet: every service needs a PRICE and a LENGTH on it. Missing either one, any claim about which service is worth advertising is a guess. Fill those two fields in and we choose from your own figures instead of by feel.'),
    };
  }

  const figVi = rows
    .map((r) => `${r.name} ${fmt(r.priceCents)}/${r.minutes} phút${r.bookings > 0 ? ` · ${r.bookings} lượt đặt trong 30 ngày qua` : ''}`)
    .join(' — ');
  const figEn = rows
    .map((r) => `${r.name} ${fmt(r.priceCents)} for ${r.minutes} min${r.bookings > 0 ? ` · booked ${r.bookings} times in the last 30 days` : ''}`)
    .join(' — ');

  const addOns = (p?.skipped ?? []).filter((x) => x.why === 'add-on').map((x) => x.name);
  const under = (p?.skipped ?? []).filter((x) => x.why === 'under-ticket').map((x) => x.name);

  const V: string[] = [];
  const E: string[] = [];

  // Keyed on whether THESE rows were booked, not on the basis: a salon whose
  // whole menu sits under its average ticket can still have real bookings on
  // the rows we picked, and telling that owner "no bookings recorded" would be
  // false on her own screen — the fastest way to lose the card's credibility.
  const booked = rows.some((r) => r.bookings > 0);
  if (booked) {
    V.push(`• Có khách thật đang đặt: ${figVi}.`);
    E.push(`• Real customers are already booking these: ${figEn}.`);
  } else {
    V.push(`• Lấy từ bảng giá của tiệm: ${figVi}. Ba mươi ngày qua hệ thống chưa ghi nhận lượt đặt nào cho những dịch vụ này, nên đợt chạy đầu cũng chính là phép thử xem khách bấm vào cái nào.`);
    E.push(`• Taken from your price list: ${figEn}. No bookings for these came through the system in the last 30 days, so this first run doubles as the test of which one people click.`);
  }

  if (p?.basis === 'best-available' && f) {
    V.push(`• Về tiền, đây là mức cao nhất tiệm đang có: không dịch vụ nào trên bảng đạt ${f} — mức hoá đơn trung bình mà ngân sách quảng cáo đang tính theo. Tiệm nên ghép một combo từ ${f} trở lên để đưa vào quảng cáo; bên em dựng gói đó cho tiệm.`);
    E.push(`• On money this is the best you currently have: nothing on the list reaches ${f}, which is the average ticket the ad budget is priced off. Build one package at ${f} or above to advertise — we will put it together with you.`);
  } else if (f) {
    V.push(`• Đủ để trả tiền cho một khách mới: ngân sách mỗi khách được tính theo hoá đơn trung bình ${f} của tiệm, nên thứ đem đi quảng cáo phải đáng từ ${f} trở lên. Quảng cáo món rẻ hơn mức đó thì tiền bỏ ra mua một khách còn lớn hơn tiền khách đó trả.`);
    E.push(`• Enough to pay for a new customer: the per-customer budget is priced off your ${f} average ticket, so what the ad sells has to be worth ${f} or more. Advertise something cheaper and the money spent winning the customer is bigger than the money they hand over.`);
  } else {
    V.push('• Chưa đủ lịch hẹn để biết hoá đơn trung bình của tiệm, nên bên em chưa đặt mức giá sàn cho dịch vụ quảng cáo — tạm chọn theo thời lượng và tiền thu trên mỗi giờ ghế, và chỉnh lại ngay khi có đủ lịch.');
    E.push('• There are not enough appointments yet to know your average ticket, so no price floor has been set on what the ad sells — for now it is chosen on length and earnings per chair-hour, and it gets corrected as soon as the bookings are there.');
  }

  V.push(`• Đủ dài để đáng một chuyến đi: từ ${MIN_AD_MINUTES} phút trở lên, và trong nhóm đó xếp theo tiền thu trên mỗi GIỜ GHẾ — không phải theo giá ghi trên bảng. Một dịch vụ ${fmt(4500)} làm 40 phút đẻ ra nhiều tiền hơn một dịch vụ ${fmt(6000)} làm 90 phút.`);
  E.push(`• Long enough to be worth the trip: ${MIN_AD_MINUTES} minutes or more, and inside that group we put first whatever earns most per CHAIR-HOUR, not whatever carries the biggest price on the board. A ${fmt(4500)} service that takes 40 minutes earns more than a ${fmt(6000)} one that takes 90.`);

  if (addOns.length) {
    V.push(`Bên em cố ý KHÔNG quảng cáo ${listOf(addOns)}. Tính theo tiền trên mỗi giờ ghế thì mấy món này luôn đứng đầu bảng — đúng là vì chúng quá ngắn — nhưng không ai lái xe tới tiệm chỉ để làm một món dưới nửa tiếng; khách làm thêm khi đã ngồi trên ghế rồi. Quảng cáo chúng là bỏ tiền mua khách bằng giá một hoá đơn lớn để thu về một hoá đơn nhỏ.`);
    E.push(`We deliberately do NOT advertise ${listEn(addOns)}. Per chair-hour they top the table — precisely because they are so short — but nobody drives to a salon for something that takes under half an hour; it gets bought once the customer is already in the chair. Advertising it means paying a big-ticket price for a customer who buys a small ticket.`);
  } else if (under.length && f) {
    V.push(`Bên em không đưa ${listOf(under)} vào quảng cáo: dưới mức hoá đơn trung bình ${f}, bán thêm tại tiệm thì lãi hơn là bỏ tiền quảng cáo để bán.`);
    E.push(`${listEn(under)} stays out of the ad: below the ${f} average ticket, it is more profitable sold at the counter than bought with ad money.`);
  }

  V.push('Quảng cáo một dịch vụ có tên luôn rẻ hơn quảng cáo cả tiệm, vì người bấm vào là người đã muốn đúng thứ đó.');
  E.push('Advertising one named service always costs less than advertising the salon, because the person who clicks already wants that exact thing.');

  // ONE SENTENCE ON THE CARD. The three gates, the figures behind them and the
  // add-ons left out all moved into `detail` — see PitchStep.detail for why.
  const many = names.length > 1;
  const leftOut = addOns.length
    ? ` Mấy món ngắn dưới ${MIN_AD_MINUTES} phút bên em không quảng cáo — khách làm thêm khi đã ngồi trên ghế chứ không lái xe tới vì nó.`
    : '';
  const leftOutEn = addOns.length
    ? ` Anything under ${MIN_AD_MINUTES} minutes stays out — it gets bought in the chair, nobody drives over for it.`
    : '';
  const shortVi = p?.basis === 'best-available'
    ? `${many ? 'Hai dịch vụ' : 'Dịch vụ'} đáng tiền nhất tiệm đang có. Bên em sẽ bàn với tiệm một gói lớn hơn để quảng cáo chắc lãi hơn.`
    : booked
      ? `${many ? 'Hai dịch vụ này' : 'Dịch vụ này'} vừa có khách đặt đều, vừa đủ lớn để bù được tiền quảng cáo.${leftOut}`
      : `Lấy từ bảng giá của tiệm: đủ lớn để bù được tiền quảng cáo. Đợt đầu cũng là phép thử xem khách bấm vào cái nào.${leftOut}`;
  const shortEn = p?.basis === 'best-available'
    ? `The best-paying ${many ? 'services' : 'service'} you currently have. We will put a bigger package together with you so the ads pay more surely.`
    : booked
      ? `${many ? 'Both are' : 'It is'} booked regularly and big enough to cover what an ad costs.${leftOutEn}`
      : `Taken from your price list: big enough to cover what an ad costs. The first run also tests which one people click.${leftOutEn}`;

  return {
    title,
    head: bi(listOf(names), listEn(names)),
    body: bi(shortVi, shortEn),
    detailTitle: bi('Vì sao chọn dịch vụ này', 'Why these'),
    detail: bi(V.join('\n'), E.join('\n')),
    ...offer,
  };
}

/**
 * The plan, in four questions the owner would ask if she knew to ask them.
 *
 * Each step is skipped when the salon has not given us the fact it rests on —
 * a plan that invents its own reasons is worse than a short one. The last step
 * is always there, because "and then what" is answerable from the budget alone.
 */
/**
 * Where the person who taps the ad ends up.
 *
 * THE STEP THAT WAS MISSING, AND WHAT IT COST.
 *
 * The plan answered four questions — which channel, which service, which days,
 * what happens after — and never the one that decides whether the money works:
 * where does the tap LAND. The default for a salon ad is the Google profile or
 * the call button, and for a shop with four reviews that is the one page you
 * would not choose. Rather than notice that and refuse to advertise, which is
 * what this module used to do, the plan now says so and points somewhere else.
 *
 * Only rendered when the assessment has something to say. A salon with a solid
 * profile does not need a step explaining that the map is fine.
 */
function destinationStep(aim: { key: string } | null | undefined): PitchStep | null {
  if (!aim) return null;
  if (aim.key === 'found-not-booked') {
    return {
      title: bi('Bấm vào thì tới đâu', 'Where the tap lands'),
      head: bi('Thẳng vào link đặt lịch — không phải số điện thoại', 'Straight to the booking link — not the phone number'),
      body: bi(
        'Tiệm đã có người tìm tới rồi mà không đặt được lịch — chỗ rò không nằm ở lượng người.',
        'People already find this salon and cannot book — the leak is not the number of visitors.'),
      detailTitle: bi('Vì sao không để số điện thoại', 'Why not the phone number'),
      detail: bi(
        'Quảng cáo đổ thẳng về link đặt lịch là bịt chỗ rò đó ngay trong ngày đầu. Để số điện thoại thì mất hết khách bấm vào ngoài giờ mở cửa — mà đó lại là lúc người ta rảnh để đi tìm tiệm.',
        'Pointing the ads at the booking link closes that leak on day one. A phone number loses everyone who taps outside opening hours — which is exactly when people go looking.'),
    };
  }
  // no-google / thin-google: the profile is not the page to argue the case on.
  return {
    title: bi('Bấm vào thì tới đâu', 'Where the tap lands'),
    head: bi('Vào tin nhắn hoặc link đặt lịch — chưa đổ về trang Google', 'Into Messenger or the booking link — not the Google profile yet'),
    body: bi(
      'Hồ sơ Google còn mỏng, nên bên em cho khách vào thẳng chỗ có người trả lời — bot nhắn lại trong vài giây và đặt lịch luôn.',
      'The Google profile is still thin, so we land people where someone answers — the bot replies in seconds and books them.'),
    detailTitle: bi('Vì sao chưa đổ về trang Google', 'Why not the Google profile yet'),
    detail: bi(
      'Khách lạ bấm quảng cáo rồi mở trang Google ra là họ đọc phần đánh giá chứ không đọc quảng cáo nữa. Ở màn hình tin nhắn thì con số đánh giá không xuất hiện ở đâu cả. Và số đánh giá vẫn tăng song song từ chính những khách này — không phải chờ đủ rồi mới chạy.',
      'A stranger who taps the ad and opens the Google profile reads the reviews, not the ad. On the Messenger screen the review count is nowhere to be seen. And the reviews still grow from these same customers — this is not something to finish before spending anything.'),
  };
}

/**
 * The channel's short name when we have one, else whatever label we were given.
 *
 * A fallback rather than a requirement: an older caller that sends only the
 * long label still produces a readable sentence, just a wordier one.
 */
function shortOf(short: Txt | null | undefined, fallbackVi: string, fallbackEn: string): { vi: string; en: string } {
  if (!short) return { vi: fallbackVi, en: fallbackEn };
  return { vi: viOf(short).trim() || fallbackVi, en: enOf(short).trim() || fallbackEn };
}

function planSteps(input: PitchPlanInput, days: number, ceilingText: string): PitchStep[] {
  const steps: PitchStep[] = [];

  const dest = destinationStep(input.aim);

  const first = input.platform ?? null;
  if (first) {
    const firstVi = viOf(first.label);
    const firstEn = enOf(first.label);
    const secondVi = input.secondPlatform ? viOf(input.secondPlatform).trim() : '';
    const secondEn = input.secondPlatform ? enOf(input.secondPlatform).trim() : '';
    const headVi = secondVi ? `${firstVi} trước, ${secondVi} sau` : firstVi;
    const headEn = secondEn ? `${firstEn} first, ${secondEn} after` : firstEn;
    // ONE SENTENCE the owner reads; the rest waits under the toggle.
    const short = shortOf(input.platformShort, firstVi, firstEn);
    const bodyVi = input.platformFromData
      ? `Khách của tiệm đang đến từ ${short.vi} nhiều hơn hẳn các kênh khác — bên em dồn tiền vào chỗ đã có người tìm tiệm.`
      : first.key === 'google'
        ? 'Người gõ "nail salon near me" là người đang định đi hôm nay — tiền bỏ vào đây ra khách nhanh nhất.'
        : `Quanh khu tiệm người ta ở trên ${short.vi} nhiều hơn là đi tìm kiếm, nên bên em đưa hình ảnh thật của tiệm tới trước mặt họ.`;
    const bodyEn = input.platformFromData
      ? `Your bookings come from ${short.en} more than anywhere else, so that is where the money goes first.`
      : first.key === 'google'
        ? 'Someone typing "nail salon near me" has already decided to go today — that is the fastest dollar.'
        : `Around your block people sit on ${short.en} rather than search for a salon, so we put real photos of your work in front of them.`;
    const longVi = input.platformFromData
      ? 'Bên em không rải đều cho đẹp báo cáo: dồn vào kênh đang thật sự mang khách tới thì mỗi đồng đọc được kết quả rõ hơn.'
      : first.key === 'google'
        ? 'Họ cần một chỗ, không cần được thuyết phục. Facebook và Instagram để sau, việc của chúng là làm người quanh đây nhớ mặt tiệm chứ không phải kéo khách về trong tuần này.'
        : 'Tìm kiếm tính sau — trước hết phải có người quanh đây nhìn thấy tay nghề của tiệm.';
    const longEn = input.platformFromData
      ? 'We do not spread it evenly to make a report look good: backing the channel that is already bringing people makes every dollar readable.'
      : first.key === 'google'
        ? 'They need an address, not persuasion. Facebook and Instagram come after — their job is keeping the shop in mind locally, not filling this week.'
        : 'Search comes later — first people nearby have to see the work.';
    /**
     * WHAT "SAU" ACTUALLY MEANS.
     *
     * The step said "Google trước, Meta sau" and stopped there. An agency owner
     * asked the question that exposes it: sau là khi nào, đạt tiêu chuẩn gì?
     * There was no answer anywhere on the screen — no day, no number, nothing
     * that could come true. An ordering with no trigger is not a plan, and it
     * is worse than useless to somebody who has to explain it to a client.
     *
     * The test below is written from this salon's own figures: the day the
     * first result can be read, the cost per customer it has to beat (the
     * salon's own margin on a visit), and the number of bookings below which
     * that cost is noise. Both outcomes are stated, because a condition that
     * only says what happens on success is a condition nobody checks.
     */
    const proving = input.provingBookings && input.provingBookings > 0 ? input.provingBookings : null;
    /**
     * THE CONDITION, AS A CHECKLIST — NOT AS A PARAGRAPH.
     *
     * The first version was six sentences run together, and it repeated the
     * full channel names — "Google (Tìm kiếm + Maps)", "Meta (Facebook +
     * Instagram)" — nine times inside them. A salon owner who does not work in
     * marketing does not read that; and the agency that hands it over looks
     * like it never read its own output, which is the opposite of the reason
     * the salon is paying an agency at all.
     *
     * So: two numbered tests, then the two answers, each on its own line, using
     * the channel's short name. The full name is stated once, on the headline
     * above, where it belongs.
     */
    const a = shortOf(input.platformShort, firstVi, firstEn);
    const b = shortOf(input.secondShort, secondVi, secondEn);
    // ONE LINE IN THE BOX, the full test under "Vì sao". A six-line checklist
    // sitting open on the card was most of what made this screen unreadable —
    // and the answer to "sau là khi nào" fits in a sentence.
    const proveVi = proving ? `${proving} booking` : 'đủ booking để đọc được';
    const proveEn = proving ? `${proving} bookings` : 'enough bookings to read';
    const when = b.vi && ceilingText
      ? bi(
        `Ngày thứ 7: nếu ${a.vi} đã về ${proveVi} và mỗi khách tốn dưới ${ceilingText} thì bên em mở ${b.vi}. Chưa đạt thì giữ nguyên ${a.vi} và sửa cho đạt trước.`,
        `Day 7: if ${a.en} has brought in ${proveEn} at under ${ceilingText} each, we open ${b.en}. If not, we keep ${a.en} and fix it first.`)
      : null;
    const whenDetail = b.vi && ceilingText
      ? bi(
        `Hai điều phải cùng đúng vào ngày thứ 7:\n`
        + `1. ${a.vi} đã mang về ${proveVi} trở lên — ít hơn thì con số nào rút ra cũng là nhiễu.\n`
        + `2. Mỗi khách mới từ ${a.vi} đang tốn dưới ${ceilingText}.\n`
        + `→ Đúng cả hai: bên em mở ${b.vi}, ngân sách bằng một nửa ${a.vi}.\n`
        + `→ Chưa đúng: giữ nguyên ${a.vi}. Bật thêm kênh khi kênh đầu chưa có lãi chỉ làm mất tiền nhanh gấp đôi, và khi đó không còn biết kênh nào gây ra kết quả.`,
        `Both have to be true on day 7:\n`
        + `1. ${a.en} has brought in ${proveEn} or more — fewer and any figure pulled out of them is noise.\n`
        + `2. Each new customer from ${a.en} is costing under ${ceilingText}.\n`
        + `→ Both true: we open ${b.en} at half the ${a.en} budget.\n`
        + `→ Not yet: keep ${a.en}. Adding a channel while the first one is losing money loses it twice as fast, and you can no longer tell which channel caused what.`)
      : null;

    // WHERE THE ORDER CAME FROM, SAID OUT LOUD — but under the toggle. When the
    // salon's own bookings chose it the short body already says so; when they
    // did not, the order is a starting rule rather than a reading of this shop,
    // and calling it a reading is how an agency loses an argument with its own
    // client. That caveat is honesty, not headline material.
    const caveatVi = input.platformFromData
      ? ''
      : `Thứ tự này chưa phải từ số liệu của tiệm — chưa có booking nào ghi nhận từ ${firstVi} hay ${secondVi || 'kênh còn lại'}. Nó là điểm khởi đầu, và đợt chạy này chính là thứ tạo ra số liệu để lần sau xếp theo tiệm.`;
    const caveatEn = input.platformFromData
      ? ''
      : `This order is not from your numbers yet — no booking has been attributed to ${firstEn} or ${secondEn || 'the other channel'}. It is a starting rule, and this campaign is what produces the data to order it by your shop next time.`;
    const detVi = [longVi, caveatVi, whenDetail ? viOf(whenDetail) : ''].filter(Boolean).join('\n');
    const detEn = [longEn, caveatEn, whenDetail ? enOf(whenDetail) : ''].filter(Boolean).join('\n');
    steps.push({
      title: bi('Chạy ở kênh nào', 'Where it runs'),
      head: bi(headVi, headEn),
      body: bi(bodyVi, bodyEn),
      detailTitle: bi('Vì sao kênh này trước', 'Why this one first'),
      detail: detVi ? bi(detVi, detEn) : null,
      when,
      whenTitle: bi('Khi nào mở kênh thứ hai', 'When the second channel opens'),
    });
  }

  // Second, because "which channel" is the question an owner asks first and
  // "where does it land" is the one that decides whether the answer works.
  if (dest) steps.push(dest);

  const sells = input.sells ?? null;
  const offerVi = input.offerLine ? viOf(input.offerLine).trim() : '';
  const offerEn = input.offerLine ? enOf(input.offerLine).trim() : '';
  if (sells?.rows.length || offerVi) {
    steps.push(sellsStep(sells, offerVi, offerEn));
  }

  const run = (input.runDays ?? []).map((d) => viOf(d));
  const runE = (input.runDays ?? []).map((d) => enOf(d));
  const pause = (input.pauseDays ?? []).map((d) => viOf(d));
  const pauseE = (input.pauseDays ?? []).map((d) => enOf(d));
  const quiet = (input.quietBlocks ?? []).map((b) => viOf(b));
  const quietE = (input.quietBlocks ?? []).map((b) => enOf(b));
  if (run.length || quiet.length) {
    const headVi = [
      run.length ? `Bật ${listOf(run)}` : '',
      pause.length ? `tắt ${listOf(pause)}` : '',
      quiet.length ? `nhắm vào khung ${listOf(quiet)}` : '',
    ].filter(Boolean).join(' · ');
    const headEn = [
      runE.length ? `On ${listEn(runE)}` : '',
      pauseE.length ? `off ${listEn(pauseE)}` : '',
      quietE.length ? `aimed at ${listEn(quietE)}` : '',
    ].filter(Boolean).join(' · ');
    const lead = input.leadDays ?? null;
    // The lead time is the one fact on the card; the rest is the reason, and
    // the reason waits under the toggle.
    const whyVi = [
      pause.length ? 'Ngày đông thì tắt — ngày đó tự đầy, trả tiền để lấp một chỗ đã có người là ném tiền đi.' : '',
      quiet.length ? 'Tiền dồn vào những khung còn ghế trống, để khách mới tới đúng lúc thợ đang rảnh chứ không phải lúc phải chờ.' : '',
    ].filter(Boolean).join(' ');
    const whyEn = [
      pauseE.length ? 'We switch it off on the busy days — those fill themselves, and paying for a seat that was already taken is money thrown away.' : '',
      quietE.length ? 'The spend goes to the blocks that still have chairs free, so a new customer arrives when someone can take her, not when she has to wait.' : '',
    ].filter(Boolean).join(' ');
    steps.push({
      title: bi('Chạy ngày nào, giờ nào', 'When it runs'),
      head: bi(headVi, headEn),
      body: bi(
        lead
          ? `Khách của tiệm thường đặt trước khoảng ${lead} ngày, nên quảng cáo phải chạy sớm hơn chừng đó.`
          : 'Tiền dồn vào những khung còn ghế trống, không rải đều cả tuần.',
        lead
          ? `Your customers book about ${lead} days ahead, so the ad runs that far in front.`
          : 'The spend goes to the blocks that still have chairs free, not evenly across the week.'),
      detailTitle: bi('Vì sao tắt ngày đông', 'Why we switch off the busy days'),
      detail: whyVi ? bi(whyVi, whyEn) : null,
    });
  }

  const back = input.returnDays ?? null;
  /**
   * WHAT THE SALON IS ACTUALLY PAYING FOR.
   *
   * The card described a budget, a channel and a schedule, and then went quiet
   * until day fourteen. To an owner who does not work in marketing that reads
   * as "we spend your money and tell you at the end" — which is what a
   * self-serve ad platform does, and the reason they hired an agency instead is
   * that they do not want to be the one watching it.
   *
   * The weekly check IS the service. It is stated here in the shape a person
   * can hold somebody to: which day, which numbers, and what gets changed
   * without having to be asked. A promise with a day on it can be kept or
   * broken; "we monitor it" can be neither.
   */
  const midDay = Math.max(3, Math.round(days / 2));
  steps.push({
    title: bi('Mỗi tuần bên em làm gì', 'What we do every week'),
    head: bi(
      `Ngày thứ ${midDay} và ngày thứ ${days}: bên em soi lại và báo tiệm bằng con số`,
      `Day ${midDay} and day ${days}: we review it and report back in numbers`),
    body: bi(
      'Ba câu mỗi lần: đã chi bao nhiêu, về mấy khách mới, mỗi khách tốn bao nhiêu. Tiệm không phải theo dõi gì cả.',
      'Three numbers each time: what was spent, how many new customers, what each cost. You do not have to watch anything.'),
    detailTitle: bi('Bên em sửa những gì', 'What we change'),
    detail: bi(
      `Rẻ hơn ${ceilingText}/khách thì bên em dồn thêm tiền vào khung giờ và dịch vụ đang chạy tốt. `
      + `Đắt hơn thì sửa ngay trong tuần — đổi dịch vụ quảng cáo, thu hẹp khu vực, hoặc tắt khung giờ không ra khách — chứ không chờ hết đợt rồi mới nói.`,
      `Cheaper than ${ceilingText} a customer and we put more behind the hours and services that are working. `
      + `Dearer and we fix it inside the week — change the advertised service, tighten the radius, or switch off an hour that brings nobody — rather than waiting for the run to end to tell you.`),
    whenTitle: bi('Tiệm nhận được gì', 'What you get'),
    when: bi(
      `Một tin nhắn ngắn có ba con số đó, kèm một dòng bên em đã đổi gì và vì sao. Không có gì phải đọc thêm.`,
      `A short message with those three numbers and one line on what we changed and why. Nothing else to read.`),
  });

  steps.push({
    title: bi(`Hết ${days} ngày thì sao`, `After the ${days} days`),
    head: bi(
      `Dưới ${ceilingText}/khách thì tăng ngân sách, vượt thì tắt`,
      `Under ${ceilingText} a customer we raise it, over it we stop`),
    body: bi(
      'Quyết bằng con số thật của đợt, không phải bằng cảm tính của bên em hay của tiệm.',
      'Decided on the real numbers from the run, not on our opinion or yours.'),
    detailTitle: bi('Rồi tiền đi đâu', 'And then where the money goes'),
    detail: bi(
      `Vượt ${ceilingText} thì bên em chuyển tiền đó sang nhắc khách cũ — rẻ hơn nhiều so với mua khách mới.`
        + (back
          ? ` Dù đợt này ra sao, mọi khách mới của đợt đều được nhắn lại sau khoảng ${back} ngày: lãi thật nằm ở lần thứ hai họ quay lại, không phải lần đầu.`
          : ' Dù đợt này ra sao, mọi khách mới của đợt đều được nhắn lại sau đó: lãi thật nằm ở lần thứ hai họ quay lại, không phải lần đầu.'),
      `Over ${ceilingText} and we move the money to reminding your past customers, which is far cheaper than buying new ones.`
        + (back
          ? ` Either way every new customer from this run is messaged again after about ${back} days: the profit is in the second visit, not the first.`
          : ' Either way every new customer from this run is messaged again later: the profit is in the second visit, not the first.')),
  });

  return steps;
}

export function adsPitch(input: {
  ceilingCents: number | null;
  dailyCents: number;
  days: number;
  totalCents: number;
  bookingsToBreakEven: number | null;
  openSlots: number | null;
  feasible: 'yes' | 'tight' | 'no' | 'unknown';
  /** Which of the two figures is missing, so "unknown" can name it. */
  missing?: 'ticket' | 'margin' | null;
  /**
   * What the whole-salon assessment says about where the paid clicks should
   * LAND. It changes the plan; it never withholds the budget. See adsAim in
   * salon-assessment.ts for why that distinction is the whole point.
   */
  aim?: { key: string; because: Txt; doNext: Txt | null } | null;
  /**
   * True when the ticket came from the salon's PRICE LIST rather than from
   * appointments booked here. The number is usable — it is the salon's own
   * statement about what a visit costs — but it has not met reality yet, and a
   * screen that shows an estimate as a measurement has spent trust it will
   * need later. So it says so, in the same breath as the number.
   */
  ticketEstimated?: boolean;
  /** What every figure above was read from. See AdsPitch.basis. */
  basis?: { label: Txt; value: Txt; known: boolean }[];
} & PitchPlanInput): AdsPitch {
  const { ceilingCents: ceiling, dailyCents: daily, days, totalCents: total } = input;

  if (!ceiling) {
    return {
      state: 'unknown',
      basis: input.basis,
      figures: [],
      steps: [],
      headline: bi('Chưa tính được ngân sách quảng cáo cho tiệm', 'We cannot size an ad budget for you yet'),
      why: input.missing === 'margin'
        ? bi(
          'Bên em cần biết tiệm trả công thợ bao nhiêu phần trăm thì mới tính được một khách mới để lại bao nhiêu lãi. Chưa có con số đó thì mọi mức chi đều là đoán — bên em không đề xuất kiểu đó.',
          'We need to know what share of a ticket goes to the tech before we can say what a new customer leaves you. Without it any budget is a guess, and we do not put guesses on this screen.')
        : bi(
          // Reaching here now means BOTH sources are empty: no appointments
          // here and no priced menu either. That is not "wait a few weeks" —
          // it is one afternoon of typing the price list in, and saying so
          // turns a dead end into the next thing to do.
          'Bên em chưa biết một lần khách tới tiệm thu khoảng bao nhiêu. Tiệm nhập bảng giá dịch vụ vào hệ thống là bên em tính được ngân sách ngay, không cần chờ có lịch hẹn.',
          'We do not know yet what one visit is worth here. Enter your service price list and we can size a budget straight away — no need to wait for bookings.'),
      cta: null,
      request: null,
    };
  }

  // NOTHING ABOUT THE PROFILE STOPS THE PLAN ANY MORE.
  //
  // A thin Google profile used to return "not the moment to put money into
  // ads" with no budget on screen. It is a real cost and it is not a veto: see
  // adsAim in salon-assessment.ts. The finding now rides into planSteps, where
  // it decides where the click lands, and out again as `todo`, which is the
  // thing to run in parallel — not the thing to finish first.

  if (input.feasible === 'no') {
    const need = input.bookingsToBreakEven ?? 0;
    const room = input.openSlots ?? 0;
    return {
      state: 'not-yet',
      basis: input.basis,
      figures: [],
      steps: [],
      headline: bi('Lúc này chưa nên chạy quảng cáo', 'Now is not the moment to advertise'),
      why: bi(
        `Đợt nhỏ nhất mà còn đo được cần ${need} khách mới hoà vốn, trong khi tiệm chỉ nhận thêm được khoảng ${room} khách. Bỏ tiền lúc này là mua khách không có ghế ngồi. Bên em lấp chỗ trống bằng khách cũ trước — không tốn tiền quảng cáo — rồi mở lại sau.`,
        `The smallest campaign that can still be measured needs ${need} new customers to break even, and your quiet hours only hold ${room}. Spending now buys customers with nowhere to sit. We will fill those gaps with your past customers first — which costs nothing — and come back to ads after.`),
      cta: null,
      request: null,
    };
  }

  const need = input.bookingsToBreakEven;
  const room = input.openSlots;
  return {
    state: 'offer',
    basis: input.basis,
    steps: planSteps(input, days, fmt(ceiling)),
    todo: input.aim?.doNext ?? null,
    // THREE NUMBERS THAT TELL ONE STORY, IN ORDER.
    //
    // The third used to be the spending ceiling — the same $28 that the
    // paragraph underneath calls the profit a new customer leaves behind. Both
    // readings are correct (the ceiling IS that profit) and putting them two
    // lines apart with different labels made one number mean two things on the
    // one screen an owner reads before saying yes. The count that decides the
    // offer takes its place: spend this, spend that in total, and you are square
    // at this many customers. The ceiling is explained once, in words, below.
    figures: [
      { value: fmt(daily), label: bi('mỗi ngày', 'per day') },
      { value: fmt(total), label: bi(`cả đợt ${days} ngày`, `for ${days} days`) },
      ...(need
        ? [{ value: String(need), label: bi('khách mới là huề vốn', 'new customers to break even') }]
        : [{ value: fmt(ceiling), label: bi('tối đa mỗi khách mới', 'max per new customer') }]),
    ],
    headline: bi('Muốn có khách ngay? Bên em đề xuất chạy thử', 'Want customers now? Here is what we suggest'),
    /**
     * FOUR SHORT SENTENCES, ONE IDEA EACH, IN THE ORDER AN OWNER ASKS THEM.
     *
     * This was one paragraph of four clauses, and it failed on the two things
     * a card like this must not do.
     *
     *   1. One number, two jobs. $28 sat in the figures as "most per new
     *      customer" and in the prose as "what a new customer leaves you".
     *      Same number, opposite direction, two lines apart. It is the same
     *      number for a good reason and now the sentence SAYS so instead of
     *      leaving the owner to work it out.
     *   2. The capacity figure read as a promise. "cần 8 khách để lấy lại
     *      tiền, và trong 14 ngày tiệm nhận thêm được khoảng 98 khách" put a
     *      break-even count and a seat count in one breath, and $224 for 98
     *      customers is what the owner takes away. That is a promise no
     *      campaign keeps. Capacity now gets its own sentence, introduced as
     *      what it is — whether there are chairs for the customers — and tied
     *      to the break-even count rather than to the money.
     *
     * Line breaks are deliberate: the screen renders them, and four short
     * lines get read where one dense block gets skipped.
     */
    why: bi(
      (input.ticketEstimated
        ? 'Con số dưới đây tính theo BẢNG GIÁ của tiệm, chưa phải từ lịch hẹn thật — đủ để bắt đầu, và bên em chỉnh lại sau vài tuần khi có số thật.\n'
        : '')
      // The first line used to repeat the three figures directly above it.
      + `Một khách mới để lại cho tiệm khoảng ${fmt(ceiling)} sau khi trả công thợ — nên ${fmt(ceiling)} cũng là mức tối đa bên em được phép chi để kéo một khách về.`
      + (need
        ? `\nĐủ ${need} khách là huề vốn; từ khách thứ ${need + 1} trở đi là tiệm lãi.`
        : '')
      // Capacity answers "are there chairs", never "how many customers will
      // come". Said in the same breath as the break-even count it was read as
      // a forecast — see the comment above.
      + (room && need
        ? ` Chỗ ngồi thì dư — ${days} ngày tới tiệm còn nhận thêm được khoảng ${room} lượt.`
        : room
          ? ` ${days} ngày tới tiệm còn nhận thêm được khoảng ${room} lượt khách.`
          : '')
      + `\nBên em chạy và soi mỗi ngày, tự tắt khi một khách bắt đầu tốn hơn ${fmt(ceiling)}.`,
      (input.ticketEstimated
        ? 'The figures below come from your PRICE LIST, not from bookings yet — enough to start with, and we correct them once real numbers arrive.\n'
        : '')
      + `A new customer leaves you about ${fmt(ceiling)} once the tech is paid — so ${fmt(ceiling)} is also the most we are allowed to spend bringing one in.`
      + (need
        ? `\n${need} of them and you are square; from the ${need + 1}${ordSuffix(need + 1)} one on, you are ahead.`
        : '')
      + (room && need
        ? ` Chairs are not the problem — you can take about ${room} more visits over the next ${days} days.`
        : room
          ? ` You can take about ${room} more visits over the next ${days} days.`
          : '')
      + `\nWe run it and check it daily, and switch it off ourselves the moment a customer starts costing more than ${fmt(ceiling)}.`),
    cta: bi(`Đồng ý — chạy thử ${days} ngày`, `Yes — run the ${days}-day test`),
    request: `Tiệm đồng ý chạy quảng cáo thử: ${fmt(daily)}/ngày × ${days} ngày (~${fmt(total)}) · ngưỡng ${fmt(ceiling)}/khách mới`,
  };
}
