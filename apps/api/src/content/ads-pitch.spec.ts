import { adsPitch } from './ads-pitch';
import { viOf, enOf, bi, type Txt } from './i18n';

const base = { ceilingCents: 3800, dailyCents: 1400, days: 14, totalCents: 19600, bookingsToBreakEven: 6, openSlots: 14, feasible: 'yes' as const };

describe('adsPitch', () => {
  it('offers three numbers and a yes, in the shop\'s own words', () => {
    const p = adsPitch(base);
    expect(p.state).toBe('offer');
    expect(p.figures.map((f) => f.value)).toEqual(['$14', '$196', '$38']);
    expect(viOf(p.why)).toMatch(/để lại cho tiệm khoảng \$38.*mỗi khách tốn dưới \$38 thì tiệm lãi ngay/);
    expect(viOf(p.why)).toMatch(/cần 6 khách để lấy lại tiền, và trong 14 ngày tiệm nhận thêm được khoảng 14 khách mà không ai phải chờ/);
    expect(viOf(p.cta!)).toBe('Đồng ý — chạy thử 14 ngày');
  });

  it('leaves the trade\'s vocabulary on the team\'s side of the wall', () => {
    const both = Object.values(adsPitch(base)).map((v) => JSON.stringify(v)).join(' ');
    expect(both).not.toMatch(/CPA|break-even CPA|hoà vốn CPA|feasib|lifetime|LTV|phép đo/i);
  });

  it('promises the switch-off before it is needed', () => {
    // The sentence that makes a yes safe to give has to be on the screen at
    // the moment of the yes, not produced later in an argument.
    expect(viOf(adsPitch(base).why)).toMatch(/tự tắt nếu vượt ngưỡng/);
    expect(enOf(adsPitch(base).why)).toMatch(/switch it off ourselves if it goes over the line/);
  });

  it('SAYS NO when there are not enough free chairs, and offers nothing', () => {
    // An agency that recommends advertising to every salon in every month is
    // an agency whose recommendation carries no information.
    const p = adsPitch({ ...base, feasible: 'no', bookingsToBreakEven: 20, openSlots: 4 });
    expect(p.state).toBe('not-yet');
    expect(p.cta).toBeNull();
    expect(p.request).toBeNull();
    expect(p.figures).toEqual([]);
    expect(viOf(p.why)).toMatch(/cần 20 khách.*chỉ nhận thêm được khoảng 4 khách.*mua khách không có ghế ngồi/);
    expect(viOf(p.why)).toMatch(/lấp chỗ trống bằng khách cũ trước/);
  });

  it('names the figure it is missing rather than guessing a budget', () => {
    const m = adsPitch({ ...base, ceilingCents: null, missing: 'margin' });
    expect(m.state).toBe('unknown');
    expect(m.cta).toBeNull();
    expect(viOf(m.why)).toMatch(/trả công thợ bao nhiêu phần trăm/);
    // Reaching 'unknown' on the ticket now means BOTH sources are empty: no
    // appointments here AND no priced menu. The old copy told the salon to wait
    // a few weeks for bookings, which is false for a shop that has traded for
    // years elsewhere and impossible for one that has not opened. It has to
    // name the thing that would actually fix it.
    const t = adsPitch({ ...base, ceilingCents: null, missing: 'ticket' });
    expect(viOf(t.why)).toMatch(/bảng giá dịch vụ/);
    expect(viOf(t.why)).not.toMatch(/chưa đủ lịch hẹn|vài tuần nữa/);

    // And when the ceiling DID come from the price list, the screen says so
    // rather than passing an estimate off as a measurement.
    const est = adsPitch({ ...base, ticketEstimated: true });
    expect(viOf(est.why)).toMatch(/BẢNG GIÁ/);
    const measured = adsPitch({ ...base, ticketEstimated: false });
    expect(viOf(measured.why)).not.toMatch(/BẢNG GIÁ/);
  });

  it('writes the line the team reads when the shop says yes', () => {
    expect(adsPitch(base).request).toBe('Tiệm đồng ý chạy quảng cáo thử: $14/ngày × 14 ngày (~$196) · ngưỡng $38/khách mới');
  });

  // ---- the plan itself: where, what, when, and then what -------------------

  const planned = {
    ...base,
    platform: { label: bi('Google (Tìm kiếm + Maps)', 'Google (Search + Maps)'), key: 'google' },
    secondPlatform: bi('Meta (Facebook + Instagram)', 'Meta (Facebook + Instagram)'),
    platformFromData: false,
    services: ['Gel manicure', 'Dip powder'],
    offerLine: bi('Giảm 15% khung trưa thứ Ba', '15% off Tuesday middays'),
    runDays: [bi('Thứ Hai', 'Monday'), bi('Thứ Ba', 'Tuesday')],
    pauseDays: [bi('Thứ Bảy', 'Saturday')],
    leadDays: 3,
    quietBlocks: [bi('Thứ Ba trưa', 'Tuesday midday')],
    returnDays: 35,
  };

  it('answers where the money goes, and why that channel first', () => {
    const s = adsPitch(planned).steps;
    expect(viOf(s[0].head)).toBe('Google (Tìm kiếm + Maps) trước, Meta (Facebook + Instagram) sau');
    expect(viOf(s[0].body)).toMatch(/nail salon near me/);
  });

  it('follows the salon\'s OWN bookings over the default order when it can', () => {
    const s = adsPitch({ ...planned, platformFromData: true }).steps;
    expect(viOf(s[0].body)).toMatch(/Khách của tiệm đang đến từ Google/);
    expect(viOf(s[0].body)).not.toMatch(/nail salon near me/);
  });

  it('sells the services that earn most per chair-hour, with the week\'s offer', () => {
    const s = adsPitch(planned).steps;
    expect(viOf(s[1].head)).toBe('Gel manicure và Dip powder — kèm Giảm 15% khung trưa thứ Ba');
    expect(viOf(s[1].body)).toMatch(/nhiều tiền nhất trên mỗi giờ ghế/);
  });

  it('names the days to run, the days to stop, and the hours to aim at', () => {
    const s = adsPitch(planned).steps;
    expect(viOf(s[2].head)).toBe('Bật Thứ Hai và Thứ Ba · tắt Thứ Bảy · nhắm vào khung Thứ Ba trưa');
    expect(viOf(s[2].body)).toMatch(/đặt trước khoảng 3 ngày/);
    expect(viOf(s[2].body)).toMatch(/Ngày đông thì tắt/);
  });

  it('says what happens after the run, in both directions, before the yes', () => {
    // "And then what" is the question an owner asks a week in. Answering it at
    // the moment of the yes is what separates a plan from a pitch.
    const s = adsPitch(planned).steps;
    const last = s[s.length - 1];
    expect(viOf(last.title)).toBe('Hết 14 ngày thì sao');
    expect(viOf(last.body)).toMatch(/Dưới \$38 thì đáng tăng tiền/);
    expect(viOf(last.body)).toMatch(/vượt \$38 thì bên em tắt/);
    expect(viOf(last.body)).toMatch(/nhắn lại sau khoảng 35 ngày/);
  });

  it('drops the steps it has no facts for rather than inventing reasons', () => {
    // Channel, service and schedule all need this salon's own data and are
    // absent without it. The two that remain need no data: what we do every
    // week, and what happens at the end. Those are the SERVICE — a promise the
    // agency makes, true whatever the shop's numbers say — and an agency that
    // goes quiet between the budget and day fourteen is the reason an owner
    // stops paying for one.
    const s = adsPitch(base).steps;
    expect(s.map((x) => viOf(x.title))).toEqual(['Mỗi tuần bên em làm gì', 'Hết 14 ngày thì sao']);
  });

  it('names the days of the weekly check, so it can be held to them', () => {
    const w = adsPitch(base).steps.find((x) => viOf(x.title) === 'Mỗi tuần bên em làm gì')!;
    expect(viOf(w.head)).toBe('Ngày thứ 7 và ngày thứ 14: bên em soi lại và báo tiệm bằng con số');
    expect(viOf(adsPitch({ ...base, days: 21 }).steps[0].head)).toMatch(/Ngày thứ 11 và ngày thứ 21/);
  });

  it('tells the owner what lands in their hand, and that it is short', () => {
    const w = adsPitch(base).steps.find((x) => viOf(x.title) === 'Mỗi tuần bên em làm gì')!;
    expect(viOf(w.when!)).toMatch(/Một tin nhắn ngắn có ba con số/);
    expect(viOf(w.body)).toMatch(/Tiệm không phải theo dõi gì cả/);
  });

  it('keeps the plan off the screen entirely when there is no offer', () => {
    expect(adsPitch({ ...planned, feasible: 'no' }).steps).toEqual([]);
    expect(adsPitch({ ...planned, ceilingCents: null }).steps).toEqual([]);
  });

  it('carries no team vocabulary into the plan either', () => {
    const s = JSON.stringify(adsPitch(planned).steps);
    expect(s).not.toMatch(/CPA|feasib|fillIndex|perHour|unproven|rank|status|verdict/i);
  });
});

