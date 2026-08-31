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

export interface ContentSource {
  /** The moment or object the clip comes from. */
  label: string;
  /** When in the day to catch it — the reason most of these get missed. */
  when: string;
  why: string;
}

export interface PostType {
  /** What this post is, in the owner's words. */
  label: string;
  /** The job it does — why it is not interchangeable with the others. */
  job: string;
  /** Concrete shots, in order. */
  shots: string;
}

export interface FeedLink {
  key: string;
  title: string;
  url: string;
  what: string;
  how: string;
  source: string;
}

export interface Playbook {
  trade: string;
  dailySources: ContentSource[];
  postTypes: PostType[];
  /**
   * Habits that cost minutes and compound.
   *
   * `kind` is a literal union rather than `string` so it stays assignable to
   * the week plan's JobKind. Widening it to `string` compiled here and failed
   * over there — the kind of error that only appears once the two files meet.
   */
  habits: { kind: 'engage' | 'story'; text: string; why: string; when: string }[];
}

const SALON: Playbook = {
  trade: 'ngành nail',
  dailySources: [
    { label: 'Bộ móng vừa làm xong', when: 'ngay trước khi khách trả tiền', why: 'Đây là lúc duy nhất bộ móng còn hoàn hảo và ánh sáng còn ở bàn làm. Sau đó là mất' },
    { label: 'Phản ứng thật của khách khi nhìn tay', when: '3 giây đầu khách quay tay lại', why: 'Không diễn được, và đó chính là lý do người xem tin' },
    { label: 'Bộ móng cũ hỏng lúc khách vừa ngồi xuống', when: 'trước khi bắt đầu tháo', why: 'Không có ảnh "trước" thì "sau" chỉ là một bộ móng đẹp như mọi bộ khác' },
    { label: 'Đoạn khó nhất trong ca hôm nay', when: 'lúc thợ đang tập trung', why: 'Tay nghề nhìn thấy được thì không cần nói ra' },
    { label: 'Kệ màu và bộ sưu tập mới', when: 'sáng trước khi mở cửa', why: 'Màu mới là cái cớ tự nhiên nhất để đăng bài mà không phải nghĩ' },
    { label: 'Khách quen quay lại lần thứ n', when: 'lúc chào hỏi', why: 'Khách cũ quay lại là bằng chứng mạnh nhất, và không tiệm nào chép được' },
  ],
  postTypes: [
    { label: 'Mẫu đang được đặt nhiều nhất', job: 'Bài chắc ăn — bán cái khách đang thật sự chọn, không phải cái tiệm thích nhất', shots: 'Cận móng xoay tay · góc từ trên xuống · khách cầm ly cà phê khoe tay' },
    { label: 'Quy trình / cận cảnh tay nghề', job: 'Bài thuyết phục người đang phân vân giữa tiệm mình và tiệm bên cạnh', shots: 'Tháo bộ cũ · dũa tạo dáng · nét vẽ khó nhất · thành phẩm' },
    { label: 'Trước và sau, hoặc khách phản ứng thật', job: 'Bài kéo người lạ dừng lại — tò mò trước, tin sau', shots: 'Bộ móng hỏng cận cảnh · lướt nhanh quá trình · mặt khách khi nhìn tay' },
    { label: 'Người thợ và tay nghề của họ', job: 'Bài xây niềm tin vào NGƯỜI — khách quay lại vì thợ, không vì tiệm', shots: 'Thợ đang tập trung · dụng cụ riêng · một câu thợ nói về nghề' },
    { label: 'Trả lời một câu khách hay hỏi', job: 'Bài gỡ lý do khách còn chần chừ trước khi đặt lịch', shots: 'Câu hỏi hiện trên màn hình · vừa làm vừa trả lời · kết bằng lời mời đặt lịch' },
  ],
  habits: [
    { kind: 'engage', text: 'Trả lời hết tin nhắn và bình luận còn sót', why: 'Khách nhắn mà chờ quá một buổi là mất — đây là việc rẻ nhất trong ngày', when: 'trước khi mở cửa' },
    { kind: 'story', text: 'Chụp 1 bộ móng đẹp nhất trong ngày, đăng story ngay', why: 'Story không cần dựng, chỉ cần đều. Đây là kho ảnh cho các bài tuần sau', when: 'lúc làm xong' },
    { kind: 'engage', text: 'Xin 1 khách vui vẻ nhất để lại đánh giá Google', why: 'Một đánh giá mỗi ngày đưa tiệm lên trước đối thủ trên bản đồ — nhanh hơn mọi thứ khác', when: 'lúc thanh toán' },
  ],
};

