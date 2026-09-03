/**
 * The Google Maps roadmap, as a thing you tick off.
 *
 * WHY A CHECKLIST AND NOT ANOTHER REPORT
 *
 * seo-local.ts already tells a salon what is wrong. It does not tell anyone
 * what to do first, or hold the place they got to — so every visit starts the
 * diagnosis again, and the work never accumulates. This is the other half:
 * an ordered list of jobs with a state, so an agency can walk one client
 * through it over three months and see at a glance where they stopped.
 *
 * THE THING THAT MAKES IT WORTH BUILDING HERE RATHER THAN IN A SPREADSHEET
 *
 * Some of these boxes tick THEMSELVES. This platform already counts a salon's
 * reviews, their arrival rate, the share replied to, whether Google returns
 * keywords for the profile, and how many bookings came from search. A task
 * tied to one of those is answered by measurement, not by someone's memory of
 * whether they did it — and a checklist that lies about its own state is
 * worse than no checklist, because people trust it.
 *
 * So each task is one of two kinds:
 *   - `check`  → the system decides, from the SEO report. Nobody can tick it,
 *                and nobody has to. It goes green when the number says so.
 *   - `manual` → only a person can know (did you fix the category? did you
 *                shoot twenty real photos?). Ticked by hand, with who and when.
 *
 * ORDER IS THE PRODUCT
 *
 * Phases are a real sequence, not decoration: the weights say the profile is
 * worth roughly a third of everything controllable and reviews a fifth, while
 * website and links together are under a third and cost the most. An agency
 * that sells a website in month one is selling the least effective thing
 * first. The phase numbers exist to make that argument visible on screen.
 */

import { bi, type Txt } from './i18n';

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
  /**
   * For `check` tasks: the seo-local check whose verdict decides this, and
   * which states count as done. A check that comes back 'unknown' leaves the
   * task neither done nor failed — "we cannot see this yet" is its own state
   * and must not be painted as failure.
   */
  from?: { key: string; doneOn: ('pass' | 'warn')[] };
  /** Rough time on task, so a week can be planned honestly. */
  minutes?: number;
}

export interface RoadmapPhase {
  n: number;
  title: Txt;
  when: Txt;
  goal: Txt;
}

export const PHASES: RoadmapPhase[] = [
  {
    n: 0,
    title: bi('Đo được đã', 'Get something you can measure'),
    when: bi('Tuần 1 · không tốn tiền', 'Week 1 · costs nothing'),
    goal: bi('Chưa biết tiệm đang đứng ở đâu thì mọi việc sau đó là phỏng đoán.',
             'Until you know where the shop stands, everything after this is guesswork.'),
  },
  {
    n: 1,
    title: bi('Hồ sơ đúng đã', 'Get the profile right'),
    when: bi('Tháng 1 · nặng nhất, rẻ nhất', 'Month 1 · the heaviest work, and the cheapest'),
    goal: bi('Hồ sơ Google chiếm khoảng một phần ba tất cả những gì mình can thiệp được — và phần lớn chỉ là điền cho đúng.',
             'The Google profile is roughly a third of everything you can control, and most of it is just filling fields in correctly.'),
  },
  {
    n: 2,
    title: bi('Nhịp đánh giá', 'Build the review rhythm'),
    when: bi('Tháng 1–5 · việc hàng ngày, mãi mãi', 'Months 1–5 · a daily job, forever'),
    goal: bi('Nhịp đều thắng số lượng lớn nhưng cũ. Đây là quãng dài nhất và là quãng thắng thua.',
             'A steady trickle beats a large but stale pile. This is the longest stretch, and where it is won or lost.'),
  },
  {
    n: 3,
    title: bi('Leo lên hạng 1', 'Climb to number one'),
    when: bi('Tháng 5–9', 'Months 5–9'),
    goal: bi('Ba tiệm trong top 3 đều đã làm đúng phần cơ bản. Thứ tách hạng 1 khỏi hạng 3 là hành vi người bấm.',
             'All three shops in the pack have the basics right. What separates first from third is what people click.'),
  },
  {
    n: 4,
    title: bi('Giữ hạng', 'Hold it'),
    when: bi('Mãi mãi · 3–4 giờ mỗi tháng', 'Forever · three or four hours a month'),
    goal: bi('Hạng 1 rớt trong im lặng — không có thông báo nào, và doanh thu giảm sau thứ hạng vài tháng.',
             'First place slips quietly — nothing tells you, and revenue falls months after the ranking does.'),
  },
];

