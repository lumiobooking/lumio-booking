/**
 * What each trade actually films, and where its raw material comes from.
 *
 * The generic version of this advice — "post consistently, show your work,
 * engage with your audience" — is true of every business on earth and therefore
 * useless to any of them. A nail salon and a restaurant do not have the same
 * problem: the salon has a finished object in front of it every forty minutes
 * and no idea what to say about it; the restaurant has a dozen photogenic
 * moments an hour and no time to catch any of them.
 *
 * So this file answers three questions per trade, concretely:
 *
 *   1. `dailySources` — where today's clip comes FROM. Not "make content", but
 *      "the set you just finished, before the customer puts her coat on". A
 *      source you can point at is the difference between a plan and a wish.
 *   2. `postTypes` — the three posts a week, each with a different job. Three
 *      posts of the same kind is one post repeated.
 *   3. `videoFeeds` and `productWatch` — real pages where this trade's trends
 *      and products can be SEEN. Hashtag feeds and category rankings, never a
 *      link to one specific video, because a specific video would have to be
 *      invented and a hashtag page does not.
 *
 * Everything here is written to be edited. It is a starting position from the
 * trade, not a claim about any individual salon.
 */

import { bi, viOf, enOf, type Txt } from './i18n';

export interface ContentSource {
  /** The moment or object the clip comes from. */
  label: Txt;
  /** When in the day to catch it — the reason most of these get missed. */
  when: Txt;
  why: Txt;
}

export interface PostType {
  /** What this post is, in the owner's words. */
  label: Txt;
  /** The job it does — why it is not interchangeable with the others. */
  job: Txt;
  /** Concrete shots, in order. */
  shots: Txt;
}

export interface FeedLink {
  key: string;
  title: Txt;
  url: string;
  what: Txt;
  how: Txt;
  /**
   * Whose page this is. Typed `Txt` like every other visible field, but the
   * values stay plain: "TikTok" and "Amazon" are called that on both screens,
   * and a translated product name is a name that no longer points anywhere.
   */
  source: Txt;
}

export interface Playbook {
  trade: Txt;
  dailySources: ContentSource[];
  postTypes: PostType[];
  /**
   * Habits that cost minutes and compound.
   *
   * `kind` is a literal union rather than `string` so it stays assignable to
   * the week plan's JobKind. Widening it to `string` compiled here and failed
   * over there — the kind of error that only appears once the two files meet.
   */
  habits: { kind: 'engage' | 'story'; text: Txt; why: Txt; when: Txt }[];
}

