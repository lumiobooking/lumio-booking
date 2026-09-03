import { buildOnboardingReport, type OnboardingInput } from './onboarding-report';
import { bi, type Txt } from './i18n';

const viOf = (t: Txt) => (typeof t === 'string' ? t : t.vi);
const enOf = (t: Txt) => (typeof t === 'string' ? t : t.en);

/** A shop we know nothing about — the state every salon starts in. */
const bare = (over: Partial<OnboardingInput> = {}): OnboardingInput => ({
  shopName: 'Lux Nail Spa',
  tradeLabel: bi('tiệm nail', 'nail salon'),
  region: { label: 'chưa rõ khu vực', city: null, regionKnown: false },
  identity: { declared: false, filled: 0, profile: {} },
  services: [],
  website: null,
  facebookConnected: false,
  gbpConnected: false,
  scan: null,
  seo: { measured: 0, unknown: 5, failing: 0 },
  tier: 'medium',
  weeksToGoal: { map: [20, 34], web: [37, 67] },
  todo: Array.from({ length: 14 }, (_, i) => ({
    id: `t${i}`, title: bi(`Việc ${i}`, `Job ${i}`), minutes: 60, track: i < 8 ? 'map' : 'web',
  })),
  keywords: { primary: ['nail salon {city}', 'tiệm nail gần đây'], pages: 9 },
  ...over,
});

/** A shop that has been set up properly. */
const settled = (over: Partial<OnboardingInput> = {}): OnboardingInput => bare({
  region: { label: 'Garden Grove, CA', city: 'Garden Grove', regionKnown: true },
  identity: { declared: true, filled: 5, profile: { whatWeDo: 'Tiệm nail, chuyên gel-X', whoWeServe: 'Khách Việt và Mỹ quanh Garden Grove', edge: 'Mở tới 8h tối' } },
  services: [{ name: 'Gel-X' }, { name: 'Pedicure' }, { name: 'Dip powder' }],
  website: 'luxnailspa.com',
  facebookConnected: true,
  gbpConnected: true,
  scan: { at: '2026-09-01T00:00:00Z', ok: true },
  seo: { measured: 5, unknown: 0, failing: 1 },
  ...over,
});

describe('the report says how much of itself is real', () => {
  it('calls a shop it knows nothing about thin, and says not to send it', () => {
    // The whole point. The plan for a shop we have never looked at is identical
    // to the plan for one we know everything about — so the report has to say
    // which it is, before the reader gets any further.
    const r = buildOnboardingReport(bare());
    expect(r.confidence).toBe('thin');
    expect(viOf(r.confidenceNote)).toMatch(/KHÔNG phải bản phân tích riêng/);
    expect(viOf(r.confidenceNote)).toMatch(/Đừng gửi cho khách/);
  });

  it('calls a properly set-up shop solid', () => {
    expect(buildOnboardingReport(settled()).confidence).toBe('solid');
  });

  it('moves through partial as the gaps close, one at a time', () => {
    const steps = [
      bare(),
      bare({ region: { label: 'Houston, TX', city: 'Houston', regionKnown: true }, services: [{ name: 'Pedicure' }] }),
      settled(),
    ].map((i) => buildOnboardingReport(i).confidence);
    expect(steps).toEqual(['thin', 'partial', 'solid']);
  });
});

describe('every claim is filed as known or as unknown, never in between', () => {
  it('states nothing about a shop it has not looked at', () => {
    const r = buildOnboardingReport(bare());
    expect(r.known).toHaveLength(0);
    // And the gaps are all named, rather than quietly omitted.
    expect(r.unknowns.length).toBeGreaterThanOrEqual(5);
  });

  it('carries a source with every fact', () => {
    // A fact with no provenance is an opinion, and an opinion in this list is
    // indistinguishable from a measurement by the time it reaches a client.
    const r = buildOnboardingReport(settled());
    expect(r.known.length).toBeGreaterThan(0);
    for (const k of r.known) {
      expect(viOf(k.source).length).toBeGreaterThan(0);
      expect(k.value.length).toBeGreaterThan(0);
    }
  });

  it('names the service list as hard data and the shop\'s own words as claims', () => {
    // These are not the same kind of fact, and flattening them is how a
    // marketing sentence ends up quoted back as a measurement.
    const r = buildOnboardingReport(settled());
    const services = r.known.find((k) => viOf(k.label).includes('Dịch vụ'));
    const edge = r.known.find((k) => viOf(k.label).includes('Điểm mạnh'));
    expect(viOf(services!.source)).toMatch(/số liệu thật/);
    expect(viOf(edge!.source)).toMatch(/hồ sơ tiệm/);
  });

  it('gives every gap both a cost and one way to close it', () => {
    // A gap with no cost gets ignored; a gap with no action gets resented.
    for (const u of buildOnboardingReport(bare()).unknowns) {
      expect(viOf(u.cost).length).toBeGreaterThan(20);
      expect(viOf(u.unlock).length).toBeGreaterThan(10);
    }
  });

  it('is honest that operating history cannot be connected, only waited for', () => {
    const history = buildOnboardingReport(settled()).unknowns.find((u) => viOf(u.label).includes('lịch sử'));
    expect(history).toBeTruthy();
    expect(viOf(history!.unlock)).toMatch(/Không nối được/);
  });

  it('puts the Google profile at the top of the gap list, because it costs the most', () => {
    const r = buildOnboardingReport(bare());
    expect(viOf(r.unknowns[0].label)).toMatch(/Google Business Profile/);
  });
});

