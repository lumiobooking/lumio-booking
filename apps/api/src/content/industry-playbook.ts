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

// ---- the beauty trades ------------------------------------------------------
//
// Split out of SALON once a shop could declare which one it is. Before this,
// a lash studio that told us it was a lash studio was still handed the nail
// playbook — "film the set you just finished, before she puts her coat on" —
// which is worse than the generic advice it replaced, because the shop had
// answered the question and watched the answer get ignored.
//
// Each is written the same way SALON was: a source you can POINT AT, at a
// moment in the day when it exists and shortly afterwards does not. That
// moment is the whole difference between a plan and a wish, and it is
// different in every one of these trades — a lash set is only photogenic with
// the eyes closed, and a facial has no finished object at all.

const HAIR: Playbook = {
  trade: bi('ngành tóc', 'hair salons'),
  dailySources: [
    { label: bi('Cú xoay đầu cuối cùng trước gương', 'The last turn in the mirror'), when: bi('ngay sau khi tháo áo choàng', 'the second the cape comes off'), why: bi('Tóc chỉ đẹp nhất đúng lúc đó — hôm sau khách gội là mất', 'Hair is never better than in that moment — she washes it tomorrow and it is gone') },
    { label: bi('Màu đang ngấm trên giấy bạc', 'Colour developing in the foils'), when: bi('giữa ca nhuộm', 'mid-way through the colour'), why: bi('Đây là phần khách không bao giờ thấy, và là phần chứng minh đây là nghề chứ không phải tự làm ở nhà', 'This is the part a customer never sees, and the part that proves this is a trade and not something you do at home') },
    { label: bi('Tóc hỏng lúc khách vừa ngồi xuống', 'The damaged hair as she sits down'), when: bi('trước khi bắt đầu', 'before you start'), why: bi('Không có "trước" thì "sau" chỉ là một mái tóc đẹp như mọi mái khác', 'With no "before", the "after" is just one more nice head of hair') },
    { label: bi('Khách tự chải sau khi về', 'Her styling it herself a week later'), when: bi('nhắn xin sau 5–7 ngày', 'ask for it five to seven days later'), why: bi('Bằng chứng mạnh nhất là kiểu tóc vẫn đẹp khi không có thợ đứng cạnh', 'The strongest proof is the cut still working with no stylist standing next to it') },
  ],
  postTypes: [
    { label: bi('Lột xác — trước và sau', 'The transformation'), job: bi('Bài kéo người lạ dừng lại. Không có bài nào trong ngành tóc thay thế được nó', 'The post that stops a stranger. Nothing else in this trade does its job'), shots: bi('Tóc cũ cận cảnh · lướt nhanh quá trình · cú xoay đầu cuối', 'The old hair close up · a fast run through the work · the final turn') },
    { label: bi('Giải thích một kỹ thuật', 'Explain one technique'), job: bi('Bài thuyết phục người đang phân vân giữa salon mình và chỗ rẻ hơn', 'The post that wins someone choosing between you and somewhere cheaper'), shots: bi('Tay chia lọn · giấy bạc · màu lên dần · kết quả', 'Sectioning · foils · the colour coming up · the result') },
    { label: bi('Kiểu tóc hợp với dáng mặt nào', 'Which cut suits which face'), job: bi('Bài trả lời câu khách tự hỏi trước khi dám đổi kiểu', 'The post that answers what someone asks themselves before daring to change'), shots: bi('Khách mặt tròn · khách mặt dài · cùng kiểu đã biến tấu cho từng người', 'A round face · a long face · the same cut adapted for each') },
    { label: bi('Người thợ và tay nghề riêng', 'The stylist and what she is known for'), job: bi('Khách quay lại vì thợ, không vì salon', 'Customers come back for a person, not for a shop'), shots: bi('Thợ đang chia màu · dụng cụ riêng · một câu về nghề', 'Mixing colour · her own tools · one line about the work') },
    { label: bi('Chăm tóc nhuộm tại nhà', 'Keeping colour alive at home'), job: bi('Bài giữ màu bền hơn, giảm hẳn ca khách quay lại phàn nàn bạc màu', 'Keeps the colour alive longer and cuts the come-back-and-complain visits'), shots: bi('Dầu gội không sulfate · nhiệt độ nước · điều tuyệt đối tránh', 'Sulfate-free shampoo · water temperature · the one thing never to do') },
  ],
  habits: [
    { kind: 'engage', text: bi('Trả lời hết tin nhắn hỏi giá nhuộm', 'Clear every message asking what colour costs'), why: bi('Giá nhuộm là câu hỏi số một và là câu khách bỏ đi nếu không được trả lời', 'Colour price is the number one question and the one people leave over'), when: bi('trước khi mở cửa', 'before you open') },
    { kind: 'story', text: bi('Đăng story mái tóc đẹp nhất trong ngày', 'Story the best head of hair today'), why: bi('Không cần dựng, chỉ cần đều — và là kho ảnh cho tuần sau', 'No editing needed, only regularity — and it is next week\'s photo bank'), when: bi('lúc tháo áo choàng', 'as the cape comes off') },
    { kind: 'engage', text: bi('Hẹn ngày dặm chân tóc ngay tại quầy', 'Book the root touch-up at the counter'), why: bi('Ngành tóc sống bằng lịch quay lại, và lúc khách còn đứng đó là lúc dễ hẹn nhất', 'This trade lives on rebookings, and the easiest moment is while she is still standing there'), when: bi('lúc thanh toán', 'at checkout') },
  ],
};