/**
 * THE REFUSAL THAT WAS REMOVED, AND WHY IT MUST NOT COME BACK.
 *
 * This module used to answer a thin Google profile with "not the moment to put
 * money into ads" and no budget on screen. An agency owner running fifty-five
 * salons pushed back, and he was right: reviews come from customers, customers
 * come from traffic, advertising IS traffic — and a salon opening next month
 * has no customers by definition, so "reach twenty reviews first" is a loop
 * with no way in. Ads also buy awareness, which a review count says nothing
 * about.
 *
 * What survives is the true part, and it is a statement about the LANDING PAGE:
 * a stranger who taps an ad and opens a four-review profile reads the profile,
 * not the ad. So the finding changes where the click goes and what runs
 * alongside — never whether to spend.
 */
describe('a thin profile changes where the ads point, not whether they run', () => {
  const thin = {
    key: 'thin-google',
    because: bi('Hồ sơ còn mỏng.', 'The profile is thin.'),
    doNext: bi('Xin đánh giá từng khách làm xong', 'Ask each finished customer'),
  };

  it('STILL OFFERS the budget — the numbers do not disappear', () => {
    const p = adsPitch({ ...base, aim: thin });
    expect(p.state).toBe('offer');
    expect(p.figures.map((f) => f.value)).toEqual(['$14', '$196', '$38']);
    expect(p.cta).not.toBeNull();
  });

  it('never prints the old refusal', () => {
    const all = Object.values(adsPitch({ ...base, aim: thin })).map((v) => JSON.stringify(v)).join(' ');
    expect(all).not.toMatch(/Chưa nên đổ tiền quảng cáo|Not the moment to put money into ads/);
  });

  it('adds the step that decides whether the money works: where the tap lands', () => {
    const p = adsPitch({ ...base, aim: thin, platform: { label: bi('Google', 'Google'), key: 'google' } });
    const dest = p.steps.find((s) => viOf(s.title) === 'Bấm vào thì tới đâu');
    expect(dest).toBeDefined();
    expect(viOf(dest!.head)).toMatch(/tin nhắn hoặc link đặt lịch/);
    expect(viOf(dest!.body)).toMatch(/chưa đổ về trang Google|không đọc quảng cáo nữa/);
    // It comes AFTER the channel, because "which channel" is what an owner
    // asks first and "where does it land" is what decides the answer.
    expect(p.steps.indexOf(dest!)).toBe(1);
  });

  it('carries the review ask as something to do ALONGSIDE, not first', () => {
    const p = adsPitch({ ...base, aim: thin });
    expect(viOf(p.todo!)).toMatch(/Xin đánh giá/);
  });

  it('points a found-but-not-booked salon at the booking link instead', () => {
    const p = adsPitch({
      ...base,
      aim: { key: 'found-not-booked', because: bi('a', 'a'), doNext: bi('Bật link đặt lịch', 'Turn on the booking link') },
      platform: { label: bi('Google', 'Google'), key: 'google' },
    });
    expect(p.state).toBe('offer');
    const dest = p.steps.find((s) => viOf(s.title) === 'Bấm vào thì tới đâu')!;
    expect(viOf(dest.head)).toMatch(/link đặt lịch/);
    expect(viOf(dest.head)).not.toMatch(/tin nhắn/);
  });

  it('leaves a healthy salon’s plan exactly as it was', () => {
    const p = adsPitch({ ...base, platform: { label: bi('Google', 'Google'), key: 'google' } });
    expect(p.steps.some((s) => viOf(s.title) === 'Bấm vào thì tới đâu')).toBe(false);
    expect(p.todo ?? null).toBeNull();
  });

  it('still says no when there are no chairs — that one is about capacity, not trust', () => {
    // The one refusal that survives, and it is a different argument: buying
    // customers with nowhere to sit is waste whatever the profile looks like.
    const p = adsPitch({ ...base, aim: thin, feasible: 'no', bookingsToBreakEven: 20, openSlots: 4 });
    expect(p.state).toBe('not-yet');
    expect(viOf(p.why)).toMatch(/mua khách không có ghế ngồi/);
  });
});

