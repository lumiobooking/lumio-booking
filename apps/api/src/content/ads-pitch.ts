import { bi, enOf, viOf, type Txt } from './i18n';

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

export interface PitchPlanInput {
  /**
   * The assessment finding that decides where the paid clicks land. Read by
   * destinationStep; never a reason to withhold a budget.
   */
  aim?: { key: string; because: Txt; doNext: Txt | null } | null;
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
  /** What to advertise: the services that earn most per chair-hour, best first. */
  services?: string[];
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
        'Tiệm đã có người tìm tới rồi mà không đặt được lịch, nên chỗ rò không nằm ở lượng người. Quảng cáo đổ về đúng cái link đặt lịch là bịt chỗ rò đó ngay trong ngày đầu — gọi điện thì mất khách vào những giờ không ai bắt máy.',
        'People already find this salon and cannot book, so the leak is not the number of visitors. Pointing the ads at the booking link closes it on day one — a phone number loses everyone who taps outside opening hours.'),
    };
  }
  // no-google / thin-google: the profile is not the page to argue the case on.
  return {
    title: bi('Bấm vào thì tới đâu', 'Where the tap lands'),
    head: bi('Vào tin nhắn hoặc link đặt lịch — chưa đổ về trang Google', 'Into Messenger or the booking link — not the Google profile yet'),
    body: bi(
      'Khách lạ bấm vào quảng cáo rồi mở trang Google ra là họ đọc phần đánh giá chứ không đọc quảng cáo nữa. Trong lúc hồ sơ còn mỏng thì cho họ vào thẳng chỗ có người trả lời — bot của tiệm nhắn lại trong vài giây và đặt lịch luôn, không ai nhìn thấy con số đánh giá ở đó. Số đánh giá vẫn tăng song song từ chính những khách này, không phải chờ đủ rồi mới chạy.',
      'A stranger who taps the ad and opens the Google profile reads the reviews, not the ad. While the profile is thin, land them where someone answers instead — the salon bot replies in seconds and books them, and the review count is nowhere on that screen. The reviews then grow from these same customers, rather than being something to finish before spending anything.'),
  };
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
    const bodyVi = input.platformFromData
      ? `Khách của tiệm đang đến từ ${firstVi} nhiều hơn hẳn các kênh khác — bên em dồn tiền vào chỗ đã có người tìm tiệm, không rải đều cho đẹp báo cáo.`
      : first.key === 'google'
        ? 'Người gõ "nail salon near me" là người đang định đi hôm nay — họ cần một chỗ, không cần được thuyết phục. Tiền bỏ vào đây trả về khách nhanh nhất. Facebook và Instagram để sau, việc của chúng là làm người quanh đây nhớ mặt tiệm.'
        : `Người quanh khu tiệm ở trên ${firstVi} nhiều hơn là đi tìm kiếm — bên em đưa hình ảnh thật của tiệm tới trước mặt họ trước, rồi mới tính tới tìm kiếm.`;
    const bodyEn = input.platformFromData
      ? `Your own bookings come from ${firstEn} more than anywhere else, so that is where the money goes first — we back the channel already bringing you people.`
      : first.key === 'google'
        ? 'Someone typing "nail salon near me" has already decided to go today; they need an address, not persuasion. That is the fastest dollar. Facebook and Instagram come after — their job is to keep the shop in mind locally.'
        : `Around your block people sit on ${firstEn} rather than search for a salon, so we put real photos of your work in front of them first, then look at search.`;
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
    const when = secondVi && ceilingText
      ? bi(
        `Mở ${secondVi} khi ĐỦ CẢ HAI, soi vào ngày thứ 7: `
        + `(1) ${firstVi} đã mang về ${proving ? `ít nhất ${proving} booking` : 'đủ booking để đọc được'} — ít hơn thì mọi tỷ lệ rút ra đều là nhiễu; `
        + `(2) mỗi khách mới từ ${firstVi} đang tốn dưới ${ceilingText}. `
        + `Đủ hai thì mở ${secondVi} với nửa ngân sách của ${firstVi}. `
        + `Trên ${ceilingText} thì sửa ${firstVi} trước — chưa mở ${secondVi}, vì bật hai kênh lúc một kênh đang lỗ thì chỉ lỗ nhanh gấp đôi. `
        + `Hết ${days} ngày mà vẫn chưa đủ booking thì chạy thêm một đợt ${firstVi} nữa, vẫn chưa mở ${secondVi}.`,
        `Open ${secondEn} when BOTH are true, checked on day 7: `
        + `(1) ${firstEn} has produced ${proving ? `at least ${proving} bookings` : 'enough bookings to read'} — fewer and every rate you pull out of them is noise; `
        + `(2) each new customer from ${firstEn} is costing under ${ceilingText}. `
        + `Both true, open ${secondEn} at half the ${firstEn} budget. `
        + `Over ${ceilingText}, fix ${firstEn} first — do not open ${secondEn}, because switching on a second channel while the first is losing money only loses it twice as fast. `
        + `If ${days} days pass without enough bookings, run ${firstEn} once more and still do not open ${secondEn}.`)
      : null;

    steps.push({
      title: bi('Chạy ở kênh nào', 'Where it runs'),
      head: bi(headVi, headEn),
      // WHERE THE ORDER CAME FROM, SAID OUT LOUD.
      //
      // When the salon's own bookings chose it, the body already says so. When
      // they did not — no booking has ever been attributed to either channel —
      // the order is a starting rule, not a reading of this shop, and calling
      // it a reading is how an agency loses an argument with its own client.
      body: bi(
        bodyVi + (input.platformFromData ? '' : ` (Thứ tự này chưa phải từ số liệu của tiệm — chưa có booking nào ghi nhận từ ${firstVi} hay ${secondVi || 'kênh còn lại'}. Nó là điểm khởi đầu, và đợt chạy này chính là thứ tạo ra số liệu để lần sau xếp theo tiệm.)`),
        bodyEn + (input.platformFromData ? '' : ` (This order is not from your numbers yet — no booking has been attributed to ${firstEn} or ${secondEn || 'the other channel'}. It is a starting rule, and this campaign is what produces the data to order it by your shop next time.)`)),
      when,
    });
  }

  // Second, because "which channel" is the question an owner asks first and
  // "where does it land" is the one that decides whether the answer works.
  if (dest) steps.push(dest);

  const services = (input.services ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const offerVi = input.offerLine ? viOf(input.offerLine).trim() : '';
  const offerEn = input.offerLine ? enOf(input.offerLine).trim() : '';
  if (services.length || offerVi) {
    const headVi = [services.length ? listOf(services) : '', offerVi ? `kèm ${offerVi}` : ''].filter(Boolean).join(' — ');
    const headEn = [services.length ? listEn(services) : '', offerEn ? `with ${offerEn}` : ''].filter(Boolean).join(' — ');
    steps.push({
      title: bi('Quảng cáo dịch vụ gì', 'What the ad sells'),
      head: bi(headVi, headEn),
      body: bi(
        'Đây là những dịch vụ mang về nhiều tiền nhất trên mỗi giờ ghế của tiệm — không phải dịch vụ ghi giá cao nhất trên bảng. Quảng cáo một dịch vụ cụ thể luôn rẻ hơn quảng cáo cả tiệm, vì người bấm vào là người đã muốn đúng thứ đó.',
        'These earn you the most per chair-hour — not the highest price on the board, which is a different thing. Advertising one named service always costs less than advertising the salon, because the person who clicks already wants that exact thing.'),
    });
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
    const bodyVi = (lead
      ? `Khách của tiệm thường đặt trước khoảng ${lead} ngày, nên quảng cáo phải chạy sớm hơn ngày cần khách chừng đó. `
      : '')
      + (pause.length
        ? 'Ngày đông thì tắt — ngày đó tự đầy, trả tiền để lấp một chỗ đã có người là ném tiền đi. '
        : '')
      + (quiet.length
        ? 'Tiền dồn vào những khung còn ghế trống, để khách mới tới đúng lúc thợ đang rảnh chứ không phải lúc phải chờ.'
        : '');
    const bodyEn = (lead
      ? `Your customers book about ${lead} days ahead, so the ad has to run that far before the day you want filled. `
      : '')
      + (pauseE.length
        ? 'We switch it off on the busy days — those fill themselves, and paying for a seat that was already taken is money thrown away. '
        : '')
      + (quietE.length
        ? 'The spend goes to the blocks that still have chairs free, so a new customer arrives when someone can take her, not when she has to wait.'
        : '');
    steps.push({
      title: bi('Chạy ngày nào, giờ nào', 'When it runs'),
      head: bi(headVi, headEn),
      body: bi(bodyVi.trim(), bodyEn.trim()),
    });
  }

  const back = input.returnDays ?? null;
  steps.push({
    title: bi(`Hết ${days} ngày thì sao`, `After the ${days} days`),
    head: bi(
      `Dưới ${ceilingText}/khách thì tăng ngân sách, vượt thì tắt`,
      `Under ${ceilingText} a customer we raise it, over it we stop`),
    body: bi(
      `Hết đợt bên em đưa tiệm con số thật: chi bao nhiêu, được bao nhiêu khách mới, mỗi khách bao nhiêu. Dưới ${ceilingText} thì đáng tăng tiền trước mùa cao điểm; vượt ${ceilingText} thì bên em tắt và chuyển tiền đó sang nhắc khách cũ — rẻ hơn nhiều.`
        + (back ? ` Và mọi khách mới của đợt này đều được nhắn lại sau khoảng ${back} ngày, vì lãi thật nằm ở lần thứ hai họ quay lại chứ không phải lần đầu.` : ' Và mọi khách mới của đợt này đều được nhắn lại sau đó, vì lãi thật nằm ở lần thứ hai họ quay lại chứ không phải lần đầu.'),
      `At the end you get the real numbers: what was spent, how many new customers came, what each one cost. Under ${ceilingText} it is worth raising before the busy season; over ${ceilingText} we switch it off and move the money to reminding your past customers, which is far cheaper.`
        + (back ? ` Either way every new customer from this run is messaged again after about ${back} days, because the profit is in the second visit, not the first.` : ' Either way every new customer from this run is messaged again later, because the profit is in the second visit, not the first.')),
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
    figures: [
      { value: fmt(daily), label: bi('mỗi ngày', 'per day') },
      { value: fmt(total), label: bi(`cả đợt ${days} ngày`, `for ${days} days`) },
      { value: fmt(ceiling), label: bi('tối đa mỗi khách mới', 'max per new customer') },
    ],
    headline: bi('Muốn có khách ngay? Bên em đề xuất chạy thử', 'Want customers now? Here is what we suggest'),
    why: bi(
      (input.ticketEstimated
        ? 'Con số dưới đây tính theo BẢNG GIÁ của tiệm, chưa phải từ lịch hẹn thật — đủ để bắt đầu, và bên em chỉnh lại sau vài tuần khi có số thật. '
        : '')
      + `Một khách mới, sau khi trả công thợ, để lại cho tiệm khoảng ${fmt(ceiling)}. Nên chừng nào mỗi khách tốn dưới ${fmt(ceiling)} thì tiệm lãi ngay từ lần đầu họ tới.`
      // "khung giờ trống còn chỗ cho 717" was true arithmetic and unsayable to
      // a client. The figure is conservative now (see ad-capacity) and the
      // sentence says what it IS — extra visits the salon could take without
      // anyone waiting — rather than implying a measurement of empty hours.
      + (need ? ` Đợt này cần ${need} khách để lấy lại tiền${room ? `, và trong ${days} ngày tiệm nhận thêm được khoảng ${room} khách mà không ai phải chờ` : ''}.` : '')
      + ' Bên em chạy, theo dõi từng ngày, và tự tắt nếu vượt ngưỡng.',
      (input.ticketEstimated
        ? 'The figures below come from your PRICE LIST, not from bookings yet — enough to start with, and we correct them once real numbers arrive. '
        : '')
      + `A new customer leaves you about ${fmt(ceiling)} after the tech is paid. So as long as one costs less than ${fmt(ceiling)}, you are ahead on their very first visit.`
      + (need ? ` This run needs ${need} of them to get the money back${room ? `, and over ${days} days you could take about ${room} more without anyone waiting` : ''}.` : '')
      + ' We run it, watch it daily, and switch it off ourselves if it goes over the line.'),
    cta: bi(`Đồng ý — chạy thử ${days} ngày`, `Yes — run the ${days}-day test`),
    request: `Tiệm đồng ý chạy quảng cáo thử: ${fmt(daily)}/ngày × ${days} ngày (~${fmt(total)}) · ngưỡng ${fmt(ceiling)}/khách mới`,
  };
}