const LASH: Playbook = {
  trade: bi('ngành nối mi', 'lash studios'),
  dailySources: [
    { label: bi('Mắt nhắm ngay khi làm xong', 'The closed eye, right as you finish'), when: bi('trước khi khách mở mắt', 'before she opens her eyes'), why: bi('Bộ mi chỉ nhìn rõ được khi mắt nhắm — khách mở mắt là không quay được nữa', 'A lash set only reads with the eye closed — once she opens it, the shot is gone') },
    { label: bi('Khoảnh khắc khách soi gương lần đầu', 'The first look in the mirror'), when: bi('3 giây đầu', 'the first three seconds'), why: bi('Không diễn được, và đó là lý do người xem tin', 'It cannot be acted, which is exactly why people believe it') },
    { label: bi('Mi cũ trước khi tháo', 'The old set before removal'), when: bi('lúc khách vừa nằm xuống', 'as she lies down'), why: bi('Khách mới sợ nhất là "mi hỏng" — cho họ thấy mình xử lý được', 'What a new customer fears most is a ruined set — show them you handle it'), },
    { label: bi('Khay mi và bản đồ mi vẽ tay', 'The lash tray and the hand-drawn map'), when: bi('trước ca làm', 'before the appointment'), why: bi('Bản đồ mi là thứ chứng minh đây là thiết kế riêng chứ không phải dán đại', 'The map is what proves this was designed for one face and not stuck on at random') },
  ],
  postTypes: [
    { label: bi('Mắt nhắm — bộ mi rõ từng sợi', 'The closed eye, fibre by fibre'), job: bi('Bài chứng minh tay nghề. Người trong ngành nhìn là biết, khách nhìn là tin', 'The craft post. The trade can read it, and the customer believes it'), shots: bi('Cận sát chân mi · nhìn nghiêng độ cong · hai mắt đối xứng', 'Tight on the lash line · side-on for the curl · both eyes for symmetry') },
    { label: bi('Classic, hybrid, volume khác nhau ra sao', 'Classic, hybrid, volume — side by side'), job: bi('Gỡ đúng câu hỏi làm khách mới chần chừ không đặt lịch', 'Clears the exact question that keeps a new customer from booking'), shots: bi('Bộ classic · bộ hybrid · bộ volume · cùng một góc cho cả ba', 'A classic set · a hybrid · a volume · the same angle for all three') },
    { label: bi('Bản đồ mi theo dáng mắt', 'Mapping for the eye shape'), job: bi('Bài nói với khách rằng mi được thiết kế cho mắt của họ', 'The post that says the set was designed for her eyes'), shots: bi('Vẽ bản đồ trên miếng dán · giải thích 1 câu · kết quả', 'Drawing the map on the pad · one line of explanation · the result') },
    { label: bi('Cách chăm mi cho bền', 'Aftercare that keeps them on'), job: bi('Mi rụng sớm là lý do khách bỏ tiệm mà không nói', 'Lashes falling early is why customers leave without saying so'), shots: bi('Chải mi · rửa mặt đúng cách · điều tuyệt đối tránh', 'Brushing · washing properly · the one thing never to do') },
    { label: bi('Một ca dặm mi, từ đầu đến cuối', 'A fill, start to finish'), job: bi('Khách mới không biết dặm mi là gì và vì sao phải quay lại — bài này bán cả chu kỳ', 'New customers do not know what a fill is or why they must return — this post sells the whole cycle'), shots: bi('Mi đã thưa · gỡ sợi rụng · gắn bù · hai mắt đều lại', 'The gappy set · removing what fell · filling in · both eyes even again') },
  ],
  habits: [
    { kind: 'engage', text: bi('Nhắn khách tới hạn dặm mi', 'Message everyone due for a fill'), why: bi('Ngành mi sống bằng lịch dặm 2–3 tuần. Quên nhắn một tuần là mất nguyên chu kỳ', 'This trade lives on the two-to-three-week fill. Miss a week of reminders and you lose a whole cycle'), when: bi('đầu ngày', 'first thing') },
    { kind: 'story', text: bi('Đăng story một bộ mi mỗi ngày', 'Story one set a day'), why: bi('Mi khó chụp đẹp bằng điện thoại — đăng đều thì tay nghề chụp cũng lên theo', 'Lashes are hard to shoot on a phone — posting daily is how the shooting gets better too'), when: bi('lúc làm xong', 'as you finish') },
    { kind: 'engage', text: bi('Hẹn ngày dặm ngay khi khách còn ngồi', 'Book the fill before she stands up'), why: bi('Hẹn sau khi khách về là hẹn không bao giờ đặt', 'A fill booked after she leaves is a fill never booked'), when: bi('lúc thanh toán', 'at checkout') },
  ],
};