const SALON: Playbook = {
  trade: bi('ngành nail', 'nail salons'),
  dailySources: [
    { label: bi('Bộ móng vừa làm xong', 'The set you just finished'), when: bi('ngay trước khi khách trả tiền', 'right before she pays'), why: bi('Đây là lúc duy nhất bộ móng còn hoàn hảo và ánh sáng còn ở bàn làm. Sau đó là mất', 'This is the one moment the set is still perfect and the light is still on the table. After that it is gone') },
    { label: bi('Phản ứng thật của khách khi nhìn tay', 'The customer\'s real reaction when she looks at her hands'), when: bi('3 giây đầu khách quay tay lại', 'the first 3 seconds after she turns her hands over'), why: bi('Không diễn được, và đó chính là lý do người xem tin', 'It cannot be acted, and that is exactly why people believe it') },
    { label: bi('Bộ móng cũ hỏng lúc khách vừa ngồi xuống', 'The old damaged set as she sits down'), when: bi('trước khi bắt đầu tháo', 'before you start taking it off'), why: bi('Không có ảnh "trước" thì "sau" chỉ là một bộ móng đẹp như mọi bộ khác', 'With no "before" shot, the "after" is just one more pretty set like any other') },
    { label: bi('Đoạn khó nhất trong ca hôm nay', 'The hardest part of today\'s set'), when: bi('lúc thợ đang tập trung', 'while the tech is deep in it'), why: bi('Tay nghề nhìn thấy được thì không cần nói ra', 'Skill you can see does not need to be claimed') },
    { label: bi('Kệ màu và bộ sưu tập mới', 'The color rack and the new collection'), when: bi('sáng trước khi mở cửa', 'in the morning before you open'), why: bi('Màu mới là cái cớ tự nhiên nhất để đăng bài mà không phải nghĩ', 'A new color is the easiest excuse to post something without having to think one up') },
    { label: bi('Khách quen quay lại lần thứ n', 'A regular coming back again'), when: bi('lúc chào hỏi', 'while you say hello'), why: bi('Khách cũ quay lại là bằng chứng mạnh nhất, và không tiệm nào chép được', 'A customer who keeps coming back is the strongest proof there is, and no other shop can copy it') },
  ],
  postTypes: [
    { label: bi('Mẫu đang được đặt nhiều nhất', 'The set people are booking most'), job: bi('Bài chắc ăn — bán cái khách đang thật sự chọn, không phải cái tiệm thích nhất', 'The safe post — sell what customers are actually choosing, not what the shop likes best'), shots: bi('Cận móng xoay tay · góc từ trên xuống · khách cầm ly cà phê khoe tay', 'Close-up with the hand turning · shot from above · customer holding a coffee cup showing her nails') },
    { label: bi('Quy trình / cận cảnh tay nghề', 'The process, up close'), job: bi('Bài thuyết phục người đang phân vân giữa tiệm mình và tiệm bên cạnh', 'The post that wins someone choosing between you and the shop next door'), shots: bi('Tháo bộ cũ · dũa tạo dáng · nét vẽ khó nhất · thành phẩm', 'Taking off the old set · filing the shape · the hardest line of the design · the finished hand') },
    { label: bi('Trước và sau, hoặc khách phản ứng thật', 'Before and after, or the real reaction'), job: bi('Bài kéo người lạ dừng lại — tò mò trước, tin sau', 'The post that stops a stranger scrolling — curiosity first, trust after'), shots: bi('Bộ móng hỏng cận cảnh · lướt nhanh quá trình · mặt khách khi nhìn tay', 'Close-up of the damaged set · a fast run through the work · her face when she sees her hands') },
    { label: bi('Người thợ và tay nghề của họ', 'The tech and what she can do'), job: bi('Bài xây niềm tin vào NGƯỜI — khách quay lại vì thợ, không vì tiệm', 'The post that builds trust in the PERSON — customers come back for a tech, not for a shop'), shots: bi('Thợ đang tập trung · dụng cụ riêng · một câu thợ nói về nghề', 'The tech working, focused · her own tools · one line from her about the work') },
    { label: bi('Trả lời một câu khách hay hỏi', 'Answering a question customers keep asking'), job: bi('Bài gỡ lý do khách còn chần chừ trước khi đặt lịch', 'The post that clears the last reason someone is holding off on booking'), shots: bi('Câu hỏi hiện trên màn hình · vừa làm vừa trả lời · kết bằng lời mời đặt lịch', 'The question on screen · answer it while you work · end with an invitation to book') },
  ],
  habits: [
    { kind: 'engage', text: bi('Trả lời hết tin nhắn và bình luận còn sót', 'Clear every leftover message and comment'), why: bi('Khách nhắn mà chờ quá một buổi là mất — đây là việc rẻ nhất trong ngày', 'A customer who waits more than half a day is gone — this is the cheapest job on the list'), when: bi('trước khi mở cửa', 'before you open') },
    { kind: 'story', text: bi('Chụp 1 bộ móng đẹp nhất trong ngày, đăng story ngay', 'Shoot the best set of the day and put it straight on a story'), why: bi('Story không cần dựng, chỉ cần đều. Đây là kho ảnh cho các bài tuần sau', 'A story needs no editing, only regularity. It is also the photo bank for next week\'s posts'), when: bi('lúc làm xong', 'as soon as it is finished') },
    { kind: 'engage', text: bi('Xin 1 khách vui vẻ nhất để lại đánh giá Google', 'Ask the happiest customer of the day for a Google review'), why: bi('Một đánh giá mỗi ngày đưa tiệm lên trước đối thủ trên bản đồ — nhanh hơn mọi thứ khác', 'One review a day moves you ahead of the shop down the road on the map — faster than anything else you can do'), when: bi('lúc thanh toán', 'at checkout') },
  ],
};