export const TASKS: RoadmapTask[] = [
  // ---- phase 0: measurement ------------------------------------------------
  {
    id: 'verify-gbp', phase: 0, kind: 'manual', minutes: 20,
    title: bi('Xác minh và nhận quyền sở hữu hồ sơ Google', 'Verify and claim the Google profile'),
    how: bi('Vào google.com/business, tìm tiệm, làm theo bước xác minh. Nếu hồ sơ đang do người khác giữ thì nộp yêu cầu lấy lại quyền.',
            'Go to google.com/business, find the shop, follow the verification steps. If somebody else holds it, file a request to reclaim ownership.'),
    why: bi('Chưa xác minh thì không sửa được gì cả — mọi việc bên dưới đều bắt đầu từ đây.',
            'Nothing below can be done until this is done. Every other task starts here.'),
  },
  {
    id: 'connect-gbp', phase: 0, kind: 'check', from: { key: 'keyword-match', doneOn: ['pass', 'warn'] },
    title: bi('Kết nối hồ sơ Google vào Lumio', 'Connect the Google profile to Lumio'),
    how: bi('Cài đặt → Google Reviews → kết nối. Sau khi kết nối, Google trả về danh sách từ khoá khách gõ để tìm tiệm.',
            'Settings → Google Reviews → connect. Once connected, Google returns the words people actually search to find the shop.'),
    why: bi('Không biết khách gõ gì thì mọi việc tối ưu sau đó chỉ là phỏng đoán.',
            'Without knowing what people type, every optimisation after this is a guess.'),
  },
  {
    id: 'baseline-grid', phase: 0, kind: 'manual', minutes: 30,
    title: bi('Đo lưới điểm "ngày số 0"', 'Take the day-zero geogrid'),
    how: bi('Dùng Local Falcon hoặc BrightLocal, chạy lưới cho 3–5 từ khoá chính trong bán kính 3 dặm. Lưu ảnh lại kèm ngày.',
            'Run Local Falcon or BrightLocal on three to five core keywords across a three-mile radius. Save the image with the date on it.'),
    why: bi('Ba tháng nữa không có cái này thì không chứng minh được với khách là mình đã làm được gì.',
            'Without this, in three months there is no way to show the client what the work achieved.'),
  },
  {
    id: 'baseline-bookings', phase: 0, kind: 'check', from: { key: 'search-share', doneOn: ['pass', 'warn'] },
    title: bi('Ghi lại số booking đang đến từ tìm kiếm', 'Record how many bookings search brings today'),
    how: bi('Hệ thống tự đếm. Nếu ra 0% thì kiểm tra xem có phải chưa gắn theo dõi nguồn không, trước khi kết luận là bản đồ không mang khách.',
            'The system counts this. If it reads 0%, check whether booking-source tracking is even wired before concluding the map brings nobody.'),
    why: bi('Đây là thước đo cuối cùng. Thứ hạng chỉ để phục vụ con số này.',
            'This is the final measure. Rankings exist only to serve this number.'),
  },

  // ---- phase 1: the profile -----------------------------------------------
  {
    id: 'primary-category', phase: 1, kind: 'manual', minutes: 5,
    title: bi('Đặt đúng danh mục chính', 'Set the primary category correctly'),
    how: bi('Tiệm nail chọn "Nail salon", không chọn "Beauty salon" cho sang. Danh mục chính phải khớp dịch vụ ra tiền nhiều nhất.',
            'A nail shop picks "Nail salon", not the grander-sounding "Beauty salon". The primary category must match the service that earns the most.'),
    why: bi('Được gọi là trường quan trọng nhất trong toàn bộ hồ sơ. Chọn sai thì không đánh giá nào hay backlink nào bù lại được.',
            'Called the single most important field in the whole profile. Get it wrong and no volume of reviews or links compensates.'),
  },
  {
    id: 'secondary-categories', phase: 1, kind: 'manual', minutes: 5,
    title: bi('Thêm danh mục phụ cho dịch vụ khác', 'Add secondary categories for the other services'),
    how: bi('Waxing, nối mi, chăm sóc da… mỗi thứ một danh mục phụ. Chỉ thêm dịch vụ tiệm thật sự làm.',
            'Waxing, lashes, facials — one secondary category each. Only add what the shop genuinely does.'),
    why: bi('Danh mục phụ là yếu tố quan trọng thứ tám, và là cách duy nhất để hồ sơ hiện ra cho dịch vụ ngoài nghề chính.',
            'Secondary categories rank eighth in importance, and are the only way the profile surfaces for anything but the main trade.'),
  },
  {
    id: 'hours-exact', phase: 1, kind: 'manual', minutes: 10,
    title: bi('Khai đúng giờ mở cửa, kể cả giờ nghỉ', 'Get opening hours exactly right, breaks included'),
    how: bi('Khai đúng giờ thật. Tự tìm tiệm lúc 8 giờ tối xem Google hiện "Đang mở" hay "Đã đóng cửa" cho đúng.',
            'Enter the real hours. Search for the shop at eight in the evening and check Google says open or closed correctly.'),
    why: bi('Yếu tố quan trọng thứ năm. Nhóm gõ "nail salon open now" là nhóm sẵn sàng bước vào cửa nhất trong ngày.',
            'The fifth most important factor. People typing "nail salon open now" are the readiest to walk in of anyone all day.'),
  },
  {
    id: 'holiday-hours', phase: 1, kind: 'manual', minutes: 10,
    title: bi('Khai giờ đặc biệt ngày lễ', 'Set special hours for holidays'),
    how: bi('Khai trước ít nhất một tuần cho mỗi kỳ nghỉ. Lễ mà đóng cửa không khai là mất khách và mất điểm.',
            'Enter them at least a week ahead of each holiday. Closing without saying so loses customers and standing at once.'),
    why: bi('Google hạ tin cậy hồ sơ có giờ sai, và khách tới nơi thấy đóng cửa thường để lại đánh giá xấu.',
            'Google trusts a profile with wrong hours less, and a customer who arrives to a locked door often leaves a review about it.'),
  },
  {
    id: 'services-prices', phase: 1, kind: 'manual', minutes: 45,
    title: bi('Điền đầy đủ dịch vụ kèm giá', 'Fill in every service, with prices'),
    how: bi('Mục Dịch vụ trong hồ sơ. Ghi tên dịch vụ đúng như khách gọi, kèm giá thật.',
            'The Services section of the profile. Name each one the way customers do, with real prices.'),
    why: bi('Hồ sơ có giá được bấm nhiều hơn hẳn — và số lượt bấm là tín hiệu hành vi, thứ chiếm khoảng 9% thứ hạng.',
            'Profiles with prices get clicked far more, and clicks are behavioural signal, worth around nine percent of ranking.'),
  },
  {
    id: 'attributes', phase: 1, kind: 'manual', minutes: 10,
    title: bi('Bật hết thuộc tính đúng với tiệm', 'Switch on every attribute that is true'),
    how: bi('Chỗ đậu xe, nhận khách vãng lai, thanh toán thẻ, có wifi, phù hợp trẻ em… chỉ bật cái đúng.',
            'Parking, walk-ins welcome, card payment, wifi, good for kids — only the ones that are true.'),
    why: bi('Thuộc tính là cách Google hiểu tiệm hợp với ai, và nó hiện thành nhãn ngay trong kết quả tìm kiếm.',
            'Attributes are how Google works out who the shop suits, and they show as labels right in the results.'),
  },
  {
    id: 'photos-20', phase: 1, kind: 'manual', minutes: 60,
    title: bi('Đăng tối thiểu 20 ảnh thật', 'Upload at least twenty real photos'),
    how: bi('Mặt tiền, biển hiệu, bên trong, chỗ ngồi, thợ đang làm, thành phẩm. Ảnh chụp tại tiệm, không dùng ảnh kho.',
            'The storefront, the sign, inside, the seating, techs working, finished work. Shot in the shop — never stock images.'),
    why: bi('Ảnh là thứ quyết định người ta bấm vào tiệm nào trong ba tiệm hiện ra cạnh nhau.',
            'Photos decide which of the three shops sitting side by side a person taps.'),
  },
  {
    id: 'description', phase: 1, kind: 'manual', minutes: 20,
    title: bi('Viết mô tả tiệm có nhắc dịch vụ và khu vực', 'Write a description naming the services and the area'),
    how: bi('750 ký tự. Nhắc tên dịch vụ chính và tên khu vực một cách tự nhiên. Không nhồi từ khoá.',
            'Seven hundred and fifty characters. Name the main services and the area naturally. No keyword stuffing.'),
    why: bi('Mô tả không phải yếu tố nặng, nhưng là chỗ nói rõ tiệm bán gì cho cả Google lẫn người đọc.',
            'The description is not a heavy factor, but it is where both Google and a reader learn what the shop sells.'),
  },

  // ---- phase 2: reviews ----------------------------------------------------
  {
    id: 'review-count', phase: 2, kind: 'check', from: { key: 'review-count', doneOn: ['pass'] },
    title: bi('Đạt nền đánh giá tối thiểu', 'Reach a working review base'),
    how: bi('Xin đánh giá ngay lúc thanh toán, đưa mã QR. Một khách vui mỗi ngày là đủ.',
            'Ask at checkout, with a QR code. One happy customer a day is enough.'),
    why: bi('Số đánh giá là yếu tố nặng nhất quyết định tiệm có lọt vào ba kết quả bản đồ hay không.',
            'Review count is the heaviest single thing deciding whether the shop makes the three-result pack at all.'),
  },
  {
    id: 'review-velocity', phase: 2, kind: 'check', from: { key: 'review-velocity', doneOn: ['pass'] },
    title: bi('Giữ nhịp tối thiểu 4 đánh giá mỗi tháng', 'Keep at least four new reviews a month'),
    how: bi('Tuần nào cũng phải có ít nhất một. Đừng dồn cục — 20 đánh giá trong một tuần trông như mua và bị lọc.',
            'At least one every week. Never in a batch — twenty in one week looks bought and gets filtered.'),
    why: bi('Hồ sơ 200 đánh giá mà cả năm không có cái mới thua hồ sơ 60 đánh giá tuần nào cũng có thêm.',
            'A profile with two hundred reviews and none this year loses to one with sixty that gains one every week.'),
  },
  {
    id: 'review-replies', phase: 2, kind: 'check', from: { key: 'review-replies', doneOn: ['pass'] },
    title: bi('Trả lời từ 80% đánh giá trở lên', 'Reply to eighty percent of reviews or more'),
    how: bi('Đánh giá xấu trả lời trước, trong ngày. Trả lời ngắn, thật, không dùng mẫu copy dán.',
            'Bad ones first, same day. Short, real replies — never a copy-pasted template.'),
    why: bi('Mức 80% có tác động đo được lên thứ hạng. Và người đọc review xấu quan tâm cách tiệm phản hồi hơn nội dung phàn nàn.',
            'Eighty percent shows a measurable ranking effect. And whoever reads a bad review cares more about the reply than the complaint.'),
  },
  {
    id: 'review-qr', phase: 2, kind: 'manual', minutes: 30,
    title: bi('Đặt mã QR xin đánh giá tại quầy', 'Put a review QR code on the counter'),
    how: bi('In mã QR link thẳng tới ô viết đánh giá Google. Dán ở quầy thanh toán, không để trong ngăn kéo.',
            'Print a QR going straight to the Google review box. Stick it on the pay counter, not in a drawer.'),
    why: bi('Khoảng cách giữa "định xin" và "xin được" là một tấm QR trong tầm tay lúc khách đang trả tiền.',
            'The gap between meaning to ask and actually asking is a QR code within reach while she pays.'),
  },
  {
    id: 'review-keywords', phase: 2, kind: 'manual', minutes: 15,
    title: bi('Hướng khách nhắc tên dịch vụ trong đánh giá', 'Get service names into the review text'),
    how: bi('Nói với khách: "chị nhắc giúp em dịch vụ chị làm hôm nay nhé". Không đọc mẫu cho khách chép.',
            'Say: "would you mention which service you had today?" Never dictate words for them to copy.'),
    why: bi('Chữ trong đánh giá giúp Google hiểu tiệm bán gì — và hiện thành nhãn lý do ngay dưới hồ sơ.',
            'Words inside reviews teach Google what the shop sells, and surface as justification labels under the profile.'),
  },
  {
    id: 'gbp-posts', phase: 2, kind: 'manual', minutes: 30,
    title: bi('Đăng 2–3 bài mỗi tuần lên hồ sơ', 'Post two or three times a week on the profile'),
    how: bi('Bài nào cũng kèm ảnh. Bộ móng vừa làm xong là nguồn ảnh có sẵn mỗi ngày.',
            'Every post carries a photo. The set you just finished is a photo source that exists every single day.'),
    why: bi('Tiệm đăng đều tăng trung bình 2,3 hạng trong 6 tháng so với tiệm không đăng gì.',
            'Shops posting weekly gain an average of 2.3 local positions over six months against shops posting nothing.'),
  },
  {
    id: 'qna-seed', phase: 2, kind: 'manual', minutes: 30,
    title: bi('Tự đặt và trả lời 5–7 câu hỏi thường gặp', 'Seed five to seven common questions and answer them'),
    how: bi('Mục Hỏi & Đáp trên hồ sơ. Giá, đậu xe, có nhận walk-in không, có làm cho trẻ em không, có nhận thẻ không.',
            'The Q&A section of the profile. Price, parking, walk-ins, children, card payment.'),
    why: bi('Ai cũng đặt được câu hỏi lên hồ sơ tiệm mình. Không tự trả lời trước thì người lạ trả lời hộ.',
            'Anyone can post a question on your profile. Leave it and a stranger answers it for you.'),
  },
  {
    id: 'competitor-spam', phase: 2, kind: 'manual', minutes: 20,
    title: bi('Kiểm tra đối thủ nhồi từ khoá vào tên tiệm', 'Check competitors for keyword-stuffed names'),
    how: bi('Tên kiểu "ABC Nails Best Nail Salon Kerrville" là vi phạm chính sách. Báo cáo qua Business Redressal Form.',
            'A name like "ABC Nails Best Nail Salon Kerrville" breaks policy. Report it through the Business Redressal Form.'),
    why: bi('Đây là việc hợp lệ và hiệu quả. Ngược lại, tự mình làm vậy thì có thể bị đình chỉ hồ sơ — mất trắng cả đánh giá.',
            'Legitimate and effective. Doing it yourself, by contrast, risks suspension and the loss of every review with it.'),
  },

  // ---- phase 3: climbing ---------------------------------------------------
  {
    id: 'hero-photos', phase: 3, kind: 'manual', minutes: 120,
    title: bi('Chụp lại bộ ảnh đại diện và ảnh bìa cho tử tế', 'Reshoot the profile and cover photos properly'),
    how: bi('Một buổi chụp có đèn, ảnh sáng và sắc nét. Đây là hai tấm được nhìn nhiều nhất trong cả hồ sơ.',
            'One session with proper light — bright and sharp. These two frames are the most-looked-at in the whole profile.'),
    why: bi('Ở giai đoạn này ba tiệm đều đã làm đúng phần cơ bản. Ảnh là thứ quyết định người ta bấm vào ai.',
            'By now all three shops have the basics right. The photo is what decides who gets tapped.'),
  },
  {
    id: 'booking-link', phase: 3, kind: 'manual', minutes: 30,
    title: bi('Bật đặt lịch trực tiếp từ Google', 'Turn on booking straight from Google'),
    how: bi('Gắn link đặt lịch Lumio vào hồ sơ, ở nút "Đặt lịch". Rút ngắn đường từ tìm kiếm tới booking còn một cú bấm.',
            'Put the Lumio booking link on the profile\'s booking button. It shortens search-to-booking to a single tap.'),
    why: bi('Tạo tín hiệu hành vi mạnh nhất có thể, và biến thứ hạng thành con số booking đo được.',
            'It creates the strongest behavioural signal available, and turns ranking into a booking number you can actually count.'),
  },
  {
    id: 'area-mentions', phase: 3, kind: 'manual', minutes: 15,
    title: bi('Hướng đánh giá nhắc tên khu vực', 'Get the neighbourhood named in reviews'),
    how: bi('"Tiệm nail gần Main Street" — tên đường, tên khu, tên trung tâm thương mại gần đó.',
            'A street name, a district, the mall nearby — "the nail place near Main Street".'),
    why: bi('Giúp hồ sơ liên quan hơn ở đúng vùng mình muốn phủ, trong giới hạn mà khoảng cách cho phép.',
            'It raises relevance in exactly the area you are trying to cover, within what proximity allows.'),
  },
  {
    id: 'competitor-watch', phase: 3, kind: 'manual', minutes: 20,
    title: bi('Đếm nhịp đánh giá của 2 đối thủ mạnh nhất', 'Count the review pace of your two strongest rivals'),
    how: bi('Mở hồ sơ họ, đếm số đánh giá mới trong tháng. Mỗi tháng một lần, ghi vào bảng.',
            'Open their profiles, count new reviews this month. Once a month, write it down.'),
    why: bi('Nhịp của mình chỉ có nghĩa khi so với nhịp của họ. Hơn họ mỗi tháng là thắng, kém là đang tụt dù số vẫn tăng.',
            'Your pace only means something next to theirs. Beating them monthly is winning; trailing is slipping even while your number rises.'),
  },

  // ---- phase 4: holding ----------------------------------------------------
  {
    id: 'monthly-grid', phase: 4, kind: 'manual', minutes: 30,
    title: bi('Đo lưới điểm mỗi tháng, cùng ngày cùng từ khoá', 'Run the geogrid monthly, same day, same keywords'),
    how: bi('Cùng bộ từ khoá, cùng bán kính, cùng ngày trong tháng. Lưu ảnh cạnh ảnh tháng trước.',
            'Same keywords, same radius, same date each month. Save the image beside last month\'s.'),
    why: bi('Hạng 1 rớt trong im lặng. Không đo đều thì tới lúc phát hiện đã tụt ba tháng.',
            'First place slips quietly. Without a regular measurement, by the time anyone notices it has been gone for three months.'),
  },
  {
    id: 'monthly-report', phase: 4, kind: 'manual', minutes: 45,
    title: bi('Gửi báo cáo tháng cho khách', 'Send the client the monthly report'),
    how: bi('Lưới điểm tháng này cạnh tháng trước, lượt gọi và chỉ đường trong Insights, và số booking đến từ Google.',
            'This month\'s grid beside last month\'s, calls and direction requests from Insights, and bookings that came from Google.'),
    why: bi('Khách không thấy tiến triển là khách nghỉ ở tháng thứ ba, kể cả khi việc vẫn đang chạy đúng.',
            'A client who cannot see progress leaves in month three, even when the work is going exactly to plan.'),
  },
  {
    id: 'quarterly-audit', phase: 4, kind: 'manual', minutes: 60,
    title: bi('Rà lại danh mục và giá mỗi quý', 'Re-check categories and prices each quarter'),
    how: bi('Google thêm danh mục mới liên tục — có thể đã có danh mục sát hơn. Đối chiếu giá trong hồ sơ với bảng giá thật.',
            'Google adds categories constantly — a closer one may now exist. Check profile prices against the real price list.'),
    why: bi('Danh mục sát hơn là một trong số ít thay đổi còn tạo được bước nhảy khi mọi thứ khác đã tối ưu.',
            'A closer category is one of the few remaining changes that can still move things once everything else is optimised.'),
  },
];