const RESTAURANT: Playbook = {
  trade: 'ngành ăn uống',
  dailySources: [
    { label: 'Món vừa ra khỏi bếp', when: 'trong 30 giây đầu, lúc còn bốc khói', why: 'Hơi nóng và độ bóng biến mất rất nhanh — quay muộn là quay một món nguội' },
    { label: 'Bếp lúc cao điểm', when: 'giờ đông nhất', why: 'Khách chọn quán vì tin người nấu, không vì ảnh món chỉnh sửa' },
    { label: 'Món đặc biệt trong ngày', when: 'trước giờ mở cửa', why: 'Lý do quay lại cho khách quen — cái mà thực đơn cố định không làm được' },
    { label: 'Khách gọi lại lần hai cùng một món', when: 'lúc chạy bàn', why: 'Bằng chứng ngon thật, không phải lời tự khen' },
    { label: 'Nguyên liệu lúc nhập về', when: 'sáng sớm', why: 'Nguyên liệu tươi là câu chuyện giá cao dễ kể nhất' },
  ],
  postTypes: [
    { label: 'Một món, quay kỹ', job: 'Bài kéo người đói đang lướt điện thoại — một món lên hình đẹp mạnh hơn cả thực đơn', shots: 'Cận lúc ra bếp · rót/chan/cắt · miếng đầu tiên' },
    { label: 'Người nấu và gian bếp', job: 'Bài xây niềm tin — giải thích vì sao đáng giá đó', shots: 'Tay đầu bếp làm việc · nguyên liệu thật · vài giây nói về món' },
    { label: 'Khách thật, phản ứng thật', job: 'Bài bằng chứng — người lạ tin người lạ hơn tin quán', shots: 'Bàn đông · khách gắp miếng đầu · một câu nhận xét ngắn' },
    { label: 'Món ít ai gọi mà ngon nhất', job: 'Bài đẩy món có lãi cao mà thực đơn không nói hộ được', shots: 'Món lên bàn · cắt/xé lộ bên trong · một câu vì sao nên thử' },
    { label: 'Một buổi trong quán, không dựng', job: 'Bài cho người chưa từng tới hình dung được không khí', shots: 'Mở cửa buổi sáng · lúc đông nhất · dọn bàn cuối ngày' },
  ],
  habits: [
    { kind: 'engage', text: 'Trả lời mọi đánh giá mới, kể cả đánh giá xấu', why: 'Người đọc đánh giá xấu quan tâm cách quán phản hồi hơn là nội dung phàn nàn', when: 'đầu ca' },
    { kind: 'story', text: 'Đăng story món đặc biệt hôm nay', why: 'Khách quen mở story lúc đang nghĩ trưa nay ăn gì — đúng lúc đó là đủ', when: 'trước 11 giờ' },
    { kind: 'engage', text: 'Xin 1 bàn hài lòng để lại đánh giá Google', why: 'Thứ hạng trên bản đồ quyết định lượng khách vãng lai nhiều hơn mọi quảng cáo', when: 'lúc tính tiền' },
  ],
};