const RESTAURANT: Playbook = {
  trade: bi('ngành ăn uống', 'restaurants'),
  dailySources: [
    { label: bi('Món vừa ra khỏi bếp', 'The dish as it leaves the kitchen'), when: bi('trong 30 giây đầu, lúc còn bốc khói', 'in the first 30 seconds, while it is still steaming'), why: bi('Hơi nóng và độ bóng biến mất rất nhanh — quay muộn là quay một món nguội', 'The steam and the shine go fast — film it late and you are filming cold food') },
    { label: bi('Bếp lúc cao điểm', 'The kitchen at the rush'), when: bi('giờ đông nhất', 'the busiest hour'), why: bi('Khách chọn quán vì tin người nấu, không vì ảnh món chỉnh sửa', 'People pick a place because they trust whoever is cooking, not because of a retouched photo') },
    { label: bi('Món đặc biệt trong ngày', 'Today\'s special'), when: bi('trước giờ mở cửa', 'before you open'), why: bi('Lý do quay lại cho khách quen — cái mà thực đơn cố định không làm được', 'A reason for regulars to come back — something a fixed menu cannot give them') },
    { label: bi('Khách gọi lại lần hai cùng một món', 'A table ordering the same dish a second time'), when: bi('lúc chạy bàn', 'while you are running the floor'), why: bi('Bằng chứng ngon thật, không phải lời tự khen', 'Proof the food is good, not the kitchen saying so itself') },
    { label: bi('Nguyên liệu lúc nhập về', 'Ingredients coming in the door'), when: bi('sáng sớm', 'early morning'), why: bi('Nguyên liệu tươi là câu chuyện giá cao dễ kể nhất', 'Fresh ingredients are the easiest way to explain a higher price') },
  ],
  postTypes: [
    { label: bi('Một món, quay kỹ', 'One dish, filmed properly'), job: bi('Bài kéo người đói đang lướt điện thoại — một món lên hình đẹp mạnh hơn cả thực đơn', 'The post that catches a hungry person scrolling — one dish shot well beats the whole menu'), shots: bi('Cận lúc ra bếp · rót/chan/cắt · miếng đầu tiên', 'Close-up as it leaves the pass · the pour, the ladle, the cut · the first bite') },
    { label: bi('Người nấu và gian bếp', 'The cook and the kitchen'), job: bi('Bài xây niềm tin — giải thích vì sao đáng giá đó', 'The trust post — it explains why the price is what it is'), shots: bi('Tay đầu bếp làm việc · nguyên liệu thật · vài giây nói về món', 'The chef\'s hands working · the real ingredients · a few seconds about the dish') },
    { label: bi('Khách thật, phản ứng thật', 'Real customers, real reactions'), job: bi('Bài bằng chứng — người lạ tin người lạ hơn tin quán', 'The proof post — strangers believe strangers before they believe the restaurant'), shots: bi('Bàn đông · khách gắp miếng đầu · một câu nhận xét ngắn', 'A full table · the first bite going in · one short line of what they thought') },
    { label: bi('Món ít ai gọi mà ngon nhất', 'The dish nobody orders that is the best one'), job: bi('Bài đẩy món có lãi cao mà thực đơn không nói hộ được', 'The post that pushes a high-margin dish the menu cannot sell on its own'), shots: bi('Món lên bàn · cắt/xé lộ bên trong · một câu vì sao nên thử', 'The plate landing · cut or pull it open · one line on why to try it') },
    { label: bi('Một buổi trong quán, không dựng', 'A shift in the room, uncut'), job: bi('Bài cho người chưa từng tới hình dung được không khí', 'The post that lets someone who has never been in picture the place'), shots: bi('Mở cửa buổi sáng · lúc đông nhất · dọn bàn cuối ngày', 'Opening up in the morning · the busiest moment · clearing tables at the end of the night') },
  ],
  habits: [
    { kind: 'engage', text: bi('Trả lời mọi đánh giá mới, kể cả đánh giá xấu', 'Reply to every new review, the bad ones included'), why: bi('Người đọc đánh giá xấu quan tâm cách quán phản hồi hơn là nội dung phàn nàn', 'People reading a bad review care more about how the place answered than about the complaint itself'), when: bi('đầu ca', 'at the start of the shift') },
    { kind: 'story', text: bi('Đăng story món đặc biệt hôm nay', 'Put today\'s special on a story'), why: bi('Khách quen mở story lúc đang nghĩ trưa nay ăn gì — đúng lúc đó là đủ', 'Regulars open stories while they are deciding where to eat — being there at that moment is enough'), when: bi('trước 11 giờ', 'before 11am') },
    { kind: 'engage', text: bi('Xin 1 bàn hài lòng để lại đánh giá Google', 'Ask one happy table for a Google review'), why: bi('Thứ hạng trên bản đồ quyết định lượng khách vãng lai nhiều hơn mọi quảng cáo', 'Where you sit on the map brings in more walk-ins than any ad does'), when: bi('lúc tính tiền', 'when they pay the check') },
  ],
};

