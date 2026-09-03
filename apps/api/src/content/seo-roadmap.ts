/**
 * The Google Maps roadmap, as a thing you tick off.
 *
 * WHY A CHECKLIST AND NOT ANOTHER REPORT
 *
 * seo-local.ts already tells a salon what is wrong. It does not say what to do
 * first, and it holds no memory — so every visit restarts the diagnosis and
 * the work never accumulates. This is the other half: an ordered list of jobs
 * with a state, so an agency can walk one client through six months and see at
 * a glance where they stopped.
 *
 * THE THING THAT MAKES IT WORTH BUILDING HERE RATHER THAN IN A SPREADSHEET
 *
 * Some of these boxes tick THEMSELVES. This platform already counts a salon's
 * reviews, their arrival rate, the share replied to, whether Google returns
 * keywords for the profile, and how many bookings came from search. A task
 * tied to one of those is answered by measurement, not by someone's memory of
 * whether they did it — and a checklist that lies about its own state is worse
 * than no checklist, because people trust it.
 *
 * THREE THINGS THE FIRST VERSION GOT WRONG
 *
 * 1. It treated every market the same. A shop in a town of twenty-five
 *    thousand and a shop in a street with fifty nail bars need different
 *    plans, and selling the small-town plan into Little Saigon is how an
 *    agency loses a client in month three. Every task now declares which
 *    competition tiers it belongs to.
 *
 * 2. It let a recurring job be ticked once and stay green forever. "Post two
 *    or three times a week" done in March is not done in June — and a board
 *    showing it green is lying about the single habit the whole strategy rests
 *    on. Recurring tasks now expire with their period.
 *
 * 3. It had no dates. A roadmap with no expected duration cannot be sold, and
 *    cannot be held to account. Each phase now carries a realistic week range
 *    per tier, so the board can say "about eleven more weeks" instead of
 *    "keep going".
 *
 * ORDER IS THE PRODUCT
 *
 * Phases are a real sequence, not decoration: the profile is worth roughly a
 * third of everything controllable and reviews a fifth, while website and
 * links together are under a third and cost the most. An agency that sells a
 * website in month one is selling the least effective thing first.
 */

import { bi, type Txt } from './i18n';

/**
 * How crowded this shop's map is.
 *
 * Declared by the operator after looking, not inferred: the honest input is
 * "how many competitors are in the three-result pack area", and nothing in
 * this codebase can count that. Defaults to 'medium' — being told to do
 * slightly too much is a smaller failure than being told to do too little and
 * wondering for six months why nothing moved.
 */
export type Tier = 'low' | 'medium' | 'high';
export const TIERS: Tier[] = ['low', 'medium', 'high'];

export const TIER_LABEL: Record<Tier, Txt> = {
  low: bi('Thị trấn nhỏ · dưới 10 tiệm cùng ngành trong 5 dặm',
          'Small town · fewer than 10 same-trade shops within 5 miles'),
  medium: bi('Ngoại ô / thành phố vừa · 10–30 tiệm trong 5 dặm',
             'Suburb or mid-size city · 10–30 shops within 5 miles'),
  high: bi('Khu dày đặc · trên 30 tiệm trong 5 dặm (Little Saigon, Houston, San Jose…)',
           'Dense cluster · more than 30 shops within 5 miles'),
};

/** How often a job comes back around. A job that never expires is a job that
 *  gets ticked once and then quietly stops happening. */
/**
 * Two jobs that share nothing but a client.
 *
 * The map and the website rank by different machinery on different clocks:
 * a profile fix can move the pack in weeks, while a page earns its position
 * over months. Mixing them into one list made the slow work look broken and
 * the fast work look finished — so they are separate tracks with separate
 * progress, and a salon can be at week two on one and month six on the other.
 */
export type Track = 'map' | 'web';
export const TRACKS: Track[] = ['map', 'web'];

export type Cadence = 'once' | 'weekly' | 'monthly' | 'quarterly';
export type TaskKind = 'manual' | 'check';

export interface RoadmapTask {
  id: string;
  track: Track;
  phase: number;
  title: Txt;
  /** How to actually do it — concrete enough to hand to salon staff. */
  how: Txt;
  /** Why this one, before the tidier-looking things. */
  why: Txt;
  kind: TaskKind;
  cadence: Cadence;
  /** Which competition tiers this job belongs to. */
  tiers: Tier[];
  /**
   * For `check` tasks: the seo-local check whose verdict decides this, and
   * which states count as done. A check that comes back 'unknown' leaves the
   * task neither done nor failed — "we cannot see this yet" is its own state
   * and must never be painted as failure.
   */
  from?: { key: string; doneOn: ('pass' | 'warn')[] };
  minutes?: number;
}

export interface RoadmapPhase {
  track: Track;
  n: number;
  title: Txt;
  goal: Txt;
  /** The measurable thing that says this phase is finished. */
  target: Txt;
  /** Realistic weeks to clear this phase, per tier. Ranges, never a promise. */
  weeks: Record<Tier, [number, number]>;
}

export const PHASES: RoadmapPhase[] = [
  {
    track: 'map',
    n: 0,
    title: bi('Đo được đã', 'Get something you can measure'),
    goal: bi('Chưa biết tiệm đang đứng ở đâu thì mọi việc sau đó là phỏng đoán.',
             'Until you know where the shop stands, everything after is guesswork.'),
    target: bi('Có một tấm lưới điểm ngày số 0 và một con số booking gốc.',
               'A day-zero geogrid image and a baseline booking number, both saved.'),
    weeks: { low: [1, 1], medium: [1, 2], high: [1, 2] },
  },
  {
    track: 'map',
    n: 1,
    title: bi('Hồ sơ đúng đã', 'Get the profile right'),
    goal: bi('Hồ sơ Google chiếm khoảng một phần ba tất cả những gì mình can thiệp được — và phần lớn chỉ là điền cho đúng.',
             'The Google profile is about a third of everything you control, and most of it is just filling fields in correctly.'),
    target: bi('Không còn ô trống nào trong hồ sơ, và lưới điểm bắt đầu hiện tiệm ở vài điểm gần tiệm.',
               'No empty fields left, and the grid starts showing the shop at points near it.'),
    weeks: { low: [2, 4], medium: [3, 5], high: [3, 6] },
  },
  {
    track: 'map',
    n: 2,
    title: bi('Nhịp đánh giá', 'Build the review rhythm'),
    goal: bi('Nhịp đều thắng số lượng lớn nhưng cũ. Đây là quãng dài nhất và là quãng thắng thua.',
             'A steady trickle beats a large but stale pile. The longest stretch, and where it is won.'),
    target: bi('Bốn tuần liên tiếp tuần nào cũng có đánh giá mới, và không còn đánh giá nào chưa trả lời.',
               'Four straight weeks with a new review in each, and nothing left unanswered.'),
    weeks: { low: [6, 10], medium: [10, 16], high: [12, 20] },
  },
  {
    track: 'map',
    n: 3,
    title: bi('Hơn đối thủ ở chỗ cụ thể', 'Beat the shops above you, specifically'),
    goal: bi('Ở khu cạnh tranh, ba tiệm trên đầu đều đã làm đúng phần cơ bản. "Làm đủ" không còn nghĩa gì — phải hơn họ ở chỗ đếm được.',
             'Where it is crowded, the three shops above you already have the basics right. "Doing enough" means nothing — you must beat them somewhere countable.'),
    target: bi('Có bảng đối chiếu với 3 đối thủ, và hơn họ ở ít nhất 3 mục đo được.',
               'A filled comparison against three rivals, and a lead in at least three countable fields.'),
    weeks: { low: [2, 4], medium: [4, 8], high: [6, 12] },
  },
  {
    track: 'map',
    n: 4,
    title: bi('Uy tín ngoài hồ sơ', 'Authority outside the profile'),
    goal: bi('Backlink và citation cộng lại khoảng 14–22%. Đắt và chậm — nhưng ở khu dày đặc đây là chỗ còn trống, vì hầu như không tiệm nail nào làm.',
             'Links and citations together are roughly 14–22%. Expensive and slow — but in a crowded area this is the open ground, because almost no nail shop does it.'),
    target: bi('8–12 link địa phương thật, citation sạch và nhất quán ở các nguồn gốc.',
               'Eight to twelve real local links, and clean consistent citations at the source aggregators.'),
    weeks: { low: [0, 0], medium: [8, 16], high: [12, 24] },
  },
  {
    track: 'map',
    n: 5,
    title: bi('Giữ hạng', 'Hold it'),
    goal: bi('Hạng 1 rớt trong im lặng — không có thông báo nào, và doanh thu giảm sau thứ hạng vài tháng.',
             'First place slips quietly — nothing tells you, and revenue falls months after the ranking does.'),
    target: bi('Không bao giờ xong. Đây là chi phí duy trì, và là lý do bán được gói tháng.',
               'Never finished. This is the maintenance cost, and the reason a monthly retainer exists.'),
    weeks: { low: [0, 0], medium: [0, 0], high: [0, 0] },
  },
];

