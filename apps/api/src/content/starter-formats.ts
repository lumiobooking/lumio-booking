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
