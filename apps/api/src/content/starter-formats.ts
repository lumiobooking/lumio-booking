/**
 * A working format library on day one.
 *
 * The generator is only allowed to pick formats from the library — that is the
 * whole point, it is where the agency's judgement lives. But an empty library
 * means the model must invent formats, which is exactly the generic output the
 * system exists to avoid. So a new install ships with the formats that reliably
 * work in this trade, and the Lumio team edits from there rather than facing a
 * blank page on their first Monday.
 *
 * These are starting points, not scripture. The `heat` values are a reasonable
 * opening bet; the team retunes them weekly from what they actually see, and
 * the feedback loop retunes them again from what actually got views.
 */

export interface StarterFormat {
  name: string;
  summary: string;
  hookGuide: string;
  shotList: string;
  lengthSec: number;
  audience: string;
  heat: 'hot' | 'steady' | 'cold';
  tags: string[];
}

export const NAIL_STARTER_FORMATS: StarterFormat[] = [
  {
    name: 'Before / after',
    summary: 'Móng hư, dài lởm chởm hoặc bong tróc → bộ móng hoàn chỉnh. Định dạng ăn khách nhất ngành làm đẹp, gần như không bao giờ nguội.',
    hookGuide: 'Ba giây đầu CHỈ quay bàn tay trước khi làm, không nói gì, để tiếng cắt giũa thật. Chữ trên màn hình nêu đúng vấn đề khách đang gặp.',
    shotList: 'Cận bàn tay trước khi làm · 2 lát cắt trong lúc làm · xoay tay dưới ánh đèn khi xong',
    lengthSec: 20,
    audience: 'Nữ 25-44, khách mới tìm tiệm',
    heat: 'hot',
    tags: ['transformation', 'fill', 'gel', 'dipping'],
  },
  {
    name: 'ASMR cận cảnh',
    summary: 'Quay sát 20cm, không nhạc, chỉ tiếng giũa, tiếng cọ, tiếng gel. Người xem giữ lại lâu vì dễ chịu, thuật toán thích thời lượng xem.',
    hookGuide: 'Vào thẳng âm thanh trong 1 giây đầu, không intro, không logo.',
    shotList: 'Một cảnh duy nhất, tay cầm chắc, ánh sáng chéo · không cắt cảnh',
    lengthSec: 10,
    audience: 'Nữ 18-34, xem giải trí',
    heat: 'hot',
    tags: ['asmr', 'satisfying', 'closeup'],
  },
  {
    name: 'Quy trình từng bước',
    summary: 'Cho khách thấy tiệm làm sạch, khử trùng, làm kỹ ra sao. Xây niềm tin — đặc biệt hiệu quả với khách lần đầu còn ngại vệ sinh.',
    hookGuide: 'Mở bằng câu hỏi khách hay lo: "Tiệm có khử trùng đồ không?" rồi trả lời bằng hình.',
    shotList: 'Mở gói dụng cụ đã tiệt trùng · các bước làm · thành phẩm',
    lengthSec: 25,
    audience: 'Khách mới, khách kỹ tính',
    heat: 'steady',
    tags: ['trust', 'hygiene', 'process'],
  },
  {
    name: 'Một ngày ở tiệm',
    summary: 'Nhịp làm việc thật: mở cửa, khách đầu, giờ cao điểm, dọn dẹp. Tạo cảm giác quen thuộc, khách thấy tiệm như người thật.',
    hookGuide: 'Bắt đầu từ khoảnh khắc lạ nhất trong ngày, không phải lúc mở cửa.',
    shotList: '5-6 lát cắt ngắn theo thứ tự thời gian · mỗi cảnh 2 giây',
    lengthSec: 30,
    audience: 'Khách quen, cộng đồng địa phương',
    heat: 'steady',
    tags: ['bts', 'community'],
  },
  {
    name: 'Bảng giá / combo',
    summary: 'Nêu rõ giá và combo đang có. Ít view hơn nhưng ra khách trực tiếp — khách hỏi giá qua tin nhắn nhiều thì bài này giải phóng thời gian.',
    hookGuide: 'Nói thẳng con số ngay câu đầu. Vòng vo giá là mất người xem.',
    shotList: 'Ảnh thành phẩm đẹp nhất · chữ giá rõ ràng trên hình',
    lengthSec: 15,
    audience: 'Khách đang cân nhắc chọn tiệm',
    heat: 'steady',
    tags: ['price', 'offer', 'combo'],
  },
  {
    name: 'POV khách hàng',
    summary: 'Quay từ góc nhìn khách đang ngồi ghế. Tạo cảm giác được chiều chuộng, hợp với dịch vụ cao cấp.',
    hookGuide: 'Góc máy đặt ngang tầm mắt khách, thấy tay thợ đang làm cho MÌNH.',
    shotList: 'Góc nhìn khách nhìn xuống tay · ly nước/ghế massage · thành phẩm giơ lên',
    lengthSec: 15,
    audience: 'Nữ 25-44, thích trải nghiệm',
    heat: 'steady',
    tags: ['pov', 'experience', 'luxury'],
  },
  {
    name: 'Giới thiệu thợ',
    summary: 'Một thợ, tên, sở trường, một bộ móng đẹp nhất của họ. Khách đặt theo thợ chứ không chỉ theo tiệm.',
    hookGuide: 'Mở bằng tác phẩm đẹp nhất trước, giới thiệu tên sau.',
    shotList: 'Cận tác phẩm · thợ đang làm · thợ nhìn máy vẫy tay',
    lengthSec: 20,
    audience: 'Khách quen, khách muốn chọn thợ',
    heat: 'steady',
    tags: ['team', 'staff', 'personal'],
  },
  {
    name: 'Mẹo giữ móng bền',
    summary: 'Chia sẻ cách giữ móng lâu, chống bong. Khách lưu lại và quay lại — bài dạng này sống rất lâu trên trang.',
    hookGuide: 'Nêu sai lầm phổ biến: "Đây là lý do móng bạn bong sau một tuần".',
    shotList: 'Cận móng bị bong · thao tác đúng · kết quả bền',
    lengthSec: 20,
    audience: 'Khách đã làm, giữ chân',
    heat: 'steady',
    tags: ['tips', 'aftercare', 'retention'],
  },
  {
    name: 'Bắt trend nhạc',
    summary: 'Dùng audio đang thịnh hành, ghép cảnh làm móng theo nhịp. Cách rẻ nhất để với tới người chưa biết tiệm.',
    hookGuide: 'Vào đúng đoạn drop của bài nhạc trong 2 giây đầu.',
    shotList: 'Cắt cảnh theo nhịp nhạc · 4-6 lát ngắn',
    lengthSec: 12,
    audience: 'Nữ 18-30, khách mới hoàn toàn',
    heat: 'hot',
    tags: ['trend', 'audio', 'reach'],
  },
  {
    name: 'Khách phản hồi',
    summary: 'Khách thật nói một câu thật về trải nghiệm. Sức thuyết phục cao nhất trong mọi định dạng, khó quay nhất.',
    hookGuide: 'Cắt vào giữa câu khách đang nói, bỏ phần chào hỏi.',
    shotList: 'Khách cầm tay mới làm nói 1 câu · cận móng · logo cuối',
    lengthSec: 15,
    audience: 'Khách đang phân vân chọn tiệm',
    heat: 'steady',
    tags: ['testimonial', 'social-proof'],
  },
];