const BROW: Playbook = {
  trade: bi('ngành chân mày', 'brow studios'),
  dailySources: [
    { label: bi('Hai bên mày đối xứng sau khi xong', 'Both brows, symmetrical, finished'), when: bi('ngay khi lau sạch lần cuối', 'right after the final wipe'), why: bi('Đối xứng là cả nghề này. Chụp thẳng mặt mới thấy', 'Symmetry is the entire trade. Only a straight-on shot shows it') },
    { label: bi('Nét vẽ dáng mày trước khi làm', 'The shape drawn on before you start'), when: bi('lúc đo và vẽ', 'while measuring and drawing'), why: bi('Khách sợ nhất là bị làm hỏng dáng — cho họ thấy mọi thứ được đo trước', 'What people fear is a ruined shape — show them everything is measured first') },
    { label: bi('Mày thưa/lộn xộn lúc mới ngồi xuống', 'The sparse or unruly brow as she sits'), when: bi('trước khi chạm vào', 'before you touch it'), why: bi('Ngành này không có "trước" thì "sau" không nói lên điều gì', 'In this trade, without the "before" the "after" says nothing') },
  ],
  postTypes: [
    { label: bi('Trước và sau, chụp thẳng mặt', 'Before and after, straight on'), job: bi('Bài chủ lực. Dáng mày đổi là đổi cả gương mặt, và ảnh cho thấy điều đó ngay', 'The workhorse. A brow shape changes a face, and the photo shows it instantly'), shots: bi('Ảnh trước chụp thẳng · ảnh sau cùng góc cùng đèn · cận một bên mày', 'The before, straight on · the after at the same angle and light · one brow close up') },
    { label: bi('Threading, wax hay lamination', 'Threading, wax or lamination'), job: bi('Khách chọn phương pháp trước khi chọn tiệm', 'People choose the method before they choose the shop'), shots: bi('Threading trên khách mày dày · wax trên khách da nhạy · lamination trên mày thưa', 'Threading on a thick brow · wax on sensitive skin · lamination on a sparse one') },
    { label: bi('Dáng mày theo khuôn mặt', 'Shape for the face'), job: bi('Bài chứng minh mình đo chứ không làm theo mẫu có sẵn', 'The post that proves you measure rather than copy a template'), shots: bi('Đo bằng chỉ · đánh dấu 3 điểm · kết quả', 'Measuring with thread · marking the three points · the result') },
    { label: bi('Sửa dáng mày bị làm hỏng', 'Fixing a brow somebody else ruined'), job: bi('Nhóm khách gấp gáp nhất và trung thành nhất — họ vừa mất niềm tin ở chỗ khác', 'The most urgent and most loyal customers there are — they just lost their trust somewhere else'), shots: bi('Dáng lệch cận cảnh · cách xử lý · hai bên cân lại', 'The uneven shape close up · how it is corrected · both sides matched') },
    { label: bi('Người thợ và cách đo của họ', 'The artist and how she measures'), job: bi('Ngành này khách chọn người, không chọn tiệm', 'In this trade people choose a person, not a shop'), shots: bi('Thợ đang đo · dụng cụ riêng · một câu về nghề', 'Measuring · her own tools · one line about the work') },
  ],
  habits: [
    { kind: 'story', text: bi('Đăng story một cặp mày trước–sau mỗi ngày', 'Story one before-and-after brow a day'), why: bi('Đây là ngành mà một tấm ảnh so sánh bán hàng giỏi hơn mọi lời quảng cáo', 'This is a trade where one comparison photo sells better than any copy'), when: bi('lúc làm xong', 'as you finish') },
    { kind: 'engage', text: bi('Nhắc khách lịch tỉa lại sau 4–6 tuần', 'Remind customers of the four-to-six week reshape'), why: bi('Mày mọc lại là đồng hồ đếm ngược có sẵn — chỉ cần nhắc đúng lúc', 'Regrowth is a built-in clock — it only needs a reminder at the right moment'), when: bi('đầu tuần', 'start of the week') },
  ],
};