/**
 * "Chưa thuyết phục, quá ít dữ liệu."
 *
 * The block stated a conclusion and showed none of its working, so there was
 * no way to tell a well-founded recommendation from a guess — and no way for
 * the person reading it to argue with the input instead of the output. The
 * sources now travel with the answer, in every state, silence included.
 */
describe('the recommendation shows what it was read from', () => {
  const basis = [
    { label: bi('Một lần khách tới thu', 'Per visit'), value: bi('$65', '$65'), known: true },
    { label: bi('Hồ sơ Google', 'Google profile'), value: bi('chưa nối', 'not connected'), known: false },
  ];

  it('carries the sources on an offer', () => {
    expect(adsPitch({ ...base, basis })?.basis).toHaveLength(2);
  });

  it('carries them on a refusal too — that is when they matter most', () => {
    const p = adsPitch({ ...base, basis, feasible: 'no', bookingsToBreakEven: 20, openSlots: 4 });
    expect(p.state).toBe('not-yet');
    expect(p.basis).toHaveLength(2);
  });

  it('carries them when it cannot size a budget at all', () => {
    const p = adsPitch({ ...base, basis, ceilingCents: 0, missing: 'ticket' });
    expect(p.state).toBe('unknown');
    expect(p.basis).toHaveLength(2);
  });

  it('LISTS THE SILENT SOURCES rather than dropping them', () => {
    // A list of only the things that answered looks complete and is not. The
    // gap is the useful part: it names what to connect next.
    const out = adsPitch({ ...base, basis }).basis!;
    expect(out.filter((b) => !b.known)).toHaveLength(1);
    expect(viOf(out.find((b) => !b.known)!.value)).toBe('chưa nối');
  });
});