/**
 * Starter libraries for the other trades.
 *
 * These exist because of a real failure: the format library shipped with nail
 * formats only, and the generator is told to pick FROM the library. A
 * restaurant or an estate agency therefore got an empty library, fell through
 * to "tự đề xuất định dạng phổ biến của ngành", and produced exactly the
 * generic output this whole system was built to avoid. An empty library is not
 * a neutral starting point — it is a silent instruction to improvise.
 *
 * Deliberately shorter than the nail set. These are opening positions from the
 * trade, and the Lumio team is expected to replace them with what it sees
 * working; pretending to ten well-tested formats for a trade we have not run
 * campaigns in would be false confidence dressed as a seed file.
 */
export const RESTAURANT_STARTER_FORMATS: StarterFormat[] = [
  {
    name: 'Một món, quay kỹ',
    summary: 'Một món duy nhất từ lúc ra bếp tới miếng đầu tiên. Ngắn, không lời thoại, chỉ tiếng thật.',
    hookGuide: 'Ba giây đầu là khoảnh khắc nóng nhất: hơi bốc lên, nước sốt chan xuống, dao cắt vào. Không quay mặt người, không quay biển hiệu.',
    shotList: 'Cận lúc ra bếp còn khói · rót/chan/cắt · miếng đầu tiên',
    lengthSec: 15,
    audience: 'Người đang đói và đang lướt điện thoại trong bán kính vài dặm',
    heat: 'hot',
    tags: ['food', 'signature', 'asmr'],
  },
  {
    name: 'Bếp lúc cao điểm',
    summary: 'Nhịp làm việc thật của bếp giờ đông. Cho thấy tay nghề và sự tấp nập cùng lúc.',
    hookGuide: 'Mở bằng cảnh chảo lửa hoặc nhiều đơn treo trên dây — thứ chứng minh quán đang đông mà không cần nói.',
    shotList: 'Toàn cảnh bếp · tay đầu bếp thao tác nhanh · món hoàn thiện đẩy ra',
    lengthSec: 25,
    audience: 'Khách chọn quán vì tin người nấu',
    heat: 'steady',
    tags: ['kitchen', 'behind-the-scenes'],
  },
  {
    name: 'Món đặc biệt hôm nay',
    summary: 'Lý do để khách quen quay lại tuần này thay vì tuần sau.',
    hookGuide: 'Nói thẳng tên món và giá trong ba giây đầu. Đây là bài thông báo, không phải bài nghệ thuật.',
    shotList: 'Món trên bàn · một câu về nguyên liệu · dòng chữ ghi giá và hạn',
    lengthSec: 15,
    audience: 'Khách quen đang nghĩ trưa nay ăn gì',
    heat: 'steady',
    tags: ['special', 'daily'],
  },
  {
    name: 'Khách thật, phản ứng thật',
    summary: 'Bàn đông và một câu nhận xét ngắn của khách. Bằng chứng xã hội mạnh hơn mọi lời tự khen.',
    hookGuide: 'Mở bằng tiếng ồn của quán đông — âm thanh làm việc đó nhanh hơn hình.',
    shotList: 'Toàn cảnh bàn đông · khách gắp miếng đầu · một câu nhận xét',
    lengthSec: 20,
    audience: 'Người lạ đang phân vân giữa quán này và quán bên cạnh',
    heat: 'steady',
    tags: ['social-proof', 'ugc'],
  },
];