const REAL_ESTATE: Playbook = {
  trade: 'ngành bất động sản',
  dailySources: [
    { label: 'Căn đang mở bán', when: 'lúc ánh sáng đẹp nhất trong ngày', why: 'Tour nhà là dạng được xem hết nhiều nhất trong ngành này' },
    { label: 'Câu hỏi khách vừa hỏi hôm nay', when: 'ngay sau cuộc gọi', why: 'Một khách hỏi thì trăm người đang tìm câu trả lời đó trên mạng' },
    { label: 'Một chi tiết nhỏ trong căn nhà', when: 'khi đi xem nhà', why: 'Chi tiết cụ thể đáng nhớ hơn cả căn nhà chụp toàn cảnh' },
    { label: 'Khu vực quanh nhà', when: 'lúc đi ngang', why: 'Người mua chọn khu trước, chọn nhà sau' },
  ],
  postTypes: [
    { label: 'Tour căn nhà quay dọc', job: 'Bài kéo người xem hết — dạng mạnh nhất của ngành này', shots: 'Cửa vào · bếp · phòng ngủ chính · điểm đặc biệt nhất · sân' },
    { label: 'Trả lời một câu hỏi thật của khách', job: 'Bài xây uy tín — người mua lần đầu tìm câu trả lời trước khi tìm môi giới', shots: 'Nói thẳng vào máy · một con số cụ thể trên màn hình · kết bằng bước tiếp theo' },
    { label: 'Giới thiệu khu vực', job: 'Bài kéo đúng người — ai đang cân nhắc chuyển tới khu này', shots: 'Đường phố · quán/trường gần đó · một câu về giá trung bình khu' },
    { label: 'Một căn vừa bán xong và vì sao', job: 'Bài bằng chứng — kết quả thật nói thay mọi lời giới thiệu', shots: 'Bảng đã bán · căn nhà · một con số về thời gian bán' },
    { label: 'Sai lầm hay gặp khi mua/bán', job: 'Bài giữ người xem tới cuối — ai cũng sợ mất tiền vì không biết', shots: 'Nói thẳng vào máy · một ví dụ cụ thể · cách tránh' },
  ],
  habits: [
    { kind: 'engage', text: 'Trả lời mọi tin nhắn hỏi về căn đang bán', why: 'Người mua nhắn nhiều môi giới cùng lúc — ai trả lời trước thường thắng', when: 'trong giờ làm' },
    { kind: 'story', text: 'Đăng story một góc nhà đang xem', why: 'Giữ sự hiện diện mà không tốn buổi quay', when: 'khi đi xem nhà' },
    { kind: 'engage', text: 'Nhắn 1 khách cũ hỏi thăm', why: 'Giới thiệu từ khách cũ là nguồn khách rẻ nhất trong ngành này', when: 'cuối ngày' },
  ],
};