export type TaskState = 'done' | 'todo' | 'unknown';

export interface RoadmapTaskView extends RoadmapTask {
  state: TaskState;
  /** Set only for manual tasks that were ticked. */
  at?: string | null;
  by?: string | null;
  /** True when the system decided this, so the UI can say so and hide the box. */
  auto: boolean;
}

export interface RoadmapView {
  phases: (RoadmapPhase & { tasks: RoadmapTaskView[]; done: number; total: number })[];
  done: number;
  total: number;
  /** The next thing to actually do — first unfinished task in phase order. */
  next: RoadmapTaskView | null;
}

/**
 * Merge the catalog with what the system measured and what a person ticked.
 *
 * `checks` is the seo-local report keyed by check id. A check that is missing
 * or 'unknown' yields state 'unknown', NOT 'todo': the difference between "we
 * looked and it is not done" and "we cannot see this yet" is the difference
 * between a task list and a guess, and the screen has to be able to say both.
 */
export function buildRoadmap(
  checks: Record<string, string>,
  ticks: Record<string, { done?: boolean; at?: string; by?: string }>,
): RoadmapView {
  const view = (t: RoadmapTask): RoadmapTaskView => {
    if (t.kind === 'check' && t.from) {
      const s = checks[t.from.key];
      if (!s || s === 'unknown') return { ...t, state: 'unknown', auto: true };
      return { ...t, state: (t.from.doneOn as string[]).includes(s) ? 'done' : 'todo', auto: true };
    }
    const tick = ticks[t.id];
    return {
      ...t,
      state: tick?.done ? 'done' : 'todo',
      at: tick?.at ?? null,
      by: tick?.by ?? null,
      auto: false,
    };
  };

  const phases = PHASES.map((p) => {
    const tasks = TASKS.filter((t) => t.phase === p.n).map(view);
    return { ...p, tasks, done: tasks.filter((t) => t.state === 'done').length, total: tasks.length };
  });

  const all = phases.flatMap((p) => p.tasks);
  return {
    phases,
    done: all.filter((t) => t.state === 'done').length,
    total: all.length,
    // 'unknown' is not "next": nobody can act on a task the system cannot see
    // the state of, and putting one here would stall the list permanently.
    next: all.find((t) => t.state === 'todo') ?? null,
  };
}

/** Ids a person is allowed to tick. A `check` task is decided by measurement,
 *  and letting anyone override it would make the whole board untrustworthy. */
export function manualTaskIds(): string[] {
  return TASKS.filter((t) => t.kind === 'manual').map((t) => t.id);
}