/**
 * THE SENTENCE THAT GOES IN FRONT OF A PAYING CLIENT.
 *
 * The block said "your quiet hours have room for 717". True arithmetic, and
 * the agency owner who has to read it aloud to a salon said, correctly, that
 * he could not defend it. A recommendation is only as good as the least
 * defensible number in it.
 */
describe('the capacity sentence is one an agency can say out loud', () => {
  it('never claims empty HOURS — it claims extra customers, which is what was measured', () => {
    const vi = viOf(adsPitch(base).why);
    expect(vi).not.toMatch(/khung giờ trống của tiệm còn chỗ cho/);
    expect(vi).toMatch(/nhận thêm được khoảng 14 khách mà không ai phải chờ/);
  });

  it('ties the room to the campaign length, so the figure has a window on it', () => {
    expect(viOf(adsPitch({ ...base, days: 21 }).why)).toMatch(/trong 21 ngày/);
  });

  it('drops the clause entirely rather than printing a room it does not have', () => {
    const p = adsPitch({ ...base, openSlots: null, feasible: 'unknown' });
    expect(viOf(p.why)).toMatch(/cần 6 khách để lấy lại tiền\./);
    expect(viOf(p.why)).not.toMatch(/nhận thêm được/);
    // And it still offers: not knowing the room is not a reason to refuse.
    expect(p.state).toBe('offer');
  });
});