// ---- the website track ------------------------------------------------------
//
// A different machine on a different clock. The map rewards a correct profile
// and a steady trickle of reviews; the website rewards pages that answer a
// question better than the pages above them, and that takes months rather than
// weeks. Selling one timeline for both is how a client concludes in month
// three that nothing is working.
//
// The on-page phase is written against the agency's own P-series checklist, so
// the task text cites P-codes directly — the person doing the work already has
// that checklist, and a second vocabulary for the same job helps nobody.
//
// EVERYTHING HERE IS HAND WORK. No bought links, no paid directories, no
// purchased traffic. That is partly the client's instruction and partly the
// evidence: bulk directory links are ignored or penalised, and bought traffic
// is bots, which teaches Google nothing except that people leave immediately.

export const WEB_PHASES: RoadmapPhase[] = [
  {
    track: 'web', n: 0,
    title: bi('Gắn dụng cụ đo — miễn phí', 'Fit the free instruments'),
    goal: bi('Search Console cho biết khách gõ gì để tới website — dữ liệu thật của Google, miễn phí, và không có nó thì mọi việc SEO sau đó là đoán.',
             'Search Console tells you what people typed to reach the site — real Google data, free, and without it everything after is guesswork.'),
    target: bi('Search Console và Analytics đã chạy, có ít nhất 7 ngày dữ liệu.',
               'Search Console and Analytics running, with at least seven days of data.'),
    weeks: { low: [1, 1], medium: [1, 2], high: [1, 2] },
  },
  {
    track: 'web', n: 1,
    title: bi('Bản đồ từ khóa', 'Map the keywords'),
    goal: bi('Mỗi từ khóa một trang, mỗi trang một từ khóa. Hai trang cùng nhắm một từ là hai trang tự cắn nhau và không trang nào lên.',
             'One keyword, one page, one page, one keyword. Two pages aiming at one term fight each other and neither wins.'),
    target: bi('Có bảng: từ khóa → trang đích → ý định, và không từ khóa nào bị hai trang tranh.',
               'A table of keyword → landing page → intent, with no term contested by two pages.'),
    weeks: { low: [1, 2], medium: [2, 3], high: [2, 4] },
  },
  {
    track: 'web', n: 2,
    title: bi('Onpage trang tiền', 'On-page the money pages'),
    goal: bi('Làm đúng checklist P-series cho 3–5 trang ra tiền trước. Onpage một trang chưa đạt chất lượng là đốt công — P0 phải pass trước.',
             'Run the P-series checklist on the three to five pages that earn, first. On-paging a page that fails the quality gate is wasted work — P0 comes first.'),
    target: bi('Mỗi trang tiền đạt tối thiểu 18/23 Tier 1, không còn ❌ ở P1, P2, P5, P8, P9.',
               'Each money page scores at least 18/23 on Tier 1, with no fails on P1, P2, P5, P8 or P9.'),
    weeks: { low: [3, 5], medium: [4, 8], high: [6, 10] },
  },
  {
    track: 'web', n: 3,
    title: bi('Nội dung vệ tinh và liên kết nội bộ', 'Supporting content and internal links'),
    goal: bi('Một trang đứng một mình không lên được từ khóa cạnh tranh. Nó cần một cụm bài xung quanh trỏ vào, và đó là công việc hàng tháng.',
             'A page standing alone does not win a competitive term. It needs a cluster around it pointing in, and that is monthly work.'),
    target: bi('Mỗi trang tiền có ít nhất 3 bài vệ tinh trỏ vào, và mỗi bài có 5–10 internal link.',
               'Each money page has at least three supporting articles pointing at it, and each article carries five to ten internal links.'),
    weeks: { low: [8, 12], medium: [12, 20], high: [16, 28] },
  },
  {
    track: 'web', n: 4,
    title: bi('Uy tín ngoài site — làm tay, không mua', 'Off-site authority — earned, never bought'),
    goal: bi('Link kiếm bằng quan hệ thật và việc thật. Chậm hơn mua, nhưng không bị phạt và không mất khi ngừng trả tiền.',
             'Links earned through real relationships and real work. Slower than buying, but it cannot be penalised and does not vanish when you stop paying.'),
    target: bi('8–12 link địa phương thật, nhịp 5–10 link/tháng, không có link nào mua.',
               'Eight to twelve genuine local links, at five to ten a month, none of them bought.'),
    weeks: { low: [8, 12], medium: [12, 20], high: [16, 32] },
  },
  {
    track: 'web', n: 5,
    title: bi('Đo, sửa, giữ', 'Measure, fix, hold'),
    goal: bi('SEO website không có vạch đích. Trang lên rồi vẫn tụt nếu đối thủ viết tốt hơn hoặc nội dung mình cũ đi.',
             'Website SEO has no finish line. A page that rose still falls if a rival writes better or the content ages.'),
    target: bi('Không bao giờ xong — mỗi tháng một vòng đo và một vòng cập nhật bài cũ.',
               'Never finished — one measuring round and one refresh round every month.'),
    weeks: { low: [0, 0], medium: [0, 0], high: [0, 0] },
  },
];

const ALL: Tier[] = ['low', 'medium', 'high'];
const CROWDED: Tier[] = ['medium', 'high'];
const DENSE: Tier[] = ['high'];