const REAL_ESTATE: Playbook = {
  trade: bi('ngành bất động sản', 'real estate agents'),
  dailySources: [
    { label: bi('Căn đang mở bán', 'The listing you have open'), when: bi('lúc ánh sáng đẹp nhất trong ngày', 'at the best light of the day'), why: bi('Tour nhà là dạng được xem hết nhiều nhất trong ngành này', 'House tours are the format people in this business finish watching most') },
    { label: bi('Câu hỏi khách vừa hỏi hôm nay', 'The question a client asked you today'), when: bi('ngay sau cuộc gọi', 'right after the call'), why: bi('Một khách hỏi thì trăm người đang tìm câu trả lời đó trên mạng', 'If one client asked, a hundred people are searching for that answer online') },
    { label: bi('Một chi tiết nhỏ trong căn nhà', 'One small detail inside the house'), when: bi('khi đi xem nhà', 'while you are at a showing'), why: bi('Chi tiết cụ thể đáng nhớ hơn cả căn nhà chụp toàn cảnh', 'A specific detail sticks better than a wide shot of the whole house') },
    { label: bi('Khu vực quanh nhà', 'The streets around the house'), when: bi('lúc đi ngang', 'as you drive through'), why: bi('Người mua chọn khu trước, chọn nhà sau', 'Buyers pick the neighborhood first and the house second') },
  ],
  postTypes: [
    { label: bi('Tour căn nhà quay dọc', 'A vertical walkthrough of the house'), job: bi('Bài kéo người xem hết — dạng mạnh nhất của ngành này', 'The post people watch to the end — the strongest format in this business'), shots: bi('Cửa vào · bếp · phòng ngủ chính · điểm đặc biệt nhất · sân', 'The front door · the kitchen · the primary bedroom · the one best feature · the yard') },
    { label: bi('Trả lời một câu hỏi thật của khách', 'Answering a real client question'), job: bi('Bài xây uy tín — người mua lần đầu tìm câu trả lời trước khi tìm môi giới', 'The credibility post — first-time buyers look for answers before they look for an agent'), shots: bi('Nói thẳng vào máy · một con số cụ thể trên màn hình · kết bằng bước tiếp theo', 'Talk straight to camera · one hard number on screen · end with the next step') },
    { label: bi('Giới thiệu khu vực', 'A tour of the neighborhood'), job: bi('Bài kéo đúng người — ai đang cân nhắc chuyển tới khu này', 'The post that pulls the right people — the ones thinking about moving here'), shots: bi('Đường phố · quán/trường gần đó · một câu về giá trung bình khu', 'The street · the coffee shop or school nearby · one line on what homes go for here') },
    { label: bi('Một căn vừa bán xong và vì sao', 'A house that just sold, and why'), job: bi('Bài bằng chứng — kết quả thật nói thay mọi lời giới thiệu', 'The proof post — a real result says more than any introduction'), shots: bi('Bảng đã bán · căn nhà · một con số về thời gian bán', 'The sold sign · the house · one number for how long it took') },
    { label: bi('Sai lầm hay gặp khi mua/bán', 'The mistakes people make buying or selling'), job: bi('Bài giữ người xem tới cuối — ai cũng sợ mất tiền vì không biết', 'The post that holds people to the end — nobody wants to lose money for not knowing'), shots: bi('Nói thẳng vào máy · một ví dụ cụ thể · cách tránh', 'Talk straight to camera · one concrete example · how to avoid it') },
  ],
  habits: [
    { kind: 'engage', text: bi('Trả lời mọi tin nhắn hỏi về căn đang bán', 'Answer every message about a listing'), why: bi('Người mua nhắn nhiều môi giới cùng lúc — ai trả lời trước thường thắng', 'Buyers message several agents at once — whoever answers first usually wins'), when: bi('trong giờ làm', 'during working hours') },
    { kind: 'story', text: bi('Đăng story một góc nhà đang xem', 'Story one corner of the house you are showing'), why: bi('Giữ sự hiện diện mà không tốn buổi quay', 'Stay visible without spending a filming session'), when: bi('khi đi xem nhà', 'at a showing') },
    { kind: 'engage', text: bi('Nhắn 1 khách cũ hỏi thăm', 'Check in with one past client'), why: bi('Giới thiệu từ khách cũ là nguồn khách rẻ nhất trong ngành này', 'Referrals from past clients are the cheapest source of business there is'), when: bi('cuối ngày', 'at the end of the day') },
  ],
};

