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
export type Cadence = 'once' | 'weekly' | 'monthly' | 'quarterly';
export type TaskKind = 'manual' | 'check';

export interface RoadmapTask {
  id: string;
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
    n: 0,
    title: bi('Đo được đã', 'Get something you can measure'),
    goal: bi('Chưa biết tiệm đang đứng ở đâu thì mọi việc sau đó là phỏng đoán.',
             'Until you know where the shop stands, everything after is guesswork.'),
    target: bi('Có một tấm lưới điểm ngày số 0 và một con số booking gốc.',
               'A day-zero geogrid image and a baseline booking number, both saved.'),
    weeks: { low: [1, 1], medium: [1, 2], high: [1, 2] },
  },
  {
    n: 1,
    title: bi('Hồ sơ đúng đã', 'Get the profile right'),
    goal: bi('Hồ sơ Google chiếm khoảng một phần ba tất cả những gì mình can thiệp được — và phần lớn chỉ là điền cho đúng.',
             'The Google profile is about a third of everything you control, and most of it is just filling fields in correctly.'),
    target: bi('Không còn ô trống nào trong hồ sơ, và lưới điểm bắt đầu hiện tiệm ở vài điểm gần tiệm.',
               'No empty fields left, and the grid starts showing the shop at points near it.'),
    weeks: { low: [2, 4], medium: [3, 5], high: [3, 6] },
  },
  {
    n: 2,
    title: bi('Nhịp đánh giá', 'Build the review rhythm'),
    goal: bi('Nhịp đều thắng số lượng lớn nhưng cũ. Đây là quãng dài nhất và là quãng thắng thua.',
             'A steady trickle beats a large but stale pile. The longest stretch, and where it is won.'),
    target: bi('Bốn tuần liên tiếp tuần nào cũng có đánh giá mới, và không còn đánh giá nào chưa trả lời.',
               'Four straight weeks with a new review in each, and nothing left unanswered.'),
    weeks: { low: [6, 10], medium: [10, 16], high: [12, 20] },
  },
  {
    n: 3,
    title: bi('Hơn đối thủ ở chỗ cụ thể', 'Beat the shops above you, specifically'),
    goal: bi('Ở khu cạnh tranh, ba tiệm trên đầu đều đã làm đúng phần cơ bản. "Làm đủ" không còn nghĩa gì — phải hơn họ ở chỗ đếm được.',
             'Where it is crowded, the three shops above you already have the basics right. "Doing enough" means nothing — you must beat them somewhere countable.'),
    target: bi('Có bảng đối chiếu với 3 đối thủ, và hơn họ ở ít nhất 3 mục đo được.',
               'A filled comparison against three rivals, and a lead in at least three countable fields.'),
    weeks: { low: [2, 4], medium: [4, 8], high: [6, 12] },
  },
  {
    n: 4,
    title: bi('Uy tín ngoài hồ sơ', 'Authority outside the profile'),
    goal: bi('Backlink và citation cộng lại khoảng 14–22%. Đắt và chậm — nhưng ở khu dày đặc đây là chỗ còn trống, vì hầu như không tiệm nail nào làm.',
             'Links and citations together are roughly 14–22%. Expensive and slow — but in a crowded area this is the open ground, because almost no nail shop does it.'),
    target: bi('8–12 link địa phương thật, citation sạch và nhất quán ở các nguồn gốc.',
               'Eight to twelve real local links, and clean consistent citations at the source aggregators.'),
    weeks: { low: [0, 0], medium: [8, 16], high: [12, 24] },
  },
  {
    n: 5,
    title: bi('Giữ hạng', 'Hold it'),
    goal: bi('Hạng 1 rớt trong im lặng — không có thông báo nào, và doanh thu giảm sau thứ hạng vài tháng.',
             'First place slips quietly — nothing tells you, and revenue falls months after the ranking does.'),
    target: bi('Không bao giờ xong. Đây là chi phí duy trì, và là lý do bán được gói tháng.',
               'Never finished. This is the maintenance cost, and the reason a monthly retainer exists.'),
    weeks: { low: [0, 0], medium: [0, 0], high: [0, 0] },
  },
];

const ALL: Tier[] = ['low', 'medium', 'high'];
const CROWDED: Tier[] = ['medium', 'high'];
const DENSE: Tier[] = ['high'];