export const TASKS: RoadmapTask[] = [
  // ---- phase 0: measurement ------------------------------------------------
  {
    id: 'verify-gbp', track: 'map', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 20,
    title: bi('Xác minh và nhận quyền sở hữu hồ sơ Google', 'Verify and claim the Google profile'),
    how: bi('Vào google.com/business, tìm tiệm, làm theo bước xác minh. Nếu hồ sơ đang do người khác giữ thì nộp yêu cầu lấy lại quyền.',
            'Go to google.com/business, find the shop, follow the steps. If somebody else holds it, file a request to reclaim ownership.'),
    why: bi('Chưa xác minh thì không sửa được gì cả — mọi việc bên dưới đều bắt đầu từ đây.',
            'Nothing below can be done until this is. Every other task starts here.'),
  },
  {
    id: 'connect-gbp', track: 'map', phase: 0, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'keyword-match', doneOn: ['pass', 'warn'] },
    title: bi('Kết nối hồ sơ Google vào Lumio', 'Connect the Google profile to Lumio'),
    how: bi('Cài đặt → Google Reviews → kết nối. Sau khi kết nối, Google trả về danh sách từ khoá khách gõ để tìm tiệm.',
            'Settings → Google Reviews → connect. Google then returns the words people actually search to find the shop.'),
    why: bi('Không biết khách gõ gì thì mọi việc tối ưu sau đó chỉ là phỏng đoán.',
            'Without knowing what people type, every optimisation after this is a guess.'),
  },
  {
    id: 'baseline-grid', track: 'map', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Đo lưới điểm "ngày số 0"', 'Take the day-zero geogrid'),
    how: bi('Local Falcon hoặc BrightLocal, lưới 3–5 từ khoá chính trong bán kính 3 dặm. Lưu ảnh kèm ngày.',
            'Local Falcon or BrightLocal, three to five core keywords across a three-mile radius. Save the image with the date.'),
    why: bi('Ba tháng nữa không có cái này thì không chứng minh được với khách là mình đã làm được gì.',
            'Without it, in three months there is no way to show the client what the work achieved.'),
  },
  {
    id: 'set-tier', track: 'map', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 15,
    title: bi('Đếm đối thủ và chọn đúng mức cạnh tranh', 'Count the rivals and set the competition tier'),
    how: bi('Mở Google Maps, tìm từ khoá chính, đếm số tiệm cùng ngành trong bán kính 5 dặm. Chọn mức ở đầu trang này.',
            'Open Google Maps, search the core keyword, count same-trade shops within five miles. Set the tier at the top of this board.'),
    why: bi('Chọn sai mức là chọn sai cả lộ trình lẫn lời hứa về thời gian. Đây là việc quyết định mọi thứ phía sau.',
            'The wrong tier means the wrong plan and the wrong promise about time. This decides everything after it.'),
  },
  {
    id: 'baseline-bookings', track: 'map', phase: 0, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'search-share', doneOn: ['pass', 'warn'] },
    title: bi('Ghi lại số booking đang đến từ tìm kiếm', 'Record how many bookings search brings today'),
    how: bi('Hệ thống tự đếm. Nếu ra 0% thì kiểm tra xem có phải chưa gắn theo dõi nguồn không, trước khi kết luận bản đồ không mang khách.',
            'The system counts this. If it reads 0%, check whether booking-source tracking is wired at all before concluding the map brings nobody.'),
    why: bi('Đây là thước đo cuối cùng. Thứ hạng chỉ để phục vụ con số này.',
            'The final measure. Rankings exist only to serve this number.'),
  },

  // ---- phase 1: the profile -----------------------------------------------
  {
    id: 'primary-category', track: 'map', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 5,
    title: bi('Đặt đúng danh mục chính', 'Set the primary category correctly'),
    how: bi('Tiệm nail chọn "Nail salon", không chọn "Beauty salon" cho sang. Danh mục chính phải khớp dịch vụ ra tiền nhiều nhất.',
            'A nail shop picks "Nail salon", not the grander "Beauty salon". It must match the service that earns most.'),
    why: bi('Được gọi là trường quan trọng nhất trong toàn bộ hồ sơ. Chọn sai thì không đánh giá nào hay backlink nào bù lại được.',
            'Called the single most important field in the profile. Get it wrong and nothing compensates.'),
  },
  {
    id: 'secondary-categories', track: 'map', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 5,
    title: bi('Thêm danh mục phụ cho dịch vụ khác', 'Add secondary categories for the other services'),
    how: bi('Waxing, nối mi, chăm sóc da… mỗi thứ một danh mục phụ. Chỉ thêm dịch vụ tiệm thật sự làm.',
            'Waxing, lashes, facials — one each. Only what the shop genuinely does.'),
    why: bi('Danh mục phụ là yếu tố quan trọng thứ tám, và là cách duy nhất để hồ sơ hiện ra cho dịch vụ ngoài nghề chính.',
            'Eighth most important, and the only way to surface for anything but the main trade.'),
  },
  {
    id: 'hours-exact', track: 'map', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 10,
    title: bi('Khai đúng giờ mở cửa, kể cả giờ nghỉ', 'Get opening hours exactly right, breaks included'),
    how: bi('Khai đúng giờ thật. Tự tìm tiệm lúc 8 giờ tối xem Google hiện "Đang mở" hay "Đã đóng cửa" cho đúng.',
            'Enter the real hours. Search at eight in the evening and check Google says open or closed correctly.'),
    why: bi('Yếu tố quan trọng thứ năm. Nhóm gõ "nail salon open now" là nhóm sẵn sàng bước vào cửa nhất trong ngày.',
            'Fifth most important. People typing "nail salon open now" are the readiest to walk in of anyone.'),
  },
  {
    id: 'services-prices', track: 'map', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 45,
    title: bi('Điền đầy đủ dịch vụ kèm giá', 'Fill in every service, with prices'),
    how: bi('Mục Dịch vụ trong hồ sơ. Tên dịch vụ đúng như khách gọi, kèm giá thật.',
            'The Services section. Name each one the way customers do, with real prices.'),
    why: bi('Hồ sơ có giá được bấm nhiều hơn hẳn — và lượt bấm là tín hiệu hành vi, chiếm khoảng 9% thứ hạng.',
            'Profiles with prices get clicked far more, and clicks are behavioural signal, worth around nine percent.'),
  },
  {
    id: 'attributes', track: 'map', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 10,
    title: bi('Bật hết thuộc tính đúng với tiệm', 'Switch on every attribute that is true'),
    how: bi('Chỗ đậu xe, nhận khách vãng lai, thanh toán thẻ, wifi, phù hợp trẻ em… chỉ bật cái đúng.',
            'Parking, walk-ins, card payment, wifi, good for kids — only the ones that are true.'),
    why: bi('Thuộc tính là cách Google hiểu tiệm hợp với ai, và nó hiện thành nhãn ngay trong kết quả.',
            'Attributes are how Google works out who the shop suits, and they show as labels in the results.'),
  },
  {
    id: 'photos-20', track: 'map', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 60,
    title: bi('Đăng tối thiểu 20 ảnh thật', 'Upload at least twenty real photos'),
    how: bi('Mặt tiền, biển hiệu, bên trong, chỗ ngồi, thợ đang làm, thành phẩm. Chụp tại tiệm, không ảnh kho.',
            'Storefront, sign, inside, seating, techs working, finished work. Shot in the shop — never stock.'),
    why: bi('Ảnh quyết định người ta bấm vào tiệm nào trong ba tiệm hiện cạnh nhau.',
            'Photos decide which of the three shops side by side gets tapped.'),
  },
  {
    id: 'description', track: 'map', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 20,
    title: bi('Viết mô tả có nhắc dịch vụ và khu vực', 'Write a description naming services and area'),
    how: bi('750 ký tự. Nhắc dịch vụ chính và tên khu vực tự nhiên. Không nhồi từ khoá.',
            '750 characters. Name the main services and the area naturally. No stuffing.'),
    why: bi('Không phải yếu tố nặng, nhưng là chỗ nói rõ tiệm bán gì cho cả Google lẫn người đọc.',
            'Not a heavy factor, but where both Google and a reader learn what the shop sells.'),
  },
  {
    id: 'holiday-hours', track: 'map', phase: 1, kind: 'manual', cadence: 'quarterly', tiers: ALL, minutes: 10,
    title: bi('Khai giờ đặc biệt cho các ngày lễ sắp tới', 'Set special hours for the holidays ahead'),
    how: bi('Khai trước ít nhất một tuần cho mỗi kỳ nghỉ trong quý tới.',
            'Enter them at least a week before each holiday in the coming quarter.'),
    why: bi('Google hạ tin cậy hồ sơ có giờ sai, và khách tới nơi thấy đóng cửa thường để lại đánh giá xấu.',
            'Google trusts a profile with wrong hours less, and a customer at a locked door often reviews it.'),
  },

  // ---- phase 2: reviews ----------------------------------------------------
  {
    id: 'review-count', track: 'map', phase: 2, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'review-count', doneOn: ['pass'] },
    title: bi('Đạt nền đánh giá tối thiểu', 'Reach a working review base'),
    how: bi('Xin đánh giá ngay lúc thanh toán, đưa mã QR. Một khách vui mỗi ngày là đủ.',
            'Ask at checkout, with a QR code. One happy customer a day is enough.'),
    why: bi('Số đánh giá là yếu tố nặng nhất quyết định tiệm có lọt vào ba kết quả bản đồ hay không.',
            'The heaviest single thing deciding whether the shop makes the three-result pack at all.'),
  },
  {
    id: 'review-velocity', track: 'map', phase: 2, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'review-velocity', doneOn: ['pass'] },
    title: bi('Giữ nhịp tối thiểu 4 đánh giá mỗi tháng', 'Keep at least four new reviews a month'),
    how: bi('Tuần nào cũng phải có ít nhất một. Đừng dồn cục — 20 đánh giá trong một tuần trông như mua và bị lọc.',
            'At least one every week. Never in a batch — twenty in a week looks bought and gets filtered.'),
    why: bi('Hồ sơ 200 đánh giá mà cả năm không có cái mới thua hồ sơ 60 đánh giá tuần nào cũng có thêm.',
            'Two hundred reviews and none this year loses to sixty that gains one every week.'),
  },
  {
    id: 'review-replies', track: 'map', phase: 2, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'review-replies', doneOn: ['pass'] },
    title: bi('Trả lời từ 80% đánh giá trở lên', 'Reply to eighty percent of reviews or more'),
    how: bi('Đánh giá xấu trả lời trước, trong ngày. Ngắn, thật, không dùng mẫu copy dán.',
            'Bad ones first, same day. Short, real replies — never a template.'),
    why: bi('Mức 80% có tác động đo được lên thứ hạng. Và người đọc review xấu quan tâm cách tiệm phản hồi hơn nội dung phàn nàn.',
            'Eighty percent shows a measurable effect. And whoever reads a bad review cares more about the reply.'),
  },
  {
    id: 'review-qr', track: 'map', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Đặt mã QR xin đánh giá tại quầy', 'Put a review QR code on the counter'),
    how: bi('In mã QR link thẳng tới ô viết đánh giá Google. Dán ở quầy thanh toán, không để trong ngăn kéo.',
            'Print a QR going straight to the Google review box. On the pay counter, not in a drawer.'),
    why: bi('Khoảng cách giữa "định xin" và "xin được" là một tấm QR trong tầm tay lúc khách đang trả tiền.',
            'The gap between meaning to ask and asking is a QR within reach while she pays.'),
  },
  {
    id: 'daily-review-ask', track: 'map', phase: 2, kind: 'manual', cadence: 'weekly', tiers: ALL, minutes: 35,
    title: bi('Tuần này đã xin đủ đánh giá chưa', 'Did this week bring in its reviews'),
    how: bi('Mỗi ngày xin một khách vui nhất. Cuối tuần đếm: dưới 1 đánh giá mới là tuần thất bại, bù ngay tuần sau.',
            'Ask the happiest customer each day. Count on Friday: under one new review is a failed week — make it up next week.'),
    why: bi('Đây là việc duy nhất trong cả lộ trình phải làm mỗi tuần, mãi mãi. Đứt nhịp là thứ Google thấy đầu tiên.',
            'The one job here that must happen every week, forever. A broken rhythm is the first thing Google notices.'),
  },
  {
    id: 'review-keywords', track: 'map', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 15,
    title: bi('Hướng khách nhắc tên dịch vụ trong đánh giá', 'Get service names into the review text'),
    how: bi('Nói với khách: "chị nhắc giúp em dịch vụ chị làm hôm nay nhé". Không đọc mẫu cho khách chép.',
            'Say: "would you mention which service you had today?" Never dictate words to copy.'),
    why: bi('Chữ trong đánh giá giúp Google hiểu tiệm bán gì — và hiện thành nhãn lý do ngay dưới hồ sơ.',
            'Words inside reviews teach Google what the shop sells, and surface as justification labels.'),
  },
  {
    id: 'gbp-posts', track: 'map', phase: 2, kind: 'manual', cadence: 'weekly', tiers: ALL, minutes: 30,
    title: bi('Đăng 2–3 bài lên hồ sơ tuần này', 'Post two or three times on the profile this week'),
    how: bi('Bài nào cũng kèm ảnh. Bộ móng vừa làm xong là nguồn ảnh có sẵn mỗi ngày.',
            'Every post carries a photo. The set you just finished is a source that exists every day.'),
    why: bi('Tiệm đăng đều tăng trung bình 2,3 hạng trong 6 tháng so với tiệm không đăng gì.',
            'Shops posting weekly gain an average of 2.3 positions over six months against shops posting nothing.'),
  },
  {
    id: 'qna-seed', track: 'map', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Tự đặt và trả lời 5–7 câu hỏi thường gặp', 'Seed five to seven common questions and answer them'),
    how: bi('Mục Hỏi & Đáp. Giá, đậu xe, có nhận walk-in không, có làm cho trẻ em không, có nhận thẻ không.',
            'The Q&A section. Price, parking, walk-ins, children, card payment.'),
    why: bi('Ai cũng đặt được câu hỏi lên hồ sơ tiệm mình. Không tự trả lời trước thì người lạ trả lời hộ.',
            'Anyone can post a question on your profile. Leave it and a stranger answers for you.'),
  },

  // ---- phase 3: beating the shops above you --------------------------------
  {
    id: 'competitor-table', track: 'map', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 90,
    title: bi('Lập bảng đối chiếu với 3 tiệm đang đứng trên', 'Build the comparison table against the three above you'),
    how: bi('Tìm từ khoá chính ở chế độ ẩn danh, ghi 3 tiệm trong top. Đối chiếu 8 mục: danh mục chính, danh mục phụ, thuộc tính, số đánh giá, nhịp đánh giá/tháng, tỷ lệ trả lời, số ảnh và lần đăng gần nhất, nhịp đăng bài.',
            'Search the core keyword in incognito, note the three in the pack. Compare eight fields: primary category, secondary categories, attributes, review count, reviews per month, reply rate, photo count and last upload, posting frequency.'),
    why: bi('Ở khu cạnh tranh, "làm đủ checklist" không còn nghĩa gì vì họ cũng làm đủ. Phải biết hơn họ đúng ở đâu, bằng con số.',
            'Where it is crowded, "completing the checklist" means nothing because they completed it too. You need to know where you beat them, in numbers.'),
  },
  {
    id: 'beat-categories', track: 'map', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 20,
    title: bi('Bằng hoặc hơn họ về số danh mục phụ', 'Match or beat their secondary category count'),
    how: bi('Lấy từ bảng đối chiếu: danh mục nào họ có mà mình không có, và tiệm mình thật sự làm dịch vụ đó thì thêm vào.',
            'From the table: which categories they have and you do not — add the ones the shop genuinely does.'),
    why: bi('Đây là mục rẻ nhất và nhanh nhất trong cả giai đoạn này, và thường là chỗ chênh lệch rõ nhất.',
            'The cheapest and fastest item in this phase, and often where the gap is clearest.'),
  },
  {
    id: 'beat-velocity', track: 'map', phase: 3, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 20,
    title: bi('Tháng này nhịp đánh giá có hơn họ không', 'Did this month beat their review pace'),
    how: bi('Mở hồ sơ 2 đối thủ mạnh nhất, đếm đánh giá mới trong tháng của họ, so với mình. Ghi vào bảng.',
            'Open the two strongest rivals, count their new reviews this month against yours. Write it down.'),
    why: bi('Nhịp của mình chỉ có nghĩa khi so với nhịp của họ. Hơn họ mỗi tháng là thắng, kém là đang tụt dù số vẫn tăng.',
            'Your pace only means something next to theirs. Beating them monthly is winning; trailing is slipping even while your number rises.'),
  },
  {
    id: 'hero-photos', track: 'map', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 120,
    title: bi('Chụp lại ảnh đại diện và ảnh bìa cho tử tế', 'Reshoot the profile and cover photos properly'),
    how: bi('Một buổi chụp có đèn, ảnh sáng và sắc nét. Đây là hai tấm được nhìn nhiều nhất trong cả hồ sơ.',
            'One session with proper light — bright and sharp. The two most-looked-at frames in the profile.'),
    why: bi('Ở giai đoạn này ba tiệm đều đã làm đúng phần cơ bản. Ảnh là thứ quyết định người ta bấm vào ai.',
            'By now all three have the basics right. The photo decides who gets tapped.'),
  },
  {
    id: 'booking-link', track: 'map', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Bật đặt lịch trực tiếp từ Google', 'Turn on booking straight from Google'),
    how: bi('Gắn link đặt lịch Lumio vào nút "Đặt lịch" trên hồ sơ. Rút đường từ tìm kiếm tới booking còn một cú bấm.',
            'Put the Lumio booking link on the profile booking button. Search-to-booking becomes one tap.'),
    why: bi('Tạo tín hiệu hành vi mạnh nhất có thể, và biến thứ hạng thành con số booking đo được.',
            'The strongest behavioural signal available, and it turns ranking into a booking number you can count.'),
  },
  {
    id: 'area-mentions', track: 'map', phase: 3, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 15,
    title: bi('Hướng đánh giá nhắc tên khu vực', 'Get the neighbourhood named in reviews'),
    how: bi('"Tiệm nail gần Main Street" — tên đường, tên khu, tên trung tâm thương mại gần đó.',
            'A street, a district, the mall nearby — "the nail place near Main Street".'),
    why: bi('Giúp hồ sơ liên quan hơn ở đúng vùng mình muốn phủ, trong giới hạn mà khoảng cách cho phép.',
            'Raises relevance in the area you are trying to cover, within what proximity allows.'),
  },
  {
    id: 'service-pages', track: 'map', phase: 3, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 240,
    title: bi('Dựng trang riêng cho 3 dịch vụ giá cao nhất', 'Build a page for each of the three highest-value services'),
    how: bi('Mỗi dịch vụ một trang: mô tả, giá, ảnh thật, câu hỏi thường gặp, nút đặt lịch, schema LocalBusiness. Nhắc tên thành phố tự nhiên.',
            'One page each: description, price, real photos, FAQ, booking button, LocalBusiness schema. Name the city naturally.'),
    why: bi('On-page chiếm 15–19%. Ở khu dày, ba tiệm đầu bảng thường chỉ có mỗi trang chủ — đây là chỗ còn trống thật.',
            'On-page is 15–19%. In a crowded area the top three usually have only a homepage — this is genuinely open ground.'),
  },
  {
    id: 'spam-sweep', track: 'map', phase: 3, kind: 'manual', cadence: 'monthly', tiers: CROWDED, minutes: 30,
    title: bi('Rà và báo cáo hồ sơ vi phạm trong khu', 'Sweep and report policy-breaking profiles nearby'),
    how: bi('Tên nhồi từ khoá ("ABC Nails Best Nail Salon Kerrville"), hồ sơ ma không có mặt tiền, địa chỉ trùng nhà dân. Báo qua Business Redressal Form.',
            'Keyword-stuffed names, ghost listings with no storefront, addresses that are houses. Report via the Business Redressal Form.'),
    why: bi('Ở cụm tiệm nail Việt đây là đòn bẩy cao bất thường: gỡ được một hồ sơ giả là cả bảng đẩy lên một bậc. Phải làm hàng tháng, không phải một lần.',
            'In a dense Vietnamese nail cluster this is unusually high-leverage: removing one fake listing lifts everyone below it a place. Monthly, not once.'),
  },

  // ---- phase 4: authority outside the profile ------------------------------
  {
    id: 'citation-core', track: 'map', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 120,
    title: bi('Sửa dữ liệu ở các nguồn gốc: Data Axle, Foursquare, Bing, Yelp', 'Fix the data at the source: Data Axle, Foursquare, Bing, Yelp'),
    how: bi('Sửa ở nguồn gốc trước — dữ liệu từ đó chảy xuống hàng trăm trang nhỏ. Tên, địa chỉ, số điện thoại phải giống nhau tuyệt đối, tới từng dấu chấm.',
            'Fix the aggregators first — their data flows down to hundreds of smaller sites. Name, address, phone identical everywhere, down to the punctuation.'),
    why: bi('Sai lệch còn hại hơn thiếu: thuật toán không xác minh được đây là một tiệm hay hai, và thứ hạng thành bấp bênh.',
            'Inconsistency hurts more than absence: the algorithm cannot tell one business from two, and rankings become unstable.'),
  },
  {
    id: 'citation-duplicates', track: 'map', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 90,
    title: bi('Tìm và gỡ hồ sơ trùng của chính tiệm', 'Find and remove your own duplicate listings'),
    how: bi('Tìm tên tiệm, số điện thoại cũ, địa chỉ cũ trên Google Maps, Yelp, Apple Maps. Hồ sơ trùng thì yêu cầu gộp hoặc gỡ.',
            'Search the name, the old phone, the old address on Google Maps, Yelp, Apple Maps. Request a merge or removal for each duplicate.'),
    why: bi('Hồ sơ trùng chia đôi tín hiệu: đánh giá bị tách ra, thứ hạng bấp bênh. Tiệm sang tay hoặc đổi chỗ gần như luôn có vấn đề này.',
            'Duplicates split the signal: reviews divide, rankings wobble. A shop that changed hands or moved almost always has this.'),
  },
  {
    id: 'link-chamber', track: 'map', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 60,
    title: bi('Vào phòng thương mại địa phương', 'Join the local chamber of commerce'),
    how: bi('Khoảng 200–500 USD/năm. Đăng ký, gửi thông tin tiệm, kiểm tra hồ sơ đã có link về website chưa.',
            'Roughly $200–500 a year. Join, submit the shop details, then check the listing actually links to the site.'),
    why: bi('Được coi là link địa phương chất lượng cao dễ lấy nhất. Một link, một lần trả tiền, giữ mãi.',
            'Widely called the easiest high-quality local link there is. One link, paid once a year, held indefinitely.'),
  },
  {
    id: 'link-mentions', track: 'map', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 90,
    title: bi('Đòi link từ các bài đã nhắc tên tiệm', 'Reclaim links from pages that already mention the shop'),
    how: bi('Tìm tên tiệm trên Google, lọc trang nhắc tên mà không có link. Nhắn xin họ gắn link — tỷ lệ đồng ý cao vì họ đã nhắc rồi.',
            'Search the shop name, find pages mentioning it without a link. Ask them to link — conversion is high because the mention already exists.'),
    why: bi('Miễn phí, và là loại link dễ xin nhất trong tất cả các loại.',
            'Free, and the easiest kind of link to get of any.'),
  },
  {
    id: 'link-sponsor', track: 'map', phase: 4, kind: 'manual', cadence: 'monthly', tiers: DENSE, minutes: 120,
    title: bi('Tài trợ một sự kiện địa phương tháng này', 'Sponsor one local event this month'),
    how: bi('Đội bóng trường, hội chợ khu phố, sự kiện từ thiện. Khoảng 100–1.000 USD. Yêu cầu trang cảm ơn có link về website.',
            'A school team, a neighbourhood fair, a charity night. Around $100–1,000. Ask for a thank-you page that links to the site.'),
    why: bi('Link .org liên quan địa phương, và 1–2 cái mỗi tháng cộng dồn lại rất nhanh. Nhịp an toàn là 5–10 link/tháng — nhảy từ 10 lên 100 link trong một tháng trông đáng ngờ.',
            'A locally relevant .org link, and one or two a month compounds fast. Five to ten a month is the safe pace — going from ten to a hundred in a month looks suspicious.'),
  },
  {
    id: 'link-partners', track: 'map', phase: 4, kind: 'manual', cadence: 'once', tiers: DENSE, minutes: 90,
    title: bi('Đổi link với 2–3 tiệm bổ trợ không cạnh tranh', 'Swap links with two or three complementary shops'),
    how: bi('Tiệm tóc, spa, studio chụp ảnh cưới, tiệm áo cưới. Trang "đối tác" trên web hai bên.',
            'A hair salon, a spa, a wedding photographer, a bridal shop. A partners page on each site.'),
    why: bi('Link liên quan thật và không bị phạt khi đúng là quan hệ có thật. Ngành làm đẹp có sẵn quan hệ giới thiệu chéo.',
            'Genuinely relevant, and not penalised when the relationship is real. Beauty trades already refer to each other.'),
  },
  {
    id: 'link-news', track: 'map', phase: 4, kind: 'manual', cadence: 'once', tiers: DENSE, minutes: 300,
    title: bi('Viết một bài cho báo hoặc blog địa phương', 'Write one piece for a local paper or blog'),
    how: bi('Chủ đề hữu ích, không quảng cáo: "chăm móng mùa đông", "chọn tiệm nail an toàn vệ sinh thế nào".',
            'Something useful, not an advert: winter nail care, how to tell a hygienic shop from a risky one.'),
    why: bi('Link báo địa phương vừa mạnh vừa liên quan, và gần như không tiệm nail nào làm — đây là chỗ trống thật ở khu cạnh tranh cao.',
            'A local news link is strong and relevant, and almost no nail shop does it — genuinely open ground where it is crowded.'),
  },

  // ---- phase 5: holding ----------------------------------------------------
  {
    id: 'monthly-grid', track: 'map', phase: 5, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 30,
    title: bi('Đo lưới điểm tháng này', 'Run this month\'s geogrid'),
    how: bi('Cùng bộ từ khoá, cùng bán kính, cùng ngày trong tháng. Lưu ảnh cạnh ảnh tháng trước.',
            'Same keywords, same radius, same date each month. Save beside last month\'s.'),
    why: bi('Hạng 1 rớt trong im lặng. Không đo đều thì tới lúc phát hiện đã tụt ba tháng.',
            'First place slips quietly. Without a regular measurement, by the time anyone notices it has been gone three months.'),
  },
  {
    id: 'monthly-report', track: 'map', phase: 5, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 45,
    title: bi('Gửi báo cáo tháng cho khách', 'Send the client the monthly report'),
    how: bi('Lưới điểm tháng này cạnh tháng trước, lượt gọi và chỉ đường trong Insights, và số booking đến từ Google.',
            'This month\'s grid beside last month\'s, calls and direction requests from Insights, bookings from Google.'),
    why: bi('Khách không thấy tiến triển là khách nghỉ ở tháng thứ ba, kể cả khi việc vẫn đang chạy đúng.',
            'A client who cannot see progress leaves in month three, even when the work is going exactly to plan.'),
  },
  {
    id: 'quarterly-audit', track: 'map', phase: 5, kind: 'manual', cadence: 'quarterly', tiers: ALL, minutes: 60,
    title: bi('Rà lại danh mục, giá và citation', 'Re-check categories, prices and citations'),
    how: bi('Google thêm danh mục mới liên tục — có thể đã có danh mục sát hơn. Đối chiếu giá hồ sơ với bảng giá thật, soát lại NAP.',
            'Google adds categories constantly — a closer one may exist now. Check profile prices against the real list, re-check NAP.'),
    why: bi('Danh mục sát hơn là một trong số ít thay đổi còn tạo được bước nhảy khi mọi thứ khác đã tối ưu.',
            'A closer category is one of the few remaining changes that can still move things once everything else is done.'),
  },
];