const SERVICE: Playbook = {
  trade: bi('ngành dịch vụ', 'local service businesses'),
  dailySources: [
    { label: bi('Một ca làm xong trong ngày', 'A job you finished today'), when: bi('ngay khi hoàn thành', 'the moment it is done'), why: bi('Bằng chứng cụ thể thuyết phục hơn mọi lời quảng cáo', 'Concrete proof convinces people more than any advertising') },
    { label: bi('Trạng thái trước khi làm', 'How it looked before you started'), when: bi('trước khi bắt đầu', 'before you start'), why: bi('Không có "trước" thì "sau" không nói lên điều gì', 'With no "before", the "after" says nothing') },
    { label: bi('Câu hỏi khách hay hỏi nhất', 'The question customers ask most'), when: bi('ngay sau khi trả lời', 'right after you answer it'), why: bi('Câu hỏi lặp lại là chủ đề nội dung có sẵn', 'A question that keeps coming back is a post already written for you') },
  ],
  postTypes: [
    { label: bi('Trước và sau của một ca thật', 'Before and after on a real job'), job: bi('Bài bằng chứng — cái người ta cần thấy trước khi gọi', 'The proof post — what people need to see before they call'), shots: bi('Hiện trạng · vài giây làm · kết quả', 'The state it was in · a few seconds of the work · the result') },
    { label: bi('Giải thích một thắc mắc thường gặp', 'Explaining a common worry'), job: bi('Bài xây uy tín, kéo người đang tìm hiểu', 'The credibility post, for people still doing their research'), shots: bi('Nói thẳng vào máy · minh hoạ · bước tiếp theo', 'Talk straight to camera · show it · the next step') },
    { label: bi('Người làm và cách làm', 'The person doing the work, and how'), job: bi('Bài tạo niềm tin vào người, không chỉ vào dịch vụ', 'The post that builds trust in the person, not just in the service'), shots: bi('Chuẩn bị đồ nghề · thao tác chính · lời nhắn ngắn', 'Laying out the tools · the main step · a short word to camera') },
    { label: bi('Một ca khó hơn bình thường', 'A job harder than the usual one'), job: bi('Bài phân biệt mình với chỗ làm ẩu — cho thấy tay nghề ở chỗ khó', 'The post that separates you from whoever cuts corners — skill shows up on the hard ones'), shots: bi('Vì sao ca này khó · cách xử lý · kết quả', 'Why this one was hard · how you handled it · the result') },
    { label: bi('Khách cũ nói về lần làm trước', 'A past customer on the last job you did'), job: bi('Bài bằng chứng — lời khách nặng hơn lời mình tự nói', 'The proof post — a customer\'s word carries more than your own'), shots: bi('Khách nói ngắn · kết quả còn giữ được · lời mời liên hệ', 'A short word from them · the result still holding up · an invitation to call') },
  ],
  habits: [
    { kind: 'engage', text: bi('Trả lời hết tin nhắn và cuộc gọi nhỡ', 'Clear every message and missed call'), why: bi('Khách dịch vụ thường gọi nhiều nơi — ai bắt máy trước thường được việc', 'People call several places — whoever picks up first usually gets the job'), when: bi('đầu ngày', 'first thing in the morning') },
    { kind: 'story', text: bi('Đăng story một ca đang làm', 'Story a job in progress'), why: bi('Đều đặn quan trọng hơn hoàn hảo', 'Steady beats perfect'), when: bi('giữa ca', 'mid-job') },
    { kind: 'engage', text: bi('Xin 1 khách hài lòng để lại đánh giá', 'Ask one satisfied customer for a review'), why: bi('Đánh giá là thứ quyết định người lạ có gọi hay không', 'Reviews decide whether a stranger calls you at all'), when: bi('lúc xong việc', 'when the job is done') },
  ],
};

