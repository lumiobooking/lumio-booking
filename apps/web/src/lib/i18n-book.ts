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