const SPA: Playbook = {
  trade: bi('ngành chăm sóc da', 'skincare and facials'),
  dailySources: [
    { label: bi('Làn da ngay sau liệu trình', 'The skin right after the treatment'), when: bi('trước khi khách trang điểm lại', 'before she puts makeup back on'), why: bi('Da căng bóng chỉ giữ được khoảng một giờ. Sau đó không còn gì để chụp', 'That glow holds for about an hour. After that there is nothing to photograph') },
    { label: bi('Bàn máy, khăn ấm, khay dụng cụ', 'The bed, the warm towels, the tray'), when: bi('trước khi khách vào', 'before the customer comes in'), why: bi('Ngành này bán cảm giác được chăm sóc — quang cảnh phòng nói điều đó nhanh hơn lời', 'This trade sells the feeling of being looked after — the room says it faster than words'), },
    { label: bi('So sánh da sau một liệu trình nhiều buổi', 'The same skin across a course of sessions'), when: bi('cùng góc, cùng ánh sáng, mỗi buổi một tấm', 'same angle, same light, one shot per session'), why: bi('Da không đổi sau một buổi. Chỉ chuỗi ảnh mới nói được sự thật, và sự thật đó bán liệu trình', 'Skin does not change in one session. Only a series tells the truth, and that truth sells the course') },
  ],
  postTypes: [
    { label: bi('Hành trình một liệu trình', 'One course, start to finish'), job: bi('Bài biến một lần tới thành liệu trình — thay đổi hẳn doanh thu trên mỗi khách', 'Turns a single visit into a course, which changes revenue per customer outright'), shots: bi('Buổi 1 · buổi 3 · buổi 6, cùng góc cùng đèn', 'Session one · session three · session six, same angle and light') },
    { label: bi('Giải thích một bước trong quy trình', 'Explain one step of the protocol'), job: bi('Khách trả tiền cho thứ họ hiểu, và bỏ qua thứ nghe như phép màu', 'People pay for what they understand and skip what sounds like magic'), shots: bi('Cận thao tác · một câu vì sao bước này cần thiết', 'Close on the hands · one line on why this step exists') },
    { label: bi('Trả lời một hiểu lầm phổ biến', 'Correct one common myth'), job: bi('Ngành da đầy lời đồn — ai nói thật là ai được tin', 'This trade is full of folklore — whoever tells the truth is who gets trusted'), shots: bi('Câu đồn hiện trên màn hình · vừa làm vừa nói lại cho đúng', 'The myth on screen · correct it while you work') },
    { label: bi('Nên chăm da tại nhà thế nào giữa hai buổi', 'What to do at home between sessions'), job: bi('Kết quả hỏng ở nhà thì khách đổ cho spa. Dạy trước là bảo vệ chính mình', 'A result ruined at home gets blamed on the spa. Teaching first is self-defence'), shots: bi('3 bước tối thiểu · thứ tự thoa · sản phẩm nên tránh', 'The three minimum steps · the order · what to avoid') },
    { label: bi('Người làm và tay nghề của họ', 'The esthetician and her hands'), job: bi('Khách giao mặt mình cho một người, không phải cho một phòng', 'A customer hands her face to a person, not to a room'), shots: bi('Thao tác tay cận cảnh · dụng cụ riêng · một câu về nghề', 'Close on the hands · her own tools · one line about the work') },
  ],
  habits: [
    { kind: 'engage', text: bi('Nhắn khách đang giữa liệu trình mà chưa đặt buổi tiếp', 'Message anyone mid-course with no next session booked'), why: bi('Liệu trình đứt giữa chừng là mất cả kết quả lẫn doanh thu — và khách thường chỉ quên', 'A course that stops halfway loses the result and the revenue — and usually she just forgot'), when: bi('đầu ngày', 'first thing') },
    { kind: 'story', text: bi('Đăng story một khuôn mặt sau liệu trình', 'Story one face after a treatment'), why: bi('Ánh sáng phòng spa vốn đã đẹp — chỉ cần bấm máy đều', 'Treatment-room light is already flattering — it only needs the shutter pressed regularly'), when: bi('ngay sau buổi làm', 'right after the session') },
  ],
};