const PLAYBOOKS: Record<string, Playbook> = { SALON, RESTAURANT, REAL_ESTATE, SERVICE };

export function playbookFor(industry?: string | null): Playbook {
  return PLAYBOOKS[(industry || 'SALON').toUpperCase()] ?? SALON;
}

// ---- video feeds and product watch -----------------------------------------

/**
 * Hashtag and category pages, per trade.
 *
 * These are feeds, not videos. A hashtag page is a real address that exists
 * whether or not anyone checked it today, and it shows whatever is actually
 * doing well right now. A link to one specific clip would have to be made up,
 * and would rot within a week even if it were not.
 */
const VIDEO_TAGS: Record<string, string[]> = {
  SALON: ['nailsoftiktok', 'nailart', 'nailtech'],
  RESTAURANT: ['foodtiktok', 'restaurant', 'chefsoftiktok'],
  REAL_ESTATE: ['realestate', 'housetour', 'realtorlife'],
  SERVICE: ['smallbusinesscheck', 'beforeandafter'],
};

/**
 * Where each trade's products are ranked by something real.
 *
 * "Sản phẩm đang xu hướng" is a claim that goes stale in days, so this product
 * never states one. It links to pages that rank by actual sales movement and
 * lets the ranking speak. Amazon's Movers & Shakers is the clearest of these:
 * it lists the biggest 24-hour risers in a category, which is as close to
 * "đang lên" as a public page gets.
 */
const PRODUCT_PAGES: Record<string, { title: Txt; url: string; what: Txt; how: Txt; source: Txt }[]> = {
  SALON: [
    {
      title: bi('Sản phẩm làm đẹp tăng doanh số mạnh nhất 24 giờ', 'Beauty products rising fastest in the last 24 hours'),
      url: 'https://www.amazon.com/gp/movers-and-shakers/beauty',
      what: bi('Bảng "Movers & Shakers" của Amazon — xếp theo mức tăng doanh số trong 24 giờ, không phải theo quảng cáo.', 'Amazon\'s "Movers & Shakers" board — ranked by how much sales actually moved in 24 hours, not by who paid for ads.'),
      how: bi('Thấy một loại sản phẩm móng nhảy lên bảng này nghĩa là khách đang tự mua ở nhà. Đó vừa là mẫu nên làm, vừa là thứ nên bán tại quầy.', 'A nail product jumping onto this board means customers are buying it for themselves at home. That is both a set worth offering and something worth selling at the counter.'),
      source: 'Amazon',
    },
    {
      title: bi('Sản phẩm móng bán chạy nhất', 'Best-selling nail products'),
      url: 'https://www.amazon.com/Best-Sellers-Beauty-Foot-Hand-Nail-Care/zgbs/beauty/11060451',
      what: bi('Bảng bán chạy ngành chăm sóc tay chân móng, cập nhật hằng giờ.', 'The best-seller board for hand, foot and nail care, updated every hour.'),
      how: bi('Đối chiếu với kệ của tiệm: cái gì bán chạy ngoài kia mà tiệm chưa có là một câu hỏi đáng đặt cho nhà cung cấp.', 'Hold it against your own shelf: something selling well out there that you do not carry is a question worth asking your supplier.'),
      source: 'Amazon',
    },
  ],
  RESTAURANT: [
    {
      title: bi('Món và nguyên liệu đang được tìm nhiều', 'Dishes and ingredients people are searching for'),
      url: 'https://trends.google.com/trends/explore?date=today%201-m&geo=US&q=recipe&hl=vi',
      what: bi('Nhu cầu tìm kiếm quanh đồ ăn trong 30 ngày, kèm truy vấn đang tăng.', 'Search demand around food over the last 30 days, with the queries that are climbing.'),
      how: bi('Món nào đang được tìm nhiều thì đó là món nên đưa lên đầu thực đơn và lên bài trong tháng.', 'Whatever people are searching for is what belongs at the top of the menu and in this month\'s posts.'),
      source: 'Google Trends',
    },
  ],
  REAL_ESTATE: [
    {
      title: bi('Nhu cầu mua nhà đang lên hay xuống', 'Whether demand for homes is rising or falling'),
      url: 'https://trends.google.com/trends/explore?date=today%2012-m&geo=US&q=homes%20for%20sale&hl=vi',
      what: bi('Đường nhu cầu 12 tháng — đọc được chu kỳ thay vì đoán theo cảm giác thị trường.', 'The 12-month demand line — you can read the cycle instead of guessing at the market by feel.'),
      how: bi('Đang lên thì đẩy nội dung cho người mua; đang xuống thì đẩy nội dung cho người bán và người thuê.', 'Rising, push content for buyers; falling, push content for sellers and for renters.'),
      source: 'Google Trends',
    },
  ],
  SERVICE: [],
};