export const WEB_TASKS: RoadmapTask[] = [
  // ---- W0: free instruments ------------------------------------------------
  {
    id: 'w-search-console', track: 'web', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 45,
    title: bi('Cài Google Search Console và xác minh sở hữu', 'Set up Google Search Console and verify the site'),
    how: bi('search.google.com/search-console → thêm tài sản → xác minh bằng thẻ HTML hoặc DNS. Nộp sitemap.xml ngay sau đó.',
            'search.google.com/search-console → add property → verify by HTML tag or DNS. Submit sitemap.xml straight after.'),
    why: bi('Miễn phí, và là nguồn DUY NHẤT cho biết khách thật sự gõ gì để tới website — chính xác hơn mọi công cụ trả tiền, vì đây là số của Google.',
            'Free, and the only source of what people actually typed to reach the site — more accurate than any paid tool, because it is Google\'s own number.'),
  },
  {
    id: 'w-analytics', track: 'web', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Gắn Google Analytics và đánh dấu nút đặt lịch là chuyển đổi', 'Install Analytics and mark the booking button as a conversion'),
    how: bi('Cài GA4, đặt sự kiện chuyển đổi cho nút Đặt lịch và nút gọi. Trong Lumio: Cài đặt → Analytics.',
            'Install GA4, set a conversion event on the booking button and the call button. In Lumio: Settings → Analytics.'),
    why: bi('Không đánh dấu chuyển đổi thì mọi báo cáo chỉ nói lượt xem — mà lượt xem không trả tiền cho tiệm.',
            'Without a conversion event every report talks about visits, and visits do not pay the shop.'),
  },
  {
    id: 'w-index-check', track: 'web', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 20,
    title: bi('Kiểm tra website đã được Google index chưa', 'Check the site is actually indexed'),
    how: bi('Gõ site:tenmiencuaban.com trên Google. Đếm số trang. Trang tiền không có trong đó thì dùng URL Inspection trong Search Console để yêu cầu index.',
            'Search site:yourdomain.com. Count the pages. Any money page missing gets a manual index request via URL Inspection.'),
    why: bi('Trang chưa index thì mọi tối ưu bên dưới là vô nghĩa — nó còn chưa nằm trong danh sách để Google xét (AX4).',
            'An unindexed page makes everything below pointless — it is not yet in the pool Google chooses from (AX4).'),
  },

  // ---- W1: keyword map -----------------------------------------------------
  {
    id: 'w-keyword-list', track: 'web', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 90,
    title: bi('Chốt danh sách từ khóa mục tiêu cho tiệm này', 'Settle this shop\'s target keyword list'),
    how: bi('Lấy từ tab Quảng cáo & SEO — hệ thống đã dựng sẵn nhóm từ khóa theo nghề và thành phố của tiệm. Đối chiếu thêm với Search Console (nếu đã có dữ liệu) và ô gợi ý của Google khi gõ.',
            'Take it from the Ads & SEO tab — the system already built keyword groups for this trade and city. Cross-check against Search Console if there is data, and against Google autocomplete.'),
    why: bi('Từ khóa phải khớp dịch vụ tiệm thật sự bán và giá tiệm thật sự lấy. Lên top cho từ khóa mang về khách sai còn tệ hơn không lên.',
            'Keywords must match what the shop really sells at the price it really charges. Ranking for a term that brings the wrong customer is worse than not ranking.'),
  },
  {
    id: 'w-keyword-map', track: 'web', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 120,
    title: bi('Lập bảng từ khóa → trang đích, một từ một trang', 'Map keyword to page — one term, one page'),
    how: bi('Bảng ba cột: từ khóa chính · URL trang đích · ý định (đặt lịch / tìm hiểu / so sánh). Hai trang cùng nhắm một từ thì gộp lại hoặc đổi hướng một trang.',
            'Three columns: primary keyword, landing URL, intent (book, learn, compare). Two pages on one term get merged, or one gets re-pointed.'),
    why: bi('Đây là lỗi phổ biến nhất và tốn kém nhất: hai trang tự cắn nhau, Google không biết chọn trang nào, cuối cùng không trang nào lên.',
            'The most common and most expensive mistake: two pages cannibalise each other, Google cannot pick, and neither ranks.'),
  },
  {
    id: 'w-url-structure', track: 'web', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 60,
    title: bi('Sửa cấu trúc URL theo bản đồ từ khóa (P1)', 'Fix URL structure to match the map (P1)'),
    how: bi('3–5 từ, gạch ngang, không dấu, không ID số, nằm đúng thư mục theo bản đồ chủ đề. Đổi URL thì phải chuyển hướng 301 từ URL cũ.',
            'Three to five words, hyphens, no accents, no numeric ids, in the right folder per the topical map. Any URL change needs a 301 from the old one.'),
    why: bi('Sửa URL sau khi trang đã lên hạng là việc đau đớn — làm ngay từ đầu, một lần.',
            'Changing a URL after a page ranks is painful. Do it once, at the start.'),
  },

  // ---- W2: on-page, P-series ----------------------------------------------
  {
    id: 'w-p0-gate', track: 'web', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 60,
    title: bi('Qua cổng chất lượng nội dung P0 trước khi onpage', 'Pass the P0 content quality gate before any on-page'),
    how: bi('Mỗi trang tiền: đủ section theo dàn ý, mỗi H2 trả lời ngay câu hỏi của nó, có E-A-V thật, không placeholder, không mâu thuẫn, nguồn dẫn chuẩn.',
            'For each money page: sections complete, every H2 answers its own question first, real E-A-V, no placeholder, no contradictions, sources cited.'),
    why: bi('Onpage cho một trang nội dung chưa đạt là đốt công. P0 chưa pass thì dừng, trả về viết lại.',
            'On-paging a page whose content is not ready is wasted work. If P0 fails, stop and send it back to be rewritten.'),
  },
  {
    id: 'w-p1-p5-meta', track: 'web', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 90,
    title: bi('Nhóm Meta: Title, Meta, CTR, H1 (P2–P5)', 'The meta group: title, meta, CTR, H1 (P2–P5)'),
    how: bi('Title 50–60 ký tự, chứa main predicate, keyword trong 3 từ đầu, KHÁC H1 và KHÁC URL. Meta 150–160, có CTA. Title dùng hook → Meta kể chi tiết, không lặp ý nhau. H1 cùng predicate với Title, 60–70 ký tự, duy nhất một H1.',
            'Title 50–60 characters, carrying the main predicate, keyword in the first three words, different from both H1 and URL. Meta 150–160 with a CTA. Title hooks, meta details — never the same sentence twice. H1 shares the title\'s predicate, 60–70 characters, exactly one per page.'),
    why: bi('P2 và P5 nằm trong nhóm "fail nền": còn ❌ ở đây thì không đụng tới tối ưu sâu.',
            'P2 and P5 are foundation fails: while either is red, nothing deeper is worth touching.'),
  },
  {
    id: 'w-p8-coverage', track: 'web', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 180,
    title: bi('Phủ chủ đề ≥70% so với top 10 (P8)', 'Cover at least 70% of what the top ten cover (P8)'),
    how: bi('Mở 10 kết quả đầu cho từ khóa mục tiêu, liệt kê thực thể và fact họ nhắc. Bài mình phải cover ≥70% tập đó, đủ cả tên riêng lẫn thuật ngữ kỹ thuật.',
            'Open the first ten results, list the entities and facts they carry. Your page must cover at least seventy percent of that set, named entities and technical terms alike.'),
    why: bi('Đây là yếu tố onpage MẠNH NHẤT trong toàn bộ checklist — mạnh hơn mọi thứ khác một cách rõ rệt. Nếu chỉ làm được một việc onpage thì làm việc này.',
            'The single strongest on-page factor in the whole checklist, by a clear margin. If only one on-page job gets done, this is the one.'),
  },
  {
    id: 'w-p9-p13-body', track: 'web', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 150,
    title: bi('Thân bài: E-A-V, phân bố, quan hệ từ, n-gram (P9–P13)', 'The body: E-A-V, distribution, word relations, n-grams (P9–P13)'),
    how: bi('Mỗi đoạn ít nhất một câu E-A-V. Macro terms rải toàn bài, micro terms CHỈ trong section của nó. Đủ 5 loại quan hệ từ. Entity và attribute trong cùng câu. N-gram không lặp giữa các section.',
            'At least one E-A-V sentence per paragraph. Macro terms throughout, micro terms only inside their own section. All five relation types present. Entity and attribute in the same sentence. N-grams unique per section.'),
    why: bi('Đếm số câu E-A-V tuyệt đối, không dùng % mật độ — mật độ từ khóa gần như không tương quan gì với thứ hạng.',
            'Count E-A-V sentences absolutely, never as a density percentage — keyword density correlates with essentially nothing.'),
  },
  {
    id: 'w-p14-p16-answer', track: 'web', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 60,
    title: bi('Bold câu trả lời, Featured Snippet, vị trí từ khóa (P14–P16)', 'Bold the answer, snippet format, keyword positions (P14–P16)'),
    how: bi('Bold CÂU TRẢ LỜI chứ không bold từ khóa, khoảng 5–8 lần mỗi 1800 ký tự. Câu trả lời ~40 từ, đúng định dạng mà snippet hiện tại đang dùng. Keyword chính có trong 100 chữ đầu VÀ 100 chữ cuối.',
            'Bold the ANSWER, not the keyword — around five to eight per 1800 characters. A ~40-word answer in whatever format the current snippet uses. Primary keyword in both the first hundred words and the last hundred.'),
    why: bi('Số lượng bold gần như không có tác dụng, nhưng bold đúng chỗ thì có. Bold từ khóa là làm sai loại việc.',
            'How much you bold barely matters; bolding the right thing does. Bolding the keyword is doing the wrong job.'),
  },
  {
    id: 'w-p17-p18-links', track: 'web', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 60,
    title: bi('Liên kết trong và ngoài bài (P17–P18)', 'Links in and out (P17–P18)'),
    how: bi('5–10 internal link mỗi bài, và phải NHẮC chủ đề trang đích 1–3 lần TRƯỚC khi đặt link. Anchor khớp Title trang đích. 2–4 external link tới .edu/.gov/Wikipedia, mở tab mới. TUYỆT ĐỐI không link ra đối thủ.',
            'Five to ten internal links per article, and mention the destination topic one to three times BEFORE the link appears. Anchor matches the destination title. Two to four external links to .edu/.gov/Wikipedia, new tab. Never link to a competitor.'),
    why: bi('External link là mục dễ sót nhất trong cả checklist, vì bản cũ chỉ lo internal.',
            'External links are the most commonly missed item on the whole checklist, because older versions only worried about internal ones.'),
  },
  {
    id: 'w-p19-p23-tech', track: 'web', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 90,
    title: bi('Ảnh và kỹ thuật (P19–P23)', 'Images and technical (P19–P23)'),
    how: bi('Tên file ảnh theo từ khóa, không dấu. Alt 8–15 từ = Thực thể + Thuộc tính + Hành động, caption khác alt. Ảnh .webp dưới 150KB, có width/height. Một <main> duy nhất, <article> tự đứng được. Mọi nút và form phải CHẠY.',
            'Image filenames from the keyword, unaccented. Alt of 8–15 words = entity + attribute + action; caption says something the alt does not. WebP under 150KB with explicit width and height. Exactly one <main>, a self-contained <article>. Every button and form must actually WORK.'),
    why: bi('Nút hỏng là tín hiệu tiêu cực thật, không phải chuyện thẩm mỹ. Và ảnh thiếu width/height làm trang nhảy, hỏng CLS.',
            'A broken control is a real negative signal, not a cosmetic issue. And images without dimensions make the page jump, which wrecks CLS.'),
  },

  // ---- W3: supporting content ---------------------------------------------
  {
    id: 'w-cluster-plan', track: 'web', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 90,
    title: bi('Lên cụm bài vệ tinh cho từng trang tiền', 'Plan the supporting cluster for each money page'),
    how: bi('Mỗi trang tiền cần 3–5 bài trả lời câu hỏi ĐỨNG TRƯỚC quyết định chọn tiệm: "gel-x là gì", "giữ được bao lâu", "có hại móng không". Tất cả trỏ về trang tiền.',
            'Each money page needs three to five articles answering the questions that come BEFORE choosing a shop: what is gel-x, how long does it last, does it damage the nail. All of them point back.'),
    why: bi('Trang tiền một mình không đủ uy tín chủ đề. Cụm bài xung quanh là cách xây uy tín đó mà không cần mua gì.',
            'A money page alone lacks topical authority. The cluster is how that authority is built without buying anything.'),
  },
  {
    id: 'w-publish-cadence', track: 'web', phase: 3, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 240,
    title: bi('Xuất bản 2–4 bài vệ tinh tháng này', 'Publish two to four supporting articles this month'),
    how: bi('Mỗi bài chạy đủ P0 rồi mới onpage. Đăng đều hơn đăng nhiều: 2 bài mỗi tháng suốt một năm thắng 20 bài trong một tháng rồi im.',
            'Each one passes P0 before any on-page work. Steady beats heavy: two a month for a year beats twenty in one month and then silence.'),
    why: bi('Đây là việc chiếm phần lớn thời gian của cả tuyến website, và là việc duy nhất không rút ngắn được.',
            'This consumes most of the time on the website track, and is the one part that cannot be shortened.'),
  },
  {
    id: 'w-internal-linking', track: 'web', phase: 3, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 60,
    title: bi('Rà lại mạng liên kết nội bộ tháng này', 'Re-thread the internal links this month'),
    how: bi('Bài mới phải trỏ về trang tiền, và các bài cũ liên quan phải được thêm link tới bài mới. Không để bài nào mồ côi.',
            'Every new article links back to its money page, and older related articles get a link to the new one. No orphans.'),
    why: bi('Bài mồ côi không nhận được uy tín từ phần còn lại của site — viết xong rồi bỏ đó là mất một nửa giá trị.',
            'An orphaned article receives no authority from the rest of the site — writing it and leaving it loses half its value.'),
  },
  {
    id: 'w-refresh-old', track: 'web', phase: 3, kind: 'manual', cadence: 'monthly', tiers: CROWDED, minutes: 90,
    title: bi('Cập nhật một bài cũ đang tụt hạng', 'Refresh one older article that is slipping'),
    how: bi('Mở Search Console, tìm trang có lượt hiển thị giảm hoặc thứ hạng trung bình tụt. So lại với top 10 hiện tại, bổ sung phần thiếu.',
            'Open Search Console, find a page losing impressions or average position. Compare it against today\'s top ten and fill what is missing.'),
    why: bi('Cập nhật bài cũ thường rẻ và nhanh hơn viết bài mới, vì trang đã có tuổi và đã được index.',
            'Refreshing beats writing new: the page already has age and is already indexed.'),
  },

  // ---- W4: off-site, earned ------------------------------------------------
  {
    id: 'w-link-chamber', track: 'web', phase: 4, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 60,
    title: bi('Vào phòng thương mại địa phương', 'Join the local chamber of commerce'),
    how: bi('Khoảng 200–500 USD/năm. Đăng ký, gửi thông tin, rồi KIỂM TRA hồ sơ đã thật sự có link về website chưa.',
            'Roughly $200–500 a year. Join, submit the details, then CHECK the listing actually links to the site.'),
    why: bi('Được coi là link địa phương chất lượng cao dễ lấy nhất. Đây là phí hội viên, không phải mua link.',
            'Widely called the easiest high-quality local link. This is a membership fee, not a purchased link.'),
  },
  {
    id: 'w-link-mentions', track: 'web', phase: 4, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 60,
    title: bi('Đòi link từ các trang đã nhắc tên tiệm', 'Reclaim links from pages already mentioning the shop'),
    how: bi('Gõ tên tiệm trong ngoặc kép trên Google. Trang nào nhắc tên mà không có link thì nhắn xin gắn link.',
            'Search the shop name in quotes. Any page that mentions it without linking gets a polite ask.'),
    why: bi('Miễn phí và tỷ lệ đồng ý cao nhất trong mọi cách xin link, vì họ đã nhắc tên rồi.',
            'Free, and the highest conversion rate of any link ask, because the mention already exists.'),
  },
  {
    id: 'w-link-sponsor', track: 'web', phase: 4, kind: 'manual', cadence: 'monthly', tiers: CROWDED, minutes: 120,
    title: bi('Tài trợ một sự kiện địa phương tháng này', 'Sponsor one local event this month'),
    how: bi('Đội bóng trường, hội chợ khu phố, sự kiện từ thiện. Yêu cầu trang cảm ơn có link về website.',
            'A school team, a neighbourhood fair, a charity night. Ask for a thank-you page that links back.'),
    why: bi('Link .org liên quan địa phương. Nhịp an toàn 5–10 link/tháng — nhảy từ 10 lên 100 link trong một tháng là tự chuốc rà soát thủ công.',
            'A locally relevant .org link. Five to ten a month is the safe pace — going from ten to a hundred invites a manual review.'),
  },
  {
    id: 'w-link-partners', track: 'web', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 90,
    title: bi('Đổi link với 2–3 tiệm bổ trợ không cạnh tranh', 'Swap links with complementary shops'),
    how: bi('Tiệm tóc, spa, studio ảnh cưới, tiệm áo cưới. Trang "đối tác" trên web hai bên.',
            'A hair salon, a spa, a wedding photographer, a bridal shop. A partners page on each site.'),
    why: bi('Quan hệ giới thiệu chéo trong ngành làm đẹp vốn đã có thật — link chỉ là ghi lại quan hệ đó.',
            'Beauty trades already refer to each other — the link just records a relationship that exists.'),
  },
  {
    id: 'w-link-news', track: 'web', phase: 4, kind: 'manual', cadence: 'once', tiers: DENSE, minutes: 300,
    title: bi('Viết một bài cho báo hoặc blog địa phương', 'Write one piece for a local paper or blog'),
    how: bi('Chủ đề hữu ích, không quảng cáo: "chăm móng mùa đông", "nhận biết tiệm nail sạch sẽ an toàn".',
            'Something useful, not an advert: winter nail care, how to spot a hygienic shop.'),
    why: bi('Link báo địa phương vừa mạnh vừa liên quan, và gần như không tiệm nail nào làm.',
            'Strong and relevant, and almost no nail shop does it.'),
  },
  {
    id: 'w-traffic-owned', track: 'web', phase: 4, kind: 'manual', cadence: 'weekly', tiers: ALL, minutes: 30,
    title: bi('Kéo người thật vào website bằng kênh mình có', 'Drive real people to the site from channels you own'),
    how: bi('Bài đăng Google Business trỏ về trang dịch vụ · link trong bio Instagram/Facebook · tin nhắn hậu mãi kèm link bài hướng dẫn chăm móng.',
            'Google Business posts pointing at a service page, the link in the Instagram and Facebook bio, and the post-visit message carrying a link to the aftercare guide.'),
    why: bi('TUYỆT ĐỐI không mua traffic. Traffic mua là bot: vào rồi thoát ngay, dạy Google đúng một điều là trang này không đáng ở lại. Tiền mất, thứ hạng hỏng.',
            'Never buy traffic. Bought traffic is bots: they arrive and leave instantly, teaching Google exactly one thing — that nobody stays. Money gone, ranking damaged.'),
  },

  // ---- W5: measure and hold ------------------------------------------------
  {
    id: 'w-gsc-monthly', track: 'web', phase: 5, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 45,
    title: bi('Đọc Search Console tháng này', 'Read Search Console this month'),
    how: bi('Ba cột cần nhìn: từ khóa nào lên, từ khóa nào tụt, và từ khóa nào đang ở hạng 8–20. Nhóm cuối là nhóm dễ đẩy lên trang 1 nhất.',
            'Three things: which terms rose, which fell, and which sit at positions 8–20. That last group is the cheapest to push onto page one.'),
    why: bi('Từ khóa đang hạng 8–20 chỉ cần bổ sung nội dung là lên trang 1 — rẻ hơn nhiều so với nhắm một từ khóa mới từ con số không.',
            'A term at 8–20 often only needs more content to reach page one — far cheaper than starting a new term from nothing.'),
  },
  {
    id: 'w-rank-check', track: 'web', phase: 5, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 30,
    title: bi('Kiểm tra thứ hạng bộ từ khóa mục tiêu', 'Check where the target keywords stand'),
    how: bi('Chế độ ẩn danh, hoặc dùng thứ hạng trung bình trong Search Console. Ghi vào bảng cùng chỗ với lưới điểm bản đồ.',
            'Incognito, or the average position in Search Console. Record it next to the map grid.'),
    why: bi('Đừng đo bằng cách tự gõ trên máy quen — kết quả đã cá nhân hóa theo lịch sử của chính mình.',
            'Do not measure on your own machine — the results are already personalised by your own history.'),
  },
];

