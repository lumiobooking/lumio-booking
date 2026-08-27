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
  'Open today {from} – {to}': 'Hôm nay mở cửa {from} – {to}',
  'Closed today — pick another date below': 'Hôm nay nghỉ — chọn ngày khác bên dưới',
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

  // ---- calendar words ----------------------------------------------------
  'Sun': 'CN', 'Mon': 'T2', 'Tue': 'T3', 'Wed': 'T4', 'Thu': 'T5', 'Fri': 'T6', 'Sat': 'T7',
  'January': 'Tháng 1', 'February': 'Tháng 2', 'March': 'Tháng 3', 'April': 'Tháng 4',
  'May': 'Tháng 5', 'June': 'Tháng 6', 'July': 'Tháng 7', 'August': 'Tháng 8',
  'September': 'Tháng 9', 'October': 'Tháng 10', 'November': 'Tháng 11', 'December': 'Tháng 12',
  'Morning': 'Buổi sáng',
  'Afternoon': 'Buổi chiều',
  'Evening': 'Buổi tối',
  'Month': 'Tháng',
  'Day': 'Ngày',
  'Year': 'Năm',
  'Birth month': 'Tháng sinh',
  'Birth day': 'Ngày sinh',
  'Birth year': 'Năm sinh',
  '🎂 Birthday (optional)': '🎂 Sinh nhật (không bắt buộc)',

  // ---- loading and failure ----------------------------------------------
  'This booking page was not found.': 'Không tìm thấy trang đặt lịch này.',
  'Could not load the salon.': 'Không tải được thông tin tiệm.',
  'Could not reach the booking service. Please try again later.': 'Không kết nối được hệ thống đặt lịch. Vui lòng thử lại sau.',
  'Network error. Please try again.': 'Lỗi kết nối. Vui lòng thử lại.',
  'Your earlier visits WERE booked.': 'Các lượt đặt trước đó ĐÃ được ghi nhận.',
  'Please try again.': 'Vui lòng thử lại.',
  'Could not join': 'Không đăng ký được',

  // ---- top bar and steps -------------------------------------------------
  'BOOKING ONLINE': 'ĐẶT LỊCH ONLINE',
  'Select Professional': 'Chọn thợ',
  'Select Time': 'Chọn giờ',
  'Confirm Booking': 'Xác nhận đặt lịch',
  'Any nail tech': 'Thợ nào cũng được',
  'Any tech': 'Thợ bất kỳ',
  'Any available': 'Thợ đang trống',
  'Get the app': 'Tải ứng dụng',
  'Book for Me': 'Đặt cho tôi',
  'Booking received': 'Đã nhận lịch hẹn',
  'Book for {n}': 'Đặt cho {n} người',
  'Book {n} visits': 'Đặt {n} lượt',
  'Each visit has its own confirmation and its own cancel link, so you can change one without touching the others.': 'Mỗi lượt hẹn có xác nhận và link huỷ riêng, nên bạn đổi một lượt mà không ảnh hưởng các lượt còn lại.',
  'Deposit due today: ': 'Đặt cọc hôm nay: ',
  'Paid online by card — includes {percent}% card fee ({amount}). Pay at the salon in cash to avoid it.': 'Trả online bằng thẻ — đã gồm {percent}% phí thẻ ({amount}). Trả tiền mặt tại tiệm thì không mất phí này.',
  'We’ll text you confirmations & reminders for this appointment from {salon}. Up to ~6 msgs/month. Msg & data rates may apply. Reply STOP to opt out, HELP for help.': 'Tiệm {salon} sẽ nhắn tin xác nhận và nhắc lịch cho lần hẹn này, khoảng 6 tin mỗi tháng. Có thể phát sinh cước tin nhắn. Nhắn STOP để ngừng nhận, HELP để được hỗ trợ.',
  '{n} bookings received': 'Đã nhận {n} lịch hẹn',
  'Booking {n} visits · total': 'Đặt {n} lượt · tổng',
  'paid at the salon': 'trả tại tiệm',
  'Paid online ✓': 'Đã trả online ✓',
  'Powered by': 'Vận hành bởi',

  // ---- cart and services list -------------------------------------------
  'Remove': 'Bỏ',
  'Remove visit': 'Bỏ lượt hẹn này',
  'Close': 'Đóng',
  'This visit': 'Lượt này',
  'Your services': 'Dịch vụ của bạn',
  'No service yet': 'Chưa chọn dịch vụ',
  'Other services': 'Dịch vụ khác',
  'POPULAR': 'ĐƯỢC CHỌN NHIỀU',
  'Select': 'Chọn',
  '💵 Cash price · 💳 Card price (+{percent}%)': '💵 Giá tiền mặt · 💳 Giá thẻ (+{percent}%)',
  'Scan to keep booking': 'Quét mã để đặt tiếp',
  'on your phone': 'trên điện thoại',
  '＋ Add another visit (different day or time)': '＋ Thêm một lượt hẹn khác (ngày hoặc giờ khác)',
  'total for {label}': 'tổng cho {label}',
  '{n} service': '{n} dịch vụ',
  '{n} services': '{n} dịch vụ',
  'Doesn’t offer {what}': 'Không nhận {what}',
  'this service': 'dịch vụ này',
  'Works {hint}': 'Làm {hint}',

  // ---- confirm step ------------------------------------------------------
  'Review your details and complete your appointment.': 'Xem lại thông tin và hoàn tất lịch hẹn.',
  'APPOINTMENT': 'LỊCH HẸN',
  'SERVICES': 'DỊCH VỤ',
  'YOUR DETAILS': 'THÔNG TIN CỦA BẠN',
  'PAYMENT': 'THANH TOÁN',
  'Location': 'Địa điểm',
  'Date': 'Ngày',
  'Technician': 'Thợ',
  'e.g. (201) 555-0123': 'VD: 090 123 4567',
  'We’ll email your receipt 💌': 'Hoá đơn sẽ được gửi qua email 💌',
  'Enter your first name and phone number to confirm. Email is optional.': 'Nhập tên và số điện thoại để xác nhận. Email không bắt buộc.',
  'Pay online now': 'Trả online ngay',
  'Secure card payment. Your spot is held instantly.': 'Thanh toán thẻ an toàn. Chỗ của bạn được giữ ngay.',
  'Cash or card when you arrive.': 'Trả tiền mặt hoặc thẻ khi bạn đến tiệm.',
  'Pay deposit now · {amount}': 'Đặt cọc ngay · {amount}',
  '{n} min': '{n} phút',

  // ---- text-message consent ---------------------------------------------
  // STOP and HELP stay in English: they are the literal keywords a phone
  // network listens for, not words to be read.
  '📱 Appointment text updates': '📱 Tin nhắn về lịch hẹn',
  'Also send me special offers & promotions by text': 'Gửi thêm cho tôi khuyến mãi qua tin nhắn',
  '(optional)': '(không bắt buộc)',
  'the salon': 'tiệm',

  // ---- waitlist ----------------------------------------------------------
  'Please enter your name.': 'Vui lòng nhập họ tên.',
  'Please enter a valid phone or email so we can reach you.': 'Vui lòng nhập số điện thoại hoặc email hợp lệ để tiệm liên hệ.',
  'Can’t find a time? Join the waitlist →': 'Không có giờ phù hợp? Vào danh sách chờ →',
  '✓ You’re on the waitlist! We’ll reach out if a spot opens up.': '✓ Bạn đã vào danh sách chờ! Có chỗ trống tiệm sẽ báo ngay.',

  // ---- restaurant table reservation -------------------------------------
  // The occasion and seating names double as VALUES sent to the kitchen, so
  // they are translated for the eye only and travel in English.
  'Reserve a table': 'Đặt bàn',
  'Tmrw': 'Mai',
  'Closed on {day}. Please pick another date.': 'Đóng cửa vào {day}. Vui lòng chọn ngày khác.',
  'No tables for {n} guests on this date. Try another time or date.': 'Hết bàn cho {n} khách vào ngày này. Vui lòng thử giờ hoặc ngày khác.',
  'A {deposit} may apply to hold your table.': 'Có thể cần {deposit} để giữ bàn.',
  ' A {deposit} may be applied to hold your table.': ' Có thể cần {deposit} để giữ bàn.',
  'You can cancel or modify up to 2 hours in advance.': 'Bạn có thể huỷ hoặc đổi bàn trước 2 giờ.',
  'I agree to the cancellation policy and terms.': 'Tôi đồng ý với chính sách huỷ bàn và điều khoản.',
  'Menu': 'Thực đơn',
  '{n} dishes': '{n} món',
  'Reserve online': 'Đặt bàn online',
  'Reserve': 'Đặt bàn',
  'Your details': 'Thông tin của bạn',
  'Review & confirm': 'Xem lại & xác nhận',
  'Confirm reservation': 'Xác nhận đặt bàn',
  'Confirm Reservation': 'Xác nhận đặt bàn',
  'Reserving…': 'Đang đặt…',
  'Select a time': 'Chọn giờ',
  'Choose your party size, then a date and time that suits you.': 'Chọn số khách, rồi chọn ngày giờ phù hợp với bạn.',
  'Tell us who the table is for — and anything that makes the night special.': 'Cho tiệm biết bàn này dành cho ai — và điều gì làm buổi tối này đặc biệt.',
  'One last look before we hold your table.': 'Xem lại lần cuối trước khi nhà hàng giữ bàn cho bạn.',
  'Choose your table': 'Chọn bàn của bạn',
  'Pick a party size, date and time to hold your table.': 'Chọn số khách, ngày và giờ để giữ bàn.',
  'Party size': 'Số khách',
  '{n} guest': '{n} khách',
  '{n} guests': '{n} khách',
  'Select date': 'Chọn ngày',
  'Finding available times…': 'Đang tìm giờ còn trống…',
  'Few left': 'Sắp hết chỗ',
  'Table ready to hold': 'Còn bàn để giữ',
  'Pick a time': 'Chọn giờ',
  'Lunch': 'Bữa trưa',
  'Dinner': 'Bữa tối',
  'Seating preference': 'Vị trí ngồi mong muốn',
  'Seating': 'Vị trí ngồi',
  'No Preference': 'Sao cũng được',
  'Contact details': 'Thông tin liên hệ',
  'Contact': 'Liên hệ',
  'Special occasion': 'Dịp đặc biệt',
  'Occasion': 'Dịp',
  'Additional requests': 'Yêu cầu thêm',
  'Requests': 'Yêu cầu',
  'Full name *': 'Họ và tên *',
  'Phone number *': 'Số điện thoại *',
  'Add a note for the restaurant (optional)': 'Ghi chú thêm cho nhà hàng (không bắt buộc)',
  'Restaurant': 'Nhà hàng',
  'Cancellation policy': 'Chính sách huỷ bàn',
  'Your table is held for 15 minutes.': 'Bàn được giữ trong 15 phút.',
  'Please arrive on time — call the restaurant if you’re running late.': 'Vui lòng đến đúng giờ — nếu trễ, hãy gọi cho nhà hàng.',
  'Your table is reserved': 'Đã giữ bàn cho bạn',
  'Make another reservation': 'Đặt bàn lần nữa',
  'A confirmation text is on its way{name}.': 'Tin nhắn xác nhận đang được gửi tới bạn{name}.',
  'View menu': 'Xem thực đơn',
  'Menu coming soon.': 'Thực đơn sẽ có sớm.',
  'Loading…': 'Đang tải…',
  'Vegan': 'Món chay',
  'Veg': 'Chay',
  'GF': 'Không gluten',
  'Spicy': 'Món cay',
  'Other': 'Khác',
  'Reserve any time — 24/7 online, even when we’re closed.': 'Đặt bàn bất cứ lúc nào — online 24/7, kể cả khi nhà hàng đã đóng cửa.',
  'Instant confirmation by text the moment your table is held.': 'Có tin nhắn xác nhận ngay khi bàn được giữ.',
  'Your table is held for 15 minutes after your time.': 'Bàn được giữ thêm 15 phút sau giờ hẹn.',
  'Browse the menu before you arrive.': 'Xem thực đơn trước khi đến.',
  'No booking fees': 'Không mất phí đặt bàn',
  'Secure & private': 'An toàn & riêng tư',
  'Top-rated': 'Được đánh giá cao',
  'Please select a time.': 'Vui lòng chọn giờ.',
  'Please enter your name and phone.': 'Vui lòng nhập họ tên và số điện thoại.',
  'Online reservations are not available yet.': 'Nhà hàng chưa mở đặt bàn online.',
  'Reservation failed ({code})': 'Đặt bàn không thành công ({code})',
  '{percent}% deposit': 'Đặt cọc {percent}%',
  '{amount} deposit': 'Đặt cọc {amount}',
  'Anniversary': 'Kỷ niệm',
  'Date Night': 'Hẹn hò',
  'Business': 'Tiếp khách',
  'None': 'Không có',
  'High chair': 'Ghế em bé',
  'Booth': 'Bàn có vách',
  'Quiet area': 'Khu yên tĩnh',
  'Near window': 'Gần cửa sổ',
  'Wheelchair access': 'Lối đi xe lăn',

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
