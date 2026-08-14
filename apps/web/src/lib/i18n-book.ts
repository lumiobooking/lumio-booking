/**
 * Wording for the page CUSTOMERS book on.
 *
 * Deliberately separate from the staff dictionary, and driven by a different
 * signal. Staff read the language they picked in the header; a customer never
 * picks anything, so the page follows the SALON's country. A shop in Vietnam
 * serves Vietnamese customers whatever browser they walk in with, and a shop in
 * Texas must keep showing exactly the English page it shows today.
 *
 * Anything not translated falls through to the English text, so a missing key
 * degrades to what the page said before rather than to a blank.
 */
export type BookLang = 'en' | 'vi';

/** Country → the language its customers read. Unknown country → English, which
 *  is what every salon currently running gets. */
export function bookLangForCountry(country?: string | null): BookLang {
  return String(country || '').trim().toUpperCase() === 'VN' ? 'vi' : 'en';
}

const VI: Record<string, string> = {
  // ---- steps -------------------------------------------------------------
  'Services': 'Dịch vụ',
  'Nail tech': 'Thợ',
  'Time': 'Giờ',
  'Confirm': 'Xác nhận',
  'Table': 'Bàn',
  'Details': 'Thông tin',

  // ---- service picking ---------------------------------------------------
  'Pick a service to start': 'Chọn dịch vụ để bắt đầu',
  'Tap + to add a service. You can pick more than one.': 'Bấm + để thêm dịch vụ. Có thể chọn nhiều dịch vụ.',
  'Tap + on any service. You can add more than one.': 'Bấm + ở dịch vụ bất kỳ. Có thể chọn nhiều dịch vụ.',
  'Search a service…': 'Tìm dịch vụ…',
  'Select a service': 'Chọn dịch vụ',
  'Nothing found.': 'Không tìm thấy dịch vụ nào.',
  'Bringing friends?': 'Đi cùng bạn bè?',
  'Add guest': 'Thêm người',
  'Popular': 'Phổ biến',
  'Total': 'Tổng cộng',
  'Cash price': 'Giá tiền mặt',
  'Card price': 'Giá thẻ',

  // ---- reassurance panel -------------------------------------------------
  'Book any time': 'Đặt lịch bất cứ lúc nào',
  'Open 24/7 online — even when the shop is closed.': 'Đặt online 24/7 — kể cả khi tiệm đã đóng cửa.',
  'Instant confirmation': 'Xác nhận ngay',
  'You get a text the moment your spot is held.': 'Có tin nhắn ngay khi chỗ của bạn được giữ.',
  'Pick your tech': 'Chọn thợ',
  'Choose the person you always go to, or let us match you.': 'Chọn thợ quen của bạn, hoặc để tiệm sắp xếp.',
  'Pay how you like': 'Thanh toán tuỳ ý',
  'Online now, or at the shop when you arrive.': 'Trả online ngay, hoặc trả tại tiệm khi đến.',

  // ---- times -------------------------------------------------------------
  'Choose the time after your service ✨': 'Chọn giờ sau khi đã chọn dịch vụ ✨',
  'No times left on this day. Try the next one.': 'Ngày này đã hết giờ trống. Thử ngày kế tiếp.',
  'Join the waitlist': 'Vào danh sách chờ',
  'First one free at your time': 'Có chỗ trống đúng giờ bạn muốn là báo ngay',
  'Today': 'Hôm nay',
  'Tomorrow': 'Ngày mai',
  'Any technician': 'Thợ nào cũng được',
  'No technician lists ': 'Chưa có thợ nào nhận ',

  // ---- customer details --------------------------------------------------
  'First name': 'Tên',
  'Last name': 'Họ',
  'Phone': 'Số điện thoại',
  'Email': 'Email',
  'Birthday': 'Sinh nhật',
  'Notes': 'Ghi chú',
  'People': 'Số người',
  'Name': 'Họ tên',

  // ---- validation --------------------------------------------------------
  'Enter a valid email address.': 'Email chưa hợp lệ.',
  'Enter a valid phone number (8–15 digits).': 'Số điện thoại chưa hợp lệ (8–15 chữ số).',
  'Please enter your first name.': 'Vui lòng nhập tên của bạn.',
  'Please enter your phone number.': 'Vui lòng nhập số điện thoại.',

  // ---- actions and outcome ----------------------------------------------
  'Book': 'Đặt lịch',
  'Booking…': 'Đang đặt…',
  'Back': 'Quay lại',
  'Next': 'Tiếp tục',
  'Continue': 'Tiếp tục',
  'Book another': 'Đặt thêm lịch',
  'Payment: ': 'Thanh toán: ',
  'Pay online': 'Trả online',
  'Pay at the shop': 'Trả tại tiệm',

  // ---- clock, calendar and duration --------------------------------------
  // Vietnam reads a 24-hour clock, so "5:30 CH" is wrong twice over: the words
  // are borrowed and the format is American. The locale below drives both.
  'today': 'hôm nay',
  'tomorrow': 'ngày mai',
  'Sunday': 'Chủ Nhật',
  'Monday': 'Thứ Hai',
  'Tuesday': 'Thứ Ba',
  'Wednesday': 'Thứ Tư',
  'Thursday': 'Thứ Năm',
  'Friday': 'Thứ Sáu',
  'Saturday': 'Thứ Bảy',
  '{h}h': '{h} giờ',
  '{m}min': '{m} phút',
  '0min': '0 phút',

  // ---- the opening line at the top of the page ---------------------------
  'Next opening {when} at {time}': 'Còn chỗ {when} lúc {time}',
  'Next opening {when}': 'Còn chỗ {when}',
  'Open until {time}': 'Mở cửa đến {time}',
  'Pick a service — we’ll show you every free time.': 'Chọn dịch vụ — tiệm sẽ hiện toàn bộ giờ còn trống.',
  'Book online · confirmed in seconds': 'Đặt online · xác nhận trong vài giây',
  'Pick your service, tech and time': 'Chọn dịch vụ, thợ và giờ',
  'Instant confirmation by text': 'Xác nhận ngay bằng tin nhắn',
  'Pay online or at the shop': 'Trả online hoặc trả tại tiệm',

  // ---- step headings -----------------------------------------------------
  'Choose your nail tech': 'Chọn thợ làm cho bạn',
  'Select time': 'Chọn giờ',
  'Confirm booking': 'Xác nhận đặt lịch',
  'Tap ＋ to add a service. You can pick more than one.': 'Bấm ＋ để thêm dịch vụ. Có thể chọn nhiều dịch vụ.',
  'Go with the person you know, or let us give you the first one free.': 'Chọn thợ quen của bạn, hoặc để tiệm sắp xếp.',

  // ---- discounts ---------------------------------------------------------
  // Percentages and the shop's own wording stay as the salon typed them; only
  // the sentence around them is translated.
  'Save on select days!': 'Ưu đãi theo ngày!',
  'everything': 'tất cả dịch vụ',
  'select services': 'một số dịch vụ',
  '{day}: −{percent}% off {what}': '{day}: giảm {percent}% {what}',
  '{when}: −{percent}% off {what}': '{when}: giảm {percent}% {what}',
  'Visit rewards': 'Ưu đãi khách quen',
  'Bring your friends and save!': 'Rủ bạn bè cùng đi để được giảm giá!',
  '{n} visit: {percent}% off': 'Lần {n}: giảm {percent}%',
  '{size}+ people: {percent}% off': 'Từ {size} người: giảm {percent}%',
  '(applied automatically)': '(tự động áp dụng)',

  // ---- waitlist ----------------------------------------------------------
  'Your name': 'Họ tên của bạn',
  'Email (optional)': 'Email (không bắt buộc)',
  'Joining…': 'Đang gửi…',
  'Join waitlist': 'Vào danh sách chờ',

  // ---- footer ------------------------------------------------------------
  'Privacy': 'Chính sách bảo mật',
  'Messaging Terms': 'Điều khoản nhắn tin',
};

const TABLES: Record<BookLang, Record<string, string>> = { en: {}, vi: VI };

/**
 * The page renders exactly one salon, so the language is a property of the page
 * rather than of any component inside it. Keeping it at module level lets the
 * small presentational helpers defined outside the page component translate too,
 * without threading a translator through every signature.
 */
let currentLang: BookLang = 'en';

export function setBookLang(lang: BookLang): void {
  currentLang = lang;
}

/** Translate a customer-facing string; unknown keys fall back to the English. */
export function bt(s: string): string {
  return (TABLES[currentLang] ?? {})[s] ?? s;
}

/** Translate and fill placeholders: btf('Open until {time}', { time }). */
export function btf(s: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (out, [k, v]) => out.split(`{${k}}`).join(String(v)),
    bt(s),
  );
}

/**
 * Locale for dates, times and numbers on the customer page.
 *
 * Deliberately NOT uiLocale(): that reads the language the STAFF picked, which
 * a customer has never set, so every visitor to a Vietnamese shop was being
 * handed American date order and an AM/PM clock. This follows the same salon
 * country the wording does, so the whole page agrees with itself.
 */
export function bookLocale(): string {
  return currentLang === 'vi' ? 'vi-VN' : 'en-US';
}