// ---- reading the board -----------------------------------------------------

export type TaskState = 'done' | 'todo' | 'unknown';

/**
 * Which period a recurring job belongs to.
 *
 * A weekly job ticked last Friday is NOT done this Monday, and a board that
 * says otherwise is lying about the one habit the whole strategy rests on.
 * The key is compared as a string, so "same period" needs no date arithmetic
 * at read time and cannot drift by a day at a month boundary.
 *
 * Weeks run Monday-based ISO, because a Sunday tick and a Monday tick landing
 * in different weeks is what a salon actually experiences.
 */
export function periodKey(cadence: Cadence, at: Date): string {
  if (cadence === 'once') return 'once';
  const y = at.getUTCFullYear();
  if (cadence === 'monthly') return `${y}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  if (cadence === 'quarterly') return `${y}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
  // ISO week: Thursday of the same week decides the year, which is what makes
  // the last days of December land in the right week rather than week 1.
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface RoadmapTaskView extends RoadmapTask {
  state: TaskState;
  at?: string | null;
  by?: string | null;
  /** True when the system decided this, so the UI can say so and hide the box. */
  auto: boolean;
  /** True when this is a recurring job whose period has rolled over. */
  recurring: boolean;
}

export interface TrackView {
  track: Track;
  phases: (RoadmapPhase & {
    tasks: RoadmapTaskView[]; done: number; total: number;
    /** Weeks still expected for THIS phase at this tier, or null when done. */
    weeksLeft: [number, number] | null;
  })[];
  done: number;
  total: number;
  next: RoadmapTaskView | null;
  /** Weeks to clear everything unfinished on this track, at this tier. */
  weeksToGoal: [number, number];
}

export interface RoadmapView {
  tier: Tier;
  tracks: TrackView[];
  /**
   * What is actually due right now, across both tracks.
   *
   * A person opening a board of sixty jobs across two tracks and eleven phases
   * does not know where to start, and the honest answer is short: every
   * recurring job whose period has rolled over, plus the next one-off on each
   * track. Everything else is not due today, and saying so is the difference
   * between a plan and a wall.
   */
  dueNow: RoadmapTaskView[];
}

export function buildRoadmap(
  checks: Record<string, string>,
  ticks: Record<string, { done?: boolean; at?: string; by?: string }>,
  tier: Tier = 'medium',
  now: Date = new Date(),
): RoadmapView {
  const view = (t: RoadmapTask): RoadmapTaskView => {
    if (t.kind === 'check' && t.from) {
      const verdict = checks[t.from.key];
      if (!verdict || verdict === 'unknown') return { ...t, state: 'unknown', auto: true, recurring: false };
      return {
        ...t, auto: true, recurring: false,
        state: (t.from.doneOn as string[]).includes(verdict) ? 'done' : 'todo',
      };
    }
    const tick = ticks[t.id];
    const recurring = t.cadence !== 'once';
    // A recurring job is done only within the period it was ticked in.
    const stillDone = Boolean(
      tick?.done
      && (!recurring || (tick.at && periodKey(t.cadence, new Date(tick.at)) === periodKey(t.cadence, now))),
    );
    return {
      ...t,
      state: stillDone ? 'done' : 'todo',
      at: tick?.at ?? null,
      by: tick?.by ?? null,
      auto: false,
      recurring,
    };
  };

  const buildTrack = (track: Track): TrackView => {
    const src = track === 'map' ? PHASES : WEB_PHASES;
    const cat = track === 'map' ? TASKS : WEB_TASKS;
    const phases = src.map((p) => {
      const tasks = cat.filter((t) => t.phase === p.n && t.tiers.includes(tier)).map(view);
      const done = tasks.filter((t) => t.state === 'done').length;
      const [lo, hi] = p.weeks[tier];
      return {
        ...p, tasks, done, total: tasks.length,
        // A phase with no work at this tier costs no time — showing "2–4 weeks"
        // for an empty phase would inflate every quote made from this board.
        weeksLeft: tasks.length === 0 || done === tasks.length ? null : ([lo, hi] as [number, number]),
      };
    });
    const all = phases.flatMap((p) => p.tasks);
    const remaining = phases.reduce<[number, number]>(
      (acc, p) => (p.weeksLeft ? [acc[0] + p.weeksLeft[0], acc[1] + p.weeksLeft[1]] : acc),
      [0, 0],
    );
    return {
      track,
      phases,
      done: all.filter((t) => t.state === 'done').length,
      total: all.length,
      // 'unknown' is not "next": nobody can act on a task the system cannot see
      // the state of, and putting one here would stall the list permanently.
      next: all.find((t) => t.state === 'todo') ?? null,
      weeksToGoal: remaining,
    };
  };

  const tracks = TRACKS.map(buildTrack);

  // Recurring first, deliberately: a missed week of asking for reviews cannot
  // be made up later, while a one-off waits without decaying.
  const everyTask = tracks.flatMap((t) => t.phases.flatMap((p) => p.tasks));
  const dueNow = [
    ...everyTask.filter((t) => t.recurring && t.state === 'todo'),
    // The next one-off on each track, found on its own rather than reused from
    // `next`: `next` may itself be a recurring job, and filtering it out would
    // leave that track with nothing to advance to and the plan standing still.
    ...tracks
      .map((t) => t.phases.flatMap((p) => p.tasks).find((x) => x.state === 'todo' && !x.recurring))
      .filter((t): t is RoadmapTaskView => Boolean(t)),
  ];

  return { tier, tracks, dueNow };
}

/** Ids a person is allowed to tick. A `check` task is decided by measurement,
 *  and letting anyone override it would make the whole board untrustworthy. */
export function manualTaskIds(): string[] {
  return allTasks().filter((t) => t.kind === 'manual').map((t) => t.id);
}

/** Both catalogs, in track order. */
export function allTasks(): RoadmapTask[] { return [...TASKS, ...WEB_TASKS]; }
export function allPhases(): RoadmapPhase[] { return [...PHASES, ...WEB_PHASES]; }

/** Validate a stored tier. Anything unrecognised becomes 'medium' — see the
 *  note on the Tier type for why that is the safe direction to fail. */
export function asTier(v: unknown): Tier {
  return TIERS.includes(v as Tier) ? (v as Tier) : 'medium';
}