/**
 * "Meta sau — tức là khi nào?"
 *
 * The step said "Google trước, Meta sau" and offered nothing further: no day,
 * no number, nothing that could come true. An agency owner asked the question
 * and there was no answer on the screen to give him. An ordering with no
 * trigger is not a plan, and it is worst of all for the person who has to
 * explain it to a paying client.
 */
describe('the second channel has a condition, not just a position', () => {
  const two = {
    ...base,
    platform: { label: bi('Google', 'Google'), key: 'google' },
    secondPlatform: bi('Meta', 'Meta'),
    provingBookings: 8,
  };
  const channelStep = (p: ReturnType<typeof adsPitch>) => p.steps.find((s) => viOf(s.title) === 'Chạy ở kênh nào')!;

  it('names the day, the number and the money threshold', () => {
    const w = viOf(channelStep(adsPitch(two)).when!);
    expect(w).toMatch(/ngày thứ 7/);
    expect(w).toMatch(/8 booking trở lên/);
    expect(w).toMatch(/\$38/); // the salon's own ceiling, not a generic figure
  });

  it('says what happens on BOTH answers, not only on success', () => {
    const w = viOf(channelStep(adsPitch(two)).when!);
    expect(w).toMatch(/→ Đúng cả hai: bên em mở Meta, ngân sách bằng một nửa Google/);
    expect(w).toMatch(/→ Chưa đúng: giữ nguyên Google và sửa cho đạt trước/);
  });

  it('ADMITS the order is not from this salon when it is not', () => {
    // The order for a shop with no attributed bookings is a starting rule.
    // Presenting a default as a reading is how an agency loses an argument
    // with its own client.
    const b = viOf(channelStep(adsPitch(two)).body);
    expect(b).toMatch(/chưa phải từ số liệu của tiệm/);
    expect(b).toMatch(/chưa có booking nào ghi nhận từ Google hay Meta/);
  });

  it('drops that admission once the salon’s own bookings chose the order', () => {
    const b = viOf(channelStep(adsPitch({ ...two, platformFromData: true })).body);
    expect(b).not.toMatch(/chưa phải từ số liệu của tiệm/);
    expect(b).toMatch(/Khách của tiệm đang đến từ Google nhiều hơn/);
  });

  it('states no condition when there is no second channel to move to', () => {
    expect(channelStep(adsPitch({ ...two, secondPlatform: null })).when ?? null).toBeNull();
  });

  it('still gives a usable test when the proving number is unknown', () => {
    const w = viOf(channelStep(adsPitch({ ...two, provingBookings: null })).when!);
    expect(w).toMatch(/đủ booking để đọc được/);
    expect(w).toMatch(/\$38/);
  });
});