const SERVICE: Playbook = {
  trade: 'ngành dịch vụ',
  dailySources: [
    { label: 'Một ca làm xong trong ngày', when: 'ngay khi hoàn thành', why: 'Bằng chứng cụ thể thuyết phục hơn mọi lời quảng cáo' },
    { label: 'Trạng thái trước khi làm', when: 'trước khi bắt đầu', why: 'Không có "trước" thì "sau" không nói lên điều gì' },
    { label: 'Câu hỏi khách hay hỏi nhất', when: 'ngay sau khi trả lời', why: 'Câu hỏi lặp lại là chủ đề nội dung có sẵn' },
  ],
  postTypes: [
    { label: 'Trước và sau của một ca thật', job: 'Bài bằng chứng — cái người ta cần thấy trước khi gọi', shots: 'Hiện trạng · vài giây làm · kết quả' },
    { label: 'Giải thích một thắc mắc thường gặp', job: 'Bài xây uy tín, kéo người đang tìm hiểu', shots: 'Nói thẳng vào máy · minh hoạ · bước tiếp theo' },
    { label: 'Người làm và cách làm', job: 'Bài tạo niềm tin vào người, không chỉ vào dịch vụ', shots: 'Chuẩn bị đồ nghề · thao tác chính · lời nhắn ngắn' },
    { label: 'Một ca khó hơn bình thường', job: 'Bài phân biệt mình với chỗ làm ẩu — cho thấy tay nghề ở chỗ khó', shots: 'Vì sao ca này khó · cách xử lý · kết quả' },
    { label: 'Khách cũ nói về lần làm trước', job: 'Bài bằng chứng — lời khách nặng hơn lời mình tự nói', shots: 'Khách nói ngắn · kết quả còn giữ được · lời mời liên hệ' },
  ],
  habits: [
    { kind: 'engage', text: 'Trả lời hết tin nhắn và cuộc gọi nhỡ', why: 'Khách dịch vụ thường gọi nhiều nơi — ai bắt máy trước thường được việc', when: 'đầu ngày' },
    { kind: 'story', text: 'Đăng story một ca đang làm', why: 'Đều đặn quan trọng hơn hoàn hảo', when: 'giữa ca' },
    { kind: 'engage', text: 'Xin 1 khách hài lòng để lại đánh giá', why: 'Đánh giá là thứ quyết định người lạ có gọi hay không', when: 'lúc xong việc' },
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
const PRODUCT_PAGES: Record<string, { title: string; url: string; what: string; how: string; source: string }[]> = {
  SALON: [
    {
      title: 'Sản phẩm làm đẹp tăng doanh số mạnh nhất 24 giờ',
      url: 'https://www.amazon.com/gp/movers-and-shakers/beauty',
      what: 'Bảng "Movers & Shakers" của Amazon — xếp theo mức tăng doanh số trong 24 giờ, không phải theo quảng cáo.',
      how: 'Thấy một loại sản phẩm móng nhảy lên bảng này nghĩa là khách đang tự mua ở nhà. Đó vừa là mẫu nên làm, vừa là thứ nên bán tại quầy.',
      source: 'Amazon',
    },
    {
      title: 'Sản phẩm móng bán chạy nhất',
      url: 'https://www.amazon.com/Best-Sellers-Beauty-Foot-Hand-Nail-Care/zgbs/beauty/11060451',
      what: 'Bảng bán chạy ngành chăm sóc tay chân móng, cập nhật hằng giờ.',
      how: 'Đối chiếu với kệ của tiệm: cái gì bán chạy ngoài kia mà tiệm chưa có là một câu hỏi đáng đặt cho nhà cung cấp.',
      source: 'Amazon',
    },
  ],
  RESTAURANT: [
    {
      title: 'Món và nguyên liệu đang được tìm nhiều',
      url: 'https://trends.google.com/trends/explore?date=today%201-m&geo=US&q=recipe&hl=vi',
      what: 'Nhu cầu tìm kiếm quanh đồ ăn trong 30 ngày, kèm truy vấn đang tăng.',
      how: 'Món nào đang được tìm nhiều thì đó là món nên đưa lên đầu thực đơn và lên bài trong tháng.',
      source: 'Google Trends',
    },
  ],
  REAL_ESTATE: [
    {
      title: 'Nhu cầu mua nhà đang lên hay xuống',
      url: 'https://trends.google.com/trends/explore?date=today%2012-m&geo=US&q=homes%20for%20sale&hl=vi',
      what: 'Đường nhu cầu 12 tháng — đọc được chu kỳ thay vì đoán theo cảm giác thị trường.',
      how: 'Đang lên thì đẩy nội dung cho người mua; đang xuống thì đẩy nội dung cho người bán và người thuê.',
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
      ? `Feed hashtag lớn nhất của ${p.trade} — mở ra là thấy cái gì đang chạy tốt ngay lúc này.`
      : `Feed hashtag phụ, thường ít cạnh tranh hơn và dễ lên hơn cho tiệm nhỏ.`,
    how: 'Xem 10 clip đầu, đếm xem bao nhiêu clip mở đầu bằng cận cảnh. Cách mở đầu lặp lại nhiều nhất là cách đang hiệu quả — làm theo cách mở, không chép nội dung.',
    source: 'TikTok',
  }));
  out.push({
    key: 'yt-search',
    title: `YouTube — ${p.trade}, mới nhất`,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${p.trade === 'ngành nail' ? 'nail art' : p.trade} ${market === 'VN' ? '' : 'tutorial'}`.trim())}`,
    what: 'Video dài hơn, nơi kỹ thuật mới xuất hiện trước khi lan sang clip ngắn.',
    how: 'Xem 1 video kỹ thuật mỗi tuần. Kỹ thuật mới học được là nội dung của cả tháng sau.',
    source: 'YouTube',
  });
  return out;
}

export function productWatch(industry?: string | null): FeedLink[] {
  const key = (industry || 'SALON').toUpperCase();
  const rows = PRODUCT_PAGES[key] ?? PRODUCT_PAGES.SALON;
  return rows.map((r, i) => ({ key: `prod-${key.toLowerCase()}-${i}`, ...r }));
}