export const REAL_ESTATE_STARTER_FORMATS: StarterFormat[] = [
  {
    name: 'Tour nhà quay dọc',
    summary: 'Đi một vòng căn nhà, quay dọc, không cắt vụn. Dạng được xem hết nhiều nhất ngành này.',
    hookGuide: 'Ba giây đầu là điểm mạnh nhất của căn nhà, không phải cửa ra vào. Kèm giá và số phòng ngay trên màn hình.',
    shotList: 'Điểm đặc biệt nhất · bếp · phòng ngủ chính · sân sau · một câu chốt về khu vực',
    lengthSec: 45,
    audience: 'Người đang tìm nhà trong vùng',
    heat: 'hot',
    tags: ['tour', 'listing'],
  },
  {
    name: 'Trả lời một câu hỏi thật',
    summary: 'Một câu khách vừa hỏi hôm nay, trả lời thẳng trong 30 giây.',
    hookGuide: 'Mở bằng chính câu hỏi đó, nguyên văn. Người đang tìm câu trả lời sẽ dừng lại ở đúng câu chữ của họ.',
    shotList: 'Nói thẳng vào máy · một con số cụ thể hiện trên màn hình · bước tiếp theo cần làm',
    lengthSec: 30,
    audience: 'Người mua lần đầu, đang tìm hiểu trước khi tìm môi giới',
    heat: 'steady',
    tags: ['faq', 'authority'],
  },
  {
    name: 'Giới thiệu khu vực',
    summary: 'Khu này sống ra sao: trường, quán, đường đi làm. Người mua chọn khu trước, chọn nhà sau.',
    hookGuide: 'Mở bằng tên khu và một con số thật — giá trung bình, hoặc thời gian tới trung tâm.',
    shotList: 'Đường phố · một địa điểm quen thuộc · một câu về giá trung bình khu',
    lengthSec: 35,
    audience: 'Người đang cân nhắc chuyển tới khu này',
    heat: 'steady',
    tags: ['neighbourhood', 'local'],
  },
  {
    name: 'Vừa bán xong',
    summary: 'Căn vừa chốt, bao lâu thì bán được, và vì sao. Bằng chứng năng lực, không phải khoe.',
    hookGuide: 'Mở bằng số ngày trên thị trường. Con số làm việc thuyết phục nhanh hơn lời nói.',
    shotList: 'Biển đã bán · một cảnh trong nhà · một câu về điều đã làm nên khác biệt',
    lengthSec: 25,
    audience: 'Chủ nhà đang cân nhắc bán',
    heat: 'steady',
    tags: ['proof', 'seller-lead'],
  },
];