export function videoFeeds(industry?: string | null, market = 'US'): FeedLink[] {
  const key = (industry || 'SALON').toUpperCase();
  const tags = VIDEO_TAGS[key] ?? VIDEO_TAGS.SALON;
  const p = playbookFor(industry);
  const out: FeedLink[] = tags.slice(0, 3).map((tag, i) => ({
    key: `tt-tag-${tag}`,
    title: `TikTok #${tag}`,
    url: `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`,
    what: i === 0
      ? bi(`Feed hashtag lớn nhất của ${viOf(p.trade)} — mở ra là thấy cái gì đang chạy tốt ngay lúc này.`,
        `The biggest hashtag feed for ${enOf(p.trade)} — open it and you can see what is working right now.`)
      : bi(`Feed hashtag phụ, thường ít cạnh tranh hơn và dễ lên hơn cho tiệm nhỏ.`,
        `A second-tier hashtag feed: usually less competition, and easier for a small shop to get seen on.`),
    how: bi('Xem 10 clip đầu, đếm xem bao nhiêu clip mở đầu bằng cận cảnh. Cách mở đầu lặp lại nhiều nhất là cách đang hiệu quả — làm theo cách mở, không chép nội dung.',
      'Watch the first 10 clips and count how many open on a close-up. The opening that repeats most is the one that is working — copy the opening, not the content.'),
    source: 'TikTok',
  }));
  out.push({
    key: 'yt-search',
    // The search query is part of a URL, not a phrase on screen: it stays one
    // language (the trade's own words) so the link keeps pointing somewhere.
    title: bi(`YouTube — ${viOf(p.trade)}, mới nhất`, `YouTube — ${enOf(p.trade)}, newest first`),
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${viOf(p.trade) === 'ngành nail' ? 'nail art' : viOf(p.trade)} ${market === 'VN' ? '' : 'tutorial'}`.trim())}`,
    what: bi('Video dài hơn, nơi kỹ thuật mới xuất hiện trước khi lan sang clip ngắn.',
      'Longer videos, where a new technique turns up before it spreads to short clips.'),
    how: bi('Xem 1 video kỹ thuật mỗi tuần. Kỹ thuật mới học được là nội dung của cả tháng sau.',
      'Watch one technique video a week. A technique you learn is a month of content.'),
    source: 'YouTube',
  });
  return out;
}

export function productWatch(industry?: string | null): FeedLink[] {
  const key = (industry || 'SALON').toUpperCase();
  const rows = PRODUCT_PAGES[key] ?? PRODUCT_PAGES.SALON;
  return rows.map((r, i) => ({ key: `prod-${key.toLowerCase()}-${i}`, ...r }));
}