const MASSAGE: Playbook = {
  trade: bi('ngành massage', 'massage and bodywork'),
  dailySources: [
    { label: bi('Căn phòng trước khi khách bước vào', 'The room before anyone walks in'), when: bi('lúc vừa dọn xong', 'once it is set'), why: bi('Ngành này không có "thành phẩm" để chụp. Thứ bán được là cảm giác, và căn phòng là thứ duy nhất cho thấy nó', 'This trade has no finished object to photograph. What sells is a feeling, and the room is the only thing that shows it') },
    { label: bi('Bàn tay đang làm việc, không thấy mặt khách', 'Hands working, no face in frame'), when: bi('giữa ca', 'mid-session'), why: bi('Riêng tư là điều kiện bắt buộc ở đây — quay tay là cách duy nhất vừa cho thấy nghề vừa giữ đúng ranh giới', 'Privacy is non-negotiable here — hands are the only way to show the craft without crossing it') },
    { label: bi('Khách nói một câu sau khi xong', 'One sentence from a customer afterwards'), when: bi('lúc khách ngồi dậy uống nước', 'while she sits up with a glass of water'), why: bi('Không chụp được sự thư giãn. Nhưng nghe được', 'Relaxation cannot be photographed. It can be heard') },
  ],
  postTypes: [
    { label: bi('Kiểu massage này hợp với ai', 'Who each style is for'), job: bi('Khách đặt nhầm loại rồi thất vọng — bài này vừa kéo khách vừa chặn review xấu', 'People book the wrong style and leave disappointed — this brings customers and prevents bad reviews'), shots: bi('Tay thao tác từng kiểu · một câu mô tả cảm giác thật', 'The hands for each style · one honest line on how it feels') },
    { label: bi('Đau ở đâu thì làm gì', 'Where it hurts, and what helps'), job: bi('Nhóm khách có vấn đề cụ thể đặt lịch nhanh hơn nhóm tìm để thư giãn', 'Customers with a specific problem book faster than customers seeking relaxation'), shots: bi('Chỉ vào vùng đau trên hình · thao tác tương ứng · một câu nên đi mấy buổi', 'Point to the area on a diagram · the corresponding work · one line on how many sessions') },
    { label: bi('Không gian và sự riêng tư', 'The space and the privacy'), job: bi('Khách mới lo nhất là "chỗ đó có đàng hoàng không" — trả lời trước khi họ phải hỏi', 'A new customer\'s first worry is whether the place is respectable — answer it before they have to ask'), shots: bi('Phòng riêng · khăn sạch · quy trình đón khách', 'The private room · clean linen · how a customer is received') },
    { label: bi('Lần đầu đi massage thì diễn ra thế nào', 'What happens on a first visit'), job: bi('Người chưa đi bao giờ ngại vì không biết phải làm gì — gỡ đúng chỗ ngại đó', 'People who have never been are put off by not knowing what to do — this removes exactly that'), shots: bi('Đón khách · thay đồ ra sao · nằm thế nào · lúc kết thúc', 'Arriving · how to change · how to lie down · how it ends') },
    { label: bi('Một động tác tự làm được ở nhà', 'One thing you can do yourself at home'), job: bi('Cho đi một chút là cách rẻ nhất để người lạ tin mình biết nghề', 'Giving something away is the cheapest way for a stranger to believe you know the work'), shots: bi('Chỉ vị trí · làm mẫu chậm · nói rõ khi nào cần tới thợ', 'Point to the spot · demonstrate slowly · say plainly when it needs a professional') },
  ],
  habits: [
    { kind: 'engage', text: bi('Nhắn khách quen quá 4 tuần chưa quay lại', 'Message regulars four weeks overdue'), why: bi('Massage là thói quen, và thói quen đứt là đứt luôn nếu không ai nhắc', 'Massage is a habit, and a broken habit stays broken unless somebody mentions it'), when: bi('đầu tuần', 'start of the week') },
    { kind: 'story', text: bi('Đăng story căn phòng đã dọn sẵn', 'Story the room, ready'), why: bi('Rẻ nhất, nhanh nhất, và là thứ khách mới muốn thấy nhất', 'The cheapest, fastest shot there is, and the one a new customer most wants to see'), when: bi('trước giờ mở cửa', 'before opening') },
  ],
};