/**
 * THE CARD IS AN AGENCY'S WORK, AND IT IS READ BY SOMEBODY WHO IS NOT A MARKETER.
 *
 * The salon hired an agency precisely so they would not have to understand ad
 * platforms. Everything on this card is therefore judged by one test: would an
 * owner read it, and does it read as though a person wrote it?
 *
 * The failure this guards against is specific and was real. The condition
 * paragraph named its channels in full — "Google (Tìm kiếm + Maps)", "Meta
 * (Facebook + Instagram)" — nine times in one block of text. Nobody reads that,
 * and an agency that sends it looks like it did not read its own output.
 */
describe('the card reads like an agency wrote it', () => {
  const two = {
    ...base,
    platform: { label: bi('Google (Tìm kiếm + Maps)', 'Google (Search + Maps)'), key: 'google' },
    platformShort: bi('Google', 'Google'),
    secondPlatform: bi('Meta (Facebook + Instagram)', 'Meta (Facebook + Instagram)'),
    secondShort: bi('Meta', 'Meta'),
    provingBookings: 8,
  };
  const step = (t: string) => adsPitch(two).steps.find((s) => viOf(s.title) === t)!;

  it('uses the SHORT channel name inside sentences', () => {
    const w = viOf(step('Chạy ở kênh nào').when!);
    expect(w).toMatch(/\bGoogle\b/);
    expect(w).toMatch(/\bMeta\b/);
    // The long parenthetical belongs on the headline, said once.
    expect(w).not.toMatch(/Tìm kiếm \+ Maps/);
    expect(w).not.toMatch(/Facebook \+ Instagram/);
  });

  it('states the full name exactly once, where it explains what the channel covers', () => {
    const head = viOf(step('Chạy ở kênh nào').head);
    expect(head.match(/Tìm kiếm \+ Maps/g) ?? []).toHaveLength(1);
  });

  it('breaks the condition into lines a person can follow, not one paragraph', () => {
    const w = viOf(step('Chạy ở kênh nào').when!);
    const lines = w.split('\n').filter(Boolean);
    expect(lines).toHaveLength(5); // the check, two tests, two answers
    expect(lines[1]).toMatch(/^1\./);
    expect(lines[2]).toMatch(/^2\./);
    expect(lines[3]).toMatch(/^→/);
    expect(lines[4]).toMatch(/^→/);
  });

  it('keeps every sentence short enough to be read once', () => {
    // A 60-word sentence is where an owner stops reading and starts trusting
    // nothing on the page.
    for (const s of adsPitch(two).steps) {
      for (const field of [s.head, s.body, s.when].filter(Boolean) as Txt[]) {
        for (const sentence of viOf(field).split(/[.!?]\s|\n/)) {
          expect(sentence.trim().split(/\s+/).length).toBeLessThan(60);
        }
      }
    }
  });

  it('NEVER tells an owner his Google customers do not exist', () => {
    // "Chưa có booking nào từ Google" to a salon that watches Google customers
    // walk in every week is how a screen loses its reader for good. The book is
    // silent because most Maps arrivals carry no trace — not because nobody came.
    const all = JSON.stringify(adsPitch(two));
    expect(all).not.toMatch(/Chưa có booking nào/);
  });
});

describe('the box over a condition says what kind of box it is', () => {
  it('calls the channel test a condition, and the weekly promise a deliverable', () => {
    const p = adsPitch({
      ...base,
      platform: { label: bi('Google', 'Google'), key: 'google' },
      platformShort: bi('Google', 'Google'),
      secondShort: bi('Meta', 'Meta'), secondPlatform: bi('Meta', 'Meta'),
      provingBookings: 8,
    });
    const ch = p.steps.find((s) => viOf(s.title) === 'Chạy ở kênh nào')!;
    const wk = p.steps.find((s) => viOf(s.title) === 'Mỗi tuần bên em làm gì')!;
    expect(viOf(ch.whenTitle!)).toBe('Khi nào mở kênh thứ hai');
    // A promise printed under "what has to be true first" reads as a hurdle,
    // which is the opposite of a promise.
    expect(viOf(wk.whenTitle!)).toBe('Tiệm nhận được gì');
  });
});