export const TASKS: RoadmapTask[] = [
  // ---- phase 0: measurement ------------------------------------------------
  {
    id: 'verify-gbp', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 20,
    title: bi('Xác minh và nhận quyền sở hữu hồ sơ Google', 'Verify and claim the Google profile'),
    how: bi('Vào google.com/business, tìm tiệm, làm theo bước xác minh. Nếu hồ sơ đang do người khác giữ thì nộp yêu cầu lấy lại quyền.',
            'Go to google.com/business, find the shop, follow the steps. If somebody else holds it, file a request to reclaim ownership.'),
    why: bi('Chưa xác minh thì không sửa được gì cả — mọi việc bên dưới đều bắt đầu từ đây.',
            'Nothing below can be done until this is. Every other task starts here.'),
  },
  {
    id: 'connect-gbp', phase: 0, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'keyword-match', doneOn: ['pass', 'warn'] },
    title: bi('Kết nối hồ sơ Google vào Lumio', 'Connect the Google profile to Lumio'),
    how: bi('Cài đặt → Google Reviews → kết nối. Sau khi kết nối, Google trả về danh sách từ khoá khách gõ để tìm tiệm.',
            'Settings → Google Reviews → connect. Google then returns the words people actually search to find the shop.'),
    why: bi('Không biết khách gõ gì thì mọi việc tối ưu sau đó chỉ là phỏng đoán.',
            'Without knowing what people type, every optimisation after this is a guess.'),
  },
  {
    id: 'baseline-grid', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Đo lưới điểm "ngày số 0"', 'Take the day-zero geogrid'),
    how: bi('Local Falcon hoặc BrightLocal, lưới 3–5 từ khoá chính trong bán kính 3 dặm. Lưu ảnh kèm ngày.',
            'Local Falcon or BrightLocal, three to five core keywords across a three-mile radius. Save the image with the date.'),
    why: bi('Ba tháng nữa không có cái này thì không chứng minh được với khách là mình đã làm được gì.',
            'Without it, in three months there is no way to show the client what the work achieved.'),
  },
  {
    id: 'set-tier', phase: 0, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 15,
    title: bi('Đếm đối thủ và chọn đúng mức cạnh tranh', 'Count the rivals and set the competition tier'),
    how: bi('Mở Google Maps, tìm từ khoá chính, đếm số tiệm cùng ngành trong bán kính 5 dặm. Chọn mức ở đầu trang này.',
            'Open Google Maps, search the core keyword, count same-trade shops within five miles. Set the tier at the top of this board.'),
    why: bi('Chọn sai mức là chọn sai cả lộ trình lẫn lời hứa về thời gian. Đây là việc quyết định mọi thứ phía sau.',
            'The wrong tier means the wrong plan and the wrong promise about time. This decides everything after it.'),
  },
  {
    id: 'baseline-bookings', phase: 0, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'search-share', doneOn: ['pass', 'warn'] },
    title: bi('Ghi lại số booking đang đến từ tìm kiếm', 'Record how many bookings search brings today'),
    how: bi('Hệ thống tự đếm. Nếu ra 0% thì kiểm tra xem có phải chưa gắn theo dõi nguồn không, trước khi kết luận bản đồ không mang khách.',
            'The system counts this. If it reads 0%, check whether booking-source tracking is wired at all before concluding the map brings nobody.'),
    why: bi('Đây là thước đo cuối cùng. Thứ hạng chỉ để phục vụ con số này.',
            'The final measure. Rankings exist only to serve this number.'),
  },

  // ---- phase 1: the profile -----------------------------------------------
  {
    id: 'primary-category', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 5,
    title: bi('Đặt đúng danh mục chính', 'Set the primary category correctly'),
    how: bi('Tiệm nail chọn "Nail salon", không chọn "Beauty salon" cho sang. Danh mục chính phải khớp dịch vụ ra tiền nhiều nhất.',
            'A nail shop picks "Nail salon", not the grander "Beauty salon". It must match the service that earns most.'),
    why: bi('Được gọi là trường quan trọng nhất trong toàn bộ hồ sơ. Chọn sai thì không đánh giá nào hay backlink nào bù lại được.',
            'Called the single most important field in the profile. Get it wrong and nothing compensates.'),
  },
  {
    id: 'secondary-categories', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 5,
    title: bi('Thêm danh mục phụ cho dịch vụ khác', 'Add secondary categories for the other services'),
    how: bi('Waxing, nối mi, chăm sóc da… mỗi thứ một danh mục phụ. Chỉ thêm dịch vụ tiệm thật sự làm.',
            'Waxing, lashes, facials — one each. Only what the shop genuinely does.'),
    why: bi('Danh mục phụ là yếu tố quan trọng thứ tám, và là cách duy nhất để hồ sơ hiện ra cho dịch vụ ngoài nghề chính.',
            'Eighth most important, and the only way to surface for anything but the main trade.'),
  },
  {
    id: 'hours-exact', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 10,
    title: bi('Khai đúng giờ mở cửa, kể cả giờ nghỉ', 'Get opening hours exactly right, breaks included'),
    how: bi('Khai đúng giờ thật. Tự tìm tiệm lúc 8 giờ tối xem Google hiện "Đang mở" hay "Đã đóng cửa" cho đúng.',
            'Enter the real hours. Search at eight in the evening and check Google says open or closed correctly.'),
    why: bi('Yếu tố quan trọng thứ năm. Nhóm gõ "nail salon open now" là nhóm sẵn sàng bước vào cửa nhất trong ngày.',
            'Fifth most important. People typing "nail salon open now" are the readiest to walk in of anyone.'),
  },
  {
    id: 'services-prices', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 45,
    title: bi('Điền đầy đủ dịch vụ kèm giá', 'Fill in every service, with prices'),
    how: bi('Mục Dịch vụ trong hồ sơ. Tên dịch vụ đúng như khách gọi, kèm giá thật.',
            'The Services section. Name each one the way customers do, with real prices.'),
    why: bi('Hồ sơ có giá được bấm nhiều hơn hẳn — và lượt bấm là tín hiệu hành vi, chiếm khoảng 9% thứ hạng.',
            'Profiles with prices get clicked far more, and clicks are behavioural signal, worth around nine percent.'),
  },
  {
    id: 'attributes', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 10,
    title: bi('Bật hết thuộc tính đúng với tiệm', 'Switch on every attribute that is true'),
    how: bi('Chỗ đậu xe, nhận khách vãng lai, thanh toán thẻ, wifi, phù hợp trẻ em… chỉ bật cái đúng.',
            'Parking, walk-ins, card payment, wifi, good for kids — only the ones that are true.'),
    why: bi('Thuộc tính là cách Google hiểu tiệm hợp với ai, và nó hiện thành nhãn ngay trong kết quả.',
            'Attributes are how Google works out who the shop suits, and they show as labels in the results.'),
  },
  {
    id: 'photos-20', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 60,
    title: bi('Đăng tối thiểu 20 ảnh thật', 'Upload at least twenty real photos'),
    how: bi('Mặt tiền, biển hiệu, bên trong, chỗ ngồi, thợ đang làm, thành phẩm. Chụp tại tiệm, không ảnh kho.',
            'Storefront, sign, inside, seating, techs working, finished work. Shot in the shop — never stock.'),
    why: bi('Ảnh quyết định người ta bấm vào tiệm nào trong ba tiệm hiện cạnh nhau.',
            'Photos decide which of the three shops side by side gets tapped.'),
  },
  {
    id: 'description', phase: 1, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 20,
    title: bi('Viết mô tả có nhắc dịch vụ và khu vực', 'Write a description naming services and area'),
    how: bi('750 ký tự. Nhắc dịch vụ chính và tên khu vực tự nhiên. Không nhồi từ khoá.',
            '750 characters. Name the main services and the area naturally. No stuffing.'),
    why: bi('Không phải yếu tố nặng, nhưng là chỗ nói rõ tiệm bán gì cho cả Google lẫn người đọc.',
            'Not a heavy factor, but where both Google and a reader learn what the shop sells.'),
  },
  {
    id: 'holiday-hours', phase: 1, kind: 'manual', cadence: 'quarterly', tiers: ALL, minutes: 10,
    title: bi('Khai giờ đặc biệt cho các ngày lễ sắp tới', 'Set special hours for the holidays ahead'),
    how: bi('Khai trước ít nhất một tuần cho mỗi kỳ nghỉ trong quý tới.',
            'Enter them at least a week before each holiday in the coming quarter.'),
    why: bi('Google hạ tin cậy hồ sơ có giờ sai, và khách tới nơi thấy đóng cửa thường để lại đánh giá xấu.',
            'Google trusts a profile with wrong hours less, and a customer at a locked door often reviews it.'),
  },

  // ---- phase 2: reviews ----------------------------------------------------
  {
    id: 'review-count', phase: 2, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'review-count', doneOn: ['pass'] },
    title: bi('Đạt nền đánh giá tối thiểu', 'Reach a working review base'),
    how: bi('Xin đánh giá ngay lúc thanh toán, đưa mã QR. Một khách vui mỗi ngày là đủ.',
            'Ask at checkout, with a QR code. One happy customer a day is enough.'),
    why: bi('Số đánh giá là yếu tố nặng nhất quyết định tiệm có lọt vào ba kết quả bản đồ hay không.',
            'The heaviest single thing deciding whether the shop makes the three-result pack at all.'),
  },
  {
    id: 'review-velocity', phase: 2, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'review-velocity', doneOn: ['pass'] },
    title: bi('Giữ nhịp tối thiểu 4 đánh giá mỗi tháng', 'Keep at least four new reviews a month'),
    how: bi('Tuần nào cũng phải có ít nhất một. Đừng dồn cục — 20 đánh giá trong một tuần trông như mua và bị lọc.',
            'At least one every week. Never in a batch — twenty in a week looks bought and gets filtered.'),
    why: bi('Hồ sơ 200 đánh giá mà cả năm không có cái mới thua hồ sơ 60 đánh giá tuần nào cũng có thêm.',
            'Two hundred reviews and none this year loses to sixty that gains one every week.'),
  },
  {
    id: 'review-replies', phase: 2, kind: 'check', cadence: 'once', tiers: ALL, from: { key: 'review-replies', doneOn: ['pass'] },
    title: bi('Trả lời từ 80% đánh giá trở lên', 'Reply to eighty percent of reviews or more'),
    how: bi('Đánh giá xấu trả lời trước, trong ngày. Ngắn, thật, không dùng mẫu copy dán.',
            'Bad ones first, same day. Short, real replies — never a template.'),
    why: bi('Mức 80% có tác động đo được lên thứ hạng. Và người đọc review xấu quan tâm cách tiệm phản hồi hơn nội dung phàn nàn.',
            'Eighty percent shows a measurable effect. And whoever reads a bad review cares more about the reply.'),
  },
  {
    id: 'review-qr', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Đặt mã QR xin đánh giá tại quầy', 'Put a review QR code on the counter'),
    how: bi('In mã QR link thẳng tới ô viết đánh giá Google. Dán ở quầy thanh toán, không để trong ngăn kéo.',
            'Print a QR going straight to the Google review box. On the pay counter, not in a drawer.'),
    why: bi('Khoảng cách giữa "định xin" và "xin được" là một tấm QR trong tầm tay lúc khách đang trả tiền.',
            'The gap between meaning to ask and asking is a QR within reach while she pays.'),
  },
  {
    id: 'daily-review-ask', phase: 2, kind: 'manual', cadence: 'weekly', tiers: ALL, minutes: 35,
    title: bi('Tuần này đã xin đủ đánh giá chưa', 'Did this week bring in its reviews'),
    how: bi('Mỗi ngày xin một khách vui nhất. Cuối tuần đếm: dưới 1 đánh giá mới là tuần thất bại, bù ngay tuần sau.',
            'Ask the happiest customer each day. Count on Friday: under one new review is a failed week — make it up next week.'),
    why: bi('Đây là việc duy nhất trong cả lộ trình phải làm mỗi tuần, mãi mãi. Đứt nhịp là thứ Google thấy đầu tiên.',
            'The one job here that must happen every week, forever. A broken rhythm is the first thing Google notices.'),
  },
  {
    id: 'review-keywords', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 15,
    title: bi('Hướng khách nhắc tên dịch vụ trong đánh giá', 'Get service names into the review text'),
    how: bi('Nói với khách: "chị nhắc giúp em dịch vụ chị làm hôm nay nhé". Không đọc mẫu cho khách chép.',
            'Say: "would you mention which service you had today?" Never dictate words to copy.'),
    why: bi('Chữ trong đánh giá giúp Google hiểu tiệm bán gì — và hiện thành nhãn lý do ngay dưới hồ sơ.',
            'Words inside reviews teach Google what the shop sells, and surface as justification labels.'),
  },
  {
    id: 'gbp-posts', phase: 2, kind: 'manual', cadence: 'weekly', tiers: ALL, minutes: 30,
    title: bi('Đăng 2–3 bài lên hồ sơ tuần này', 'Post two or three times on the profile this week'),
    how: bi('Bài nào cũng kèm ảnh. Bộ móng vừa làm xong là nguồn ảnh có sẵn mỗi ngày.',
            'Every post carries a photo. The set you just finished is a source that exists every day.'),
    why: bi('Tiệm đăng đều tăng trung bình 2,3 hạng trong 6 tháng so với tiệm không đăng gì.',
            'Shops posting weekly gain an average of 2.3 positions over six months against shops posting nothing.'),
  },
  {
    id: 'qna-seed', phase: 2, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Tự đặt và trả lời 5–7 câu hỏi thường gặp', 'Seed five to seven common questions and answer them'),
    how: bi('Mục Hỏi & Đáp. Giá, đậu xe, có nhận walk-in không, có làm cho trẻ em không, có nhận thẻ không.',
            'The Q&A section. Price, parking, walk-ins, children, card payment.'),
    why: bi('Ai cũng đặt được câu hỏi lên hồ sơ tiệm mình. Không tự trả lời trước thì người lạ trả lời hộ.',
            'Anyone can post a question on your profile. Leave it and a stranger answers for you.'),
  },

  // ---- phase 3: beating the shops above you --------------------------------
  {
    id: 'competitor-table', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 90,
    title: bi('Lập bảng đối chiếu với 3 tiệm đang đứng trên', 'Build the comparison table against the three above you'),
    how: bi('Tìm từ khoá chính ở chế độ ẩn danh, ghi 3 tiệm trong top. Đối chiếu 8 mục: danh mục chính, danh mục phụ, thuộc tính, số đánh giá, nhịp đánh giá/tháng, tỷ lệ trả lời, số ảnh và lần đăng gần nhất, nhịp đăng bài.',
            'Search the core keyword in incognito, note the three in the pack. Compare eight fields: primary category, secondary categories, attributes, review count, reviews per month, reply rate, photo count and last upload, posting frequency.'),
    why: bi('Ở khu cạnh tranh, "làm đủ checklist" không còn nghĩa gì vì họ cũng làm đủ. Phải biết hơn họ đúng ở đâu, bằng con số.',
            'Where it is crowded, "completing the checklist" means nothing because they completed it too. You need to know where you beat them, in numbers.'),
  },
  {
    id: 'beat-categories', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 20,
    title: bi('Bằng hoặc hơn họ về số danh mục phụ', 'Match or beat their secondary category count'),
    how: bi('Lấy từ bảng đối chiếu: danh mục nào họ có mà mình không có, và tiệm mình thật sự làm dịch vụ đó thì thêm vào.',
            'From the table: which categories they have and you do not — add the ones the shop genuinely does.'),
    why: bi('Đây là mục rẻ nhất và nhanh nhất trong cả giai đoạn này, và thường là chỗ chênh lệch rõ nhất.',
            'The cheapest and fastest item in this phase, and often where the gap is clearest.'),
  },
  {
    id: 'beat-velocity', phase: 3, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 20,
    title: bi('Tháng này nhịp đánh giá có hơn họ không', 'Did this month beat their review pace'),
    how: bi('Mở hồ sơ 2 đối thủ mạnh nhất, đếm đánh giá mới trong tháng của họ, so với mình. Ghi vào bảng.',
            'Open the two strongest rivals, count their new reviews this month against yours. Write it down.'),
    why: bi('Nhịp của mình chỉ có nghĩa khi so với nhịp của họ. Hơn họ mỗi tháng là thắng, kém là đang tụt dù số vẫn tăng.',
            'Your pace only means something next to theirs. Beating them monthly is winning; trailing is slipping even while your number rises.'),
  },
  {
    id: 'hero-photos', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 120,
    title: bi('Chụp lại ảnh đại diện và ảnh bìa cho tử tế', 'Reshoot the profile and cover photos properly'),
    how: bi('Một buổi chụp có đèn, ảnh sáng và sắc nét. Đây là hai tấm được nhìn nhiều nhất trong cả hồ sơ.',
            'One session with proper light — bright and sharp. The two most-looked-at frames in the profile.'),
    why: bi('Ở giai đoạn này ba tiệm đều đã làm đúng phần cơ bản. Ảnh là thứ quyết định người ta bấm vào ai.',
            'By now all three have the basics right. The photo decides who gets tapped.'),
  },
  {
    id: 'booking-link', phase: 3, kind: 'manual', cadence: 'once', tiers: ALL, minutes: 30,
    title: bi('Bật đặt lịch trực tiếp từ Google', 'Turn on booking straight from Google'),
    how: bi('Gắn link đặt lịch Lumio vào nút "Đặt lịch" trên hồ sơ. Rút đường từ tìm kiếm tới booking còn một cú bấm.',
            'Put the Lumio booking link on the profile booking button. Search-to-booking becomes one tap.'),
    why: bi('Tạo tín hiệu hành vi mạnh nhất có thể, và biến thứ hạng thành con số booking đo được.',
            'The strongest behavioural signal available, and it turns ranking into a booking number you can count.'),
  },
  {
    id: 'area-mentions', phase: 3, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 15,
    title: bi('Hướng đánh giá nhắc tên khu vực', 'Get the neighbourhood named in reviews'),
    how: bi('"Tiệm nail gần Main Street" — tên đường, tên khu, tên trung tâm thương mại gần đó.',
            'A street, a district, the mall nearby — "the nail place near Main Street".'),
    why: bi('Giúp hồ sơ liên quan hơn ở đúng vùng mình muốn phủ, trong giới hạn mà khoảng cách cho phép.',
            'Raises relevance in the area you are trying to cover, within what proximity allows.'),
  },
  {
    id: 'service-pages', phase: 3, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 240,
    title: bi('Dựng trang riêng cho 3 dịch vụ giá cao nhất', 'Build a page for each of the three highest-value services'),
    how: bi('Mỗi dịch vụ một trang: mô tả, giá, ảnh thật, câu hỏi thường gặp, nút đặt lịch, schema LocalBusiness. Nhắc tên thành phố tự nhiên.',
            'One page each: description, price, real photos, FAQ, booking button, LocalBusiness schema. Name the city naturally.'),
    why: bi('On-page chiếm 15–19%. Ở khu dày, ba tiệm đầu bảng thường chỉ có mỗi trang chủ — đây là chỗ còn trống thật.',
            'On-page is 15–19%. In a crowded area the top three usually have only a homepage — this is genuinely open ground.'),
  },
  {
    id: 'spam-sweep', phase: 3, kind: 'manual', cadence: 'monthly', tiers: CROWDED, minutes: 30,
    title: bi('Rà và báo cáo hồ sơ vi phạm trong khu', 'Sweep and report policy-breaking profiles nearby'),
    how: bi('Tên nhồi từ khoá ("ABC Nails Best Nail Salon Kerrville"), hồ sơ ma không có mặt tiền, địa chỉ trùng nhà dân. Báo qua Business Redressal Form.',
            'Keyword-stuffed names, ghost listings with no storefront, addresses that are houses. Report via the Business Redressal Form.'),
    why: bi('Ở cụm tiệm nail Việt đây là đòn bẩy cao bất thường: gỡ được một hồ sơ giả là cả bảng đẩy lên một bậc. Phải làm hàng tháng, không phải một lần.',
            'In a dense Vietnamese nail cluster this is unusually high-leverage: removing one fake listing lifts everyone below it a place. Monthly, not once.'),
  },

  // ---- phase 4: authority outside the profile ------------------------------
  {
    id: 'citation-core', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 120,
    title: bi('Sửa dữ liệu ở các nguồn gốc: Data Axle, Foursquare, Bing, Yelp', 'Fix the data at the source: Data Axle, Foursquare, Bing, Yelp'),
    how: bi('Sửa ở nguồn gốc trước — dữ liệu từ đó chảy xuống hàng trăm trang nhỏ. Tên, địa chỉ, số điện thoại phải giống nhau tuyệt đối, tới từng dấu chấm.',
            'Fix the aggregators first — their data flows down to hundreds of smaller sites. Name, address, phone identical everywhere, down to the punctuation.'),
    why: bi('Sai lệch còn hại hơn thiếu: thuật toán không xác minh được đây là một tiệm hay hai, và thứ hạng thành bấp bênh.',
            'Inconsistency hurts more than absence: the algorithm cannot tell one business from two, and rankings become unstable.'),
  },
  {
    id: 'citation-duplicates', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 90,
    title: bi('Tìm và gỡ hồ sơ trùng của chính tiệm', 'Find and remove your own duplicate listings'),
    how: bi('Tìm tên tiệm, số điện thoại cũ, địa chỉ cũ trên Google Maps, Yelp, Apple Maps. Hồ sơ trùng thì yêu cầu gộp hoặc gỡ.',
            'Search the name, the old phone, the old address on Google Maps, Yelp, Apple Maps. Request a merge or removal for each duplicate.'),
    why: bi('Hồ sơ trùng chia đôi tín hiệu: đánh giá bị tách ra, thứ hạng bấp bênh. Tiệm sang tay hoặc đổi chỗ gần như luôn có vấn đề này.',
            'Duplicates split the signal: reviews divide, rankings wobble. A shop that changed hands or moved almost always has this.'),
  },
  {
    id: 'link-chamber', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 60,
    title: bi('Vào phòng thương mại địa phương', 'Join the local chamber of commerce'),
    how: bi('Khoảng 200–500 USD/năm. Đăng ký, gửi thông tin tiệm, kiểm tra hồ sơ đã có link về website chưa.',
            'Roughly $200–500 a year. Join, submit the shop details, then check the listing actually links to the site.'),
    why: bi('Được coi là link địa phương chất lượng cao dễ lấy nhất. Một link, một lần trả tiền, giữ mãi.',
            'Widely called the easiest high-quality local link there is. One link, paid once a year, held indefinitely.'),
  },
  {
    id: 'link-mentions', phase: 4, kind: 'manual', cadence: 'once', tiers: CROWDED, minutes: 90,
    title: bi('Đòi link từ các bài đã nhắc tên tiệm', 'Reclaim links from pages that already mention the shop'),
    how: bi('Tìm tên tiệm trên Google, lọc trang nhắc tên mà không có link. Nhắn xin họ gắn link — tỷ lệ đồng ý cao vì họ đã nhắc rồi.',
            'Search the shop name, find pages mentioning it without a link. Ask them to link — conversion is high because the mention already exists.'),
    why: bi('Miễn phí, và là loại link dễ xin nhất trong tất cả các loại.',
            'Free, and the easiest kind of link to get of any.'),
  },
  {
    id: 'link-sponsor', phase: 4, kind: 'manual', cadence: 'monthly', tiers: DENSE, minutes: 120,
    title: bi('Tài trợ một sự kiện địa phương tháng này', 'Sponsor one local event this month'),
    how: bi('Đội bóng trường, hội chợ khu phố, sự kiện từ thiện. Khoảng 100–1.000 USD. Yêu cầu trang cảm ơn có link về website.',
            'A school team, a neighbourhood fair, a charity night. Around $100–1,000. Ask for a thank-you page that links to the site.'),
    why: bi('Link .org liên quan địa phương, và 1–2 cái mỗi tháng cộng dồn lại rất nhanh. Nhịp an toàn là 5–10 link/tháng — nhảy từ 10 lên 100 link trong một tháng trông đáng ngờ.',
            'A locally relevant .org link, and one or two a month compounds fast. Five to ten a month is the safe pace — going from ten to a hundred in a month looks suspicious.'),
  },
  {
    id: 'link-partners', phase: 4, kind: 'manual', cadence: 'once', tiers: DENSE, minutes: 90,
    title: bi('Đổi link với 2–3 tiệm bổ trợ không cạnh tranh', 'Swap links with two or three complementary shops'),
    how: bi('Tiệm tóc, spa, studio chụp ảnh cưới, tiệm áo cưới. Trang "đối tác" trên web hai bên.',
            'A hair salon, a spa, a wedding photographer, a bridal shop. A partners page on each site.'),
    why: bi('Link liên quan thật và không bị phạt khi đúng là quan hệ có thật. Ngành làm đẹp có sẵn quan hệ giới thiệu chéo.',
            'Genuinely relevant, and not penalised when the relationship is real. Beauty trades already refer to each other.'),
  },
  {
    id: 'link-news', phase: 4, kind: 'manual', cadence: 'once', tiers: DENSE, minutes: 300,
    title: bi('Viết một bài cho báo hoặc blog địa phương', 'Write one piece for a local paper or blog'),
    how: bi('Chủ đề hữu ích, không quảng cáo: "chăm móng mùa đông", "chọn tiệm nail an toàn vệ sinh thế nào".',
            'Something useful, not an advert: winter nail care, how to tell a hygienic shop from a risky one.'),
    why: bi('Link báo địa phương vừa mạnh vừa liên quan, và gần như không tiệm nail nào làm — đây là chỗ trống thật ở khu cạnh tranh cao.',
            'A local news link is strong and relevant, and almost no nail shop does it — genuinely open ground where it is crowded.'),
  },

  // ---- phase 5: holding ----------------------------------------------------
  {
    id: 'monthly-grid', phase: 5, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 30,
    title: bi('Đo lưới điểm tháng này', 'Run this month\'s geogrid'),
    how: bi('Cùng bộ từ khoá, cùng bán kính, cùng ngày trong tháng. Lưu ảnh cạnh ảnh tháng trước.',
            'Same keywords, same radius, same date each month. Save beside last month\'s.'),
    why: bi('Hạng 1 rớt trong im lặng. Không đo đều thì tới lúc phát hiện đã tụt ba tháng.',
            'First place slips quietly. Without a regular measurement, by the time anyone notices it has been gone three months.'),
  },
  {
    id: 'monthly-report', phase: 5, kind: 'manual', cadence: 'monthly', tiers: ALL, minutes: 45,
    title: bi('Gửi báo cáo tháng cho khách', 'Send the client the monthly report'),
    how: bi('Lưới điểm tháng này cạnh tháng trước, lượt gọi và chỉ đường trong Insights, và số booking đến từ Google.',
            'This month\'s grid beside last month\'s, calls and direction requests from Insights, bookings from Google.'),
    why: bi('Khách không thấy tiến triển là khách nghỉ ở tháng thứ ba, kể cả khi việc vẫn đang chạy đúng.',
            'A client who cannot see progress leaves in month three, even when the work is going exactly to plan.'),
  },
  {
    id: 'quarterly-audit', phase: 5, kind: 'manual', cadence: 'quarterly', tiers: ALL, minutes: 60,
    title: bi('Rà lại danh mục, giá và citation', 'Re-check categories, prices and citations'),
    how: bi('Google thêm danh mục mới liên tục — có thể đã có danh mục sát hơn. Đối chiếu giá hồ sơ với bảng giá thật, soát lại NAP.',
            'Google adds categories constantly — a closer one may exist now. Check profile prices against the real list, re-check NAP.'),
    why: bi('Danh mục sát hơn là một trong số ít thay đổi còn tạo được bước nhảy khi mọi thứ khác đã tối ưu.',
            'A closer category is one of the few remaining changes that can still move things once everything else is done.'),
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

export interface RoadmapView {
  tier: Tier;
  phases: (RoadmapPhase & {
    tasks: RoadmapTaskView[]; done: number; total: number;
    /** Weeks still expected for THIS phase at this tier, or null when done. */
    weeksLeft: [number, number] | null;
  })[];
  done: number;
  total: number;
  next: RoadmapTaskView | null;
  /** Weeks to clear everything still unfinished, at this tier. */
  weeksToGoal: [number, number];
}

/**
 * Merge the catalog with what the system measured and what a person ticked.
 *
 * `checks` is the seo-local report keyed by check id. A check that is missing
 * or 'unknown' yields state 'unknown', NOT 'todo': the difference between "we
 * looked and it is not done" and "we cannot see this yet" is the difference
 * between a task list and a guess, and the screen must be able to say both.
 */
export function buildRoadmap(
  checks: Record<string, string>,
  ticks: Record<string, { done?: boolean; at?: string; by?: string }>,
  tier: Tier = 'medium',
  now: Date = new Date(),
): RoadmapView {
  const view = (t: RoadmapTask): RoadmapTaskView => {
    if (t.kind === 'check' && t.from) {
      const s = checks[t.from.key];
      if (!s || s === 'unknown') return { ...t, state: 'unknown', auto: true, recurring: false };
      return {
        ...t, auto: true, recurring: false,
        state: (t.from.doneOn as string[]).includes(s) ? 'done' : 'todo',
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

  const phases = PHASES.map((p) => {
    const tasks = TASKS.filter((t) => t.phase === p.n && t.tiers.includes(tier)).map(view);
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
    tier,
    phases,
    done: all.filter((t) => t.state === 'done').length,
    total: all.length,
    // 'unknown' is not "next": nobody can act on a task the system cannot see
    // the state of, and putting one here would stall the list permanently.
    next: all.find((t) => t.state === 'todo') ?? null,
    weeksToGoal: remaining,
  };
}

/** Ids a person is allowed to tick. A `check` task is decided by measurement,
 *  and letting anyone override it would make the whole board untrustworthy. */
export function manualTaskIds(): string[] {
  return TASKS.filter((t) => t.kind === 'manual').map((t) => t.id);
}

/** Validate a stored tier. Anything unrecognised becomes 'medium' — see the
 *  note on the Tier type for why that is the safe direction to fail. */
export function asTier(v: unknown): Tier {
  return TIERS.includes(v as Tier) ? (v as Tier) : 'medium';
}