const PMU: Playbook = {
  trade: bi('ngành phun xăm thẩm mỹ', 'permanent makeup'),
  dailySources: [
    { label: bi('Ảnh ngay sau khi làm — và ảnh sau khi lành', 'The fresh result, and the healed one'), when: bi('hôm làm, rồi xin lại sau 4–6 tuần', 'on the day, then ask again after four to six weeks'), why: bi('Ảnh mới làm luôn đậm hơn thật. Chỉ ảnh đã lành mới là thứ khách sẽ nhận được, và đăng thiếu nó là hứa quá lời', 'A fresh result always looks darker than the truth. Only the healed photo shows what she will actually get, and posting without it over-promises') },
    { label: bi('Nét vẽ dáng trước khi chạm kim', 'The shape drawn before any needle'), when: bi('lúc đo và vẽ tay', 'while measuring and drawing'), why: bi('Nỗi sợ lớn nhất của ngành này là "xăm rồi không sửa được". Cho thấy mọi thứ được duyệt trước khi làm', 'The fear in this trade is permanence. Show that everything is agreed before anything is permanent') },
    { label: bi('Khách xem gương và gật đầu trước khi bắt đầu', 'She looks in the mirror and says yes, before you start'), when: bi('ngay trước ca làm', 'right before the session'), why: bi('Đây là bằng chứng về quy trình, và là thứ khách mới cần thấy nhất', 'This is proof of process, and it is what a nervous new customer most needs to see') },
  ],
  postTypes: [
    { label: bi('Đã lành, chụp sau 4–6 tuần', 'Healed, at four to six weeks'), job: bi('Bài trung thực nhất trong ngành. Đăng đều là tự tách mình khỏi chỗ chỉ khoe ảnh mới làm', 'The most honest post in this trade. Posting it regularly separates you from shops that only show fresh work'), shots: bi('Cùng góc với ảnh ngày làm · ánh sáng tự nhiên · không lọc', 'Same angle as the day-one shot · natural light · no filter') },
    { label: bi('Quy trình lành da theo ngày', 'The healing timeline, day by day'), job: bi('Gỡ nỗi sợ lớn nhất và giảm hẳn số tin nhắn hoảng loạn ngày thứ 5', 'Clears the biggest fear and cuts the panicked day-five messages'), shots: bi('Ngày 1 · ngày 3 · ngày 7 · ngày 30 · một câu mỗi mốc', 'Day one · three · seven · thirty · one line each') },
    { label: bi('Kỹ thuật nào hợp loại da nào', 'Which technique suits which skin'), job: bi('Chọn sai kỹ thuật theo loại da là nguyên nhân số một của kết quả xấu', 'The wrong technique for a skin type is the number one cause of a bad result'), shots: bi('Da dầu · da khô · kết quả tương ứng của từng kỹ thuật', 'Oily · dry · the matching result for each technique') },
    { label: bi('Có đau không, và giảm đau ra sao', 'Does it hurt, and what is done about it'), job: bi('Sợ đau là lý do khách hoãn lịch cả năm trời. Nói thẳng là chốt được', 'Fear of pain is why people put this off for a year. Saying it plainly closes the booking'), shots: bi('Thuốc tê · phản ứng thật của khách · một câu khách tự nói', 'The numbing · a real reaction · one sentence in her own words') },
    { label: bi('Sửa lại nét phun cũ của chỗ khác', 'Correcting somebody else\'s old work'), job: bi('Nhóm khách sẵn sàng trả cao nhất, vì họ đang mang một lỗi trên mặt mỗi ngày', 'The customers who will pay the most, because they wear the mistake on their face every day'), shots: bi('Nét cũ ám xanh · quy trình xử lý · kết quả đã lành', 'The old blue-grey shape · the correction process · the healed result') },
  ],
  habits: [
    { kind: 'engage', text: bi('Nhắn khách tới hạn dặm lại sau 1–2 năm', 'Message customers due for a top-up after a year or two'), why: bi('Màu phai là hẹn quay lại có sẵn, nhưng cách nhau quá lâu nên không ai tự nhớ', 'Fading is a built-in rebooking, but the gap is long enough that nobody remembers on their own'), when: bi('mỗi tháng một lần rà danh sách', 'once a month, work the list') },
    { kind: 'story', text: bi('Đăng story ảnh đã lành, ghi rõ mốc tuần', 'Story a healed result and say how many weeks'), why: bi('Ghi rõ mốc tuần là điều làm khách tin — và gần như không ai trong ngành chịu ghi', 'Stating the week is what earns belief, and almost nobody in this trade states it'), when: bi('khi khách quay lại kiểm tra', 'when a customer comes back for a check') },
  ],
};