describe('the starting point is coverage, not a grade', () => {
  it('refuses to report a score when nothing was measured', () => {
    const r = buildOnboardingReport(bare());
    expect(viOf(r.start.verdict)).toMatch(/Chưa chấm được mục nào/);
    expect(viOf(r.start.verdict)).toMatch(/Chưa có điểm khởi đầu/);
  });

  it('counts what is broken out of what could be seen, not out of everything', () => {
    // "1 hỏng trên 5" and "1 hỏng trên 5 đo được, 0 chưa thấy" are different
    // statements, and only one of them survives a client asking questions.
    const r = buildOnboardingReport(settled());
    expect(viOf(r.start.verdict)).toMatch(/1 mục đang hỏng trong 5 mục đo được/);
  });

  it('will not call a partly-seen shop clean', () => {
    const r = buildOnboardingReport(settled({ seo: { measured: 2, unknown: 3, failing: 0 } }));
    expect(viOf(r.start.verdict)).toMatch(/3 mục chưa nhìn thấy/);
  });
});

describe('the first month is a month somebody can actually work', () => {
  it('fills four weeks and leaves none of them empty', () => {
    const r = buildOnboardingReport(bare());
    expect(r.firstMonth).toHaveLength(4);
    for (const w of r.firstMonth) expect(w.tasks.length).toBeGreaterThan(0);
  });

  it('keeps a week inside a workload a salon owner can absorb', () => {
    // A first week holding twenty hours is a first week nobody starts, and a
    // plan nobody starts is worse than no plan — it burns the one attempt.
    const r = buildOnboardingReport(bare());
    for (const w of r.firstMonth) expect(w.minutes).toBeLessThanOrEqual(260);
  });

  it('takes the jobs in roadmap order rather than reshuffling them', () => {
    const r = buildOnboardingReport(bare());
    const ids = r.firstMonth.flatMap((w) => w.tasks.map((t) => t.id));
    expect(ids).toEqual([...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it('still produces four weeks when there is barely any work left', () => {
    const r = buildOnboardingReport(bare({ todo: [{ id: 'only', title: bi('Một việc', 'One job'), minutes: 30, track: 'map' }] }));
    expect(r.firstMonth).toHaveLength(4);
    expect(r.firstMonth[0].tasks).toHaveLength(1);
    expect(r.firstMonth[3].tasks).toHaveLength(0);
  });
});

describe('what the report promises, and what it refuses to promise', () => {
  it('quotes work time and says out loud that it is not a ranking promise', () => {
    const p = viOf(buildOnboardingReport(bare()).promise);
    expect(p).toMatch(/không phải lời hứa thứ hạng/i);
    expect(p).toMatch(/khoảng cách/); // proximity, the factor nobody controls
  });

  it('quotes the website track as the longer of the two', () => {
    const p = viOf(buildOnboardingReport(bare()).promise);
    const nums = [...p.matchAll(/([\d.]+)–([\d.]+) tháng/g)].map((m) => Number(m[2]));
    expect(nums).toHaveLength(2);
    expect(nums[1]).toBeGreaterThan(nums[0]);
  });

  it('names its own blind spots rather than implying a full audit', () => {
    const c = viOf(buildOnboardingReport(settled()).caveat);
    expect(c).toMatch(/tốc độ/);
    expect(c).toMatch(/backlink/);
    expect(c).toMatch(/thứ hạng thật/);
  });

  it('writes the whole report twice, so an English-reading client can read it', () => {
    const r = buildOnboardingReport(settled());
    const both = [r.confidenceNote, r.promise, r.caveat, r.start.verdict, ...r.unknowns.map((u) => u.cost)];
    for (const t of both) {
      expect(enOf(t).length).toBeGreaterThan(10);
      expect(enOf(t)).not.toBe(viOf(t));
    }
  });
});