export const SERVICE_STARTER_FORMATS: StarterFormat[] = [
  {
    name: 'Trước và sau một ca thật',
    summary: 'Hiện trạng, vài giây làm việc, kết quả. Bằng chứng cụ thể thay cho lời quảng cáo.',
    hookGuide: 'Ba giây đầu là hiện trạng tệ nhất, không che giấu. Đó là thứ giữ người xem lại.',
    shotList: 'Hiện trạng · thao tác chính · kết quả cuối',
    lengthSec: 20,
    audience: 'Người đang có đúng vấn đề đó trong nhà',
    heat: 'hot',
    tags: ['transformation', 'proof'],
  },
  {
    name: 'Giải thích một thắc mắc thường gặp',
    summary: 'Câu khách hay hỏi nhất, trả lời trong 30 giây, không vòng vo.',
    hookGuide: 'Mở bằng chính câu hỏi. Người đang tìm câu trả lời dừng lại ở câu chữ của họ.',
    shotList: 'Nói thẳng vào máy · minh hoạ bằng đồ nghề thật · bước tiếp theo',
    lengthSec: 30,
    audience: 'Người đang tìm hiểu trước khi gọi thợ',
    heat: 'steady',
    tags: ['faq', 'trust'],
  },
  {
    name: 'Người làm và cách làm',
    summary: 'Ai sẽ tới nhà mình. Tạo niềm tin vào người, không chỉ vào dịch vụ.',
    hookGuide: 'Mở bằng tay đang làm việc, không phải bằng lời chào.',
    shotList: 'Chuẩn bị đồ nghề · thao tác chính · một câu nhắn ngắn',
    lengthSec: 25,
    audience: 'Khách hộ gia đình, cân nhắc cho người lạ vào nhà',
    heat: 'steady',
    tags: ['trust', 'team'],
  },
];

/** Every seeded library, by industry — the map seedFormats reads. */
export const STARTER_FORMATS: Record<string, StarterFormat[]> = {
  SALON: NAIL_STARTER_FORMATS,
  RESTAURANT: RESTAURANT_STARTER_FORMATS,
  REAL_ESTATE: REAL_ESTATE_STARTER_FORMATS,
  SERVICE: SERVICE_STARTER_FORMATS,
};