const NAIL: Playbook = { ...SALON, trade: bi('ngành nail', 'nail salons') };

const PLAYBOOKS: Record<string, Playbook> = {
  SALON, RESTAURANT, REAL_ESTATE, SERVICE,
  // NAIL is SALON under its own name: the original playbook was written for
  // a nail salon, so aliasing is honest where copying would drift.
  NAIL, HAIR, LASH, BROW, SPA, MASSAGE, PMU,
};

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
  NAIL: ['nailsoftiktok', 'nailart', 'nailtech'],
  HAIR: ['hairtok', 'hairtransformation', 'balayage'],
  LASH: ['lashtech', 'lashextensions', 'lashesoftiktok'],
  BROW: ['browsoftiktok', 'browlamination', 'microblading'],
  SPA: ['estheticiansoftiktok', 'skincaretok', 'facials'],
  MASSAGE: ['massagetherapy', 'massagetok', 'bodywork'],
  PMU: ['pmuartist', 'permanentmakeup', 'lipblush'],
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
  HAIR: [
    {
      title: bi('Sản phẩm chăm sóc tóc tăng doanh số mạnh nhất 24 giờ', 'Hair care products rising fastest in the last 24 hours'),
      url: 'https://www.amazon.com/gp/movers-and-shakers/beauty/11057241',
      what: bi('Bảng "Movers & Shakers" riêng ngành tóc — xếp theo mức tăng doanh số 24 giờ.', 'The hair-care "Movers & Shakers" board — ranked by how much sales moved in 24 hours.'),
      how: bi('Sản phẩm nhảy lên bảng này nghĩa là khách đang tự mua về dùng. Đó là thứ đáng bán tại quầy và đáng nhắc trong bài tư vấn.', 'A product jumping onto this board means customers are buying it themselves. That is worth stocking at the counter and worth mentioning when you advise.'),
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
  // The SALON fallback is CORRECT for the beauty trades, not a gap waiting to
  // be filled: Amazon's Beauty movers board covers lashes, brows, skincare and
  // PMU aftercare in one place, and splitting it per trade would produce six
  // links to the same page. HAIR is the exception — hair care is its own
  // category over there, with its own movers.
  const rows = PRODUCT_PAGES[key] ?? PRODUCT_PAGES.SALON;
  return rows.map((r, i) => ({ key: `prod-${key.toLowerCase()}-${i}`, ...r }));
}
