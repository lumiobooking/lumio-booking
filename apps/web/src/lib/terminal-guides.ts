/**
 * HOW TO CONNECT YOUR CARD MACHINE — the steps a salon follows by itself.
 *
 * The salon tells us the brand and model on the machine; this answers at
 * once, before anybody at Lumio reads the request. Two kinds of answer:
 *
 *   driven  — Lumio sends the amount to this machine (Payment terminals →
 *             connect the account → add the machine by its code).
 *   manual  — Lumio does not drive it yet: ring the sale on the machine as
 *             usual and record it in Lumio as CARD, so revenue, tips and
 *             payroll stay right. (Clover can still take ONLINE deposits.)
 *
 * Mirrors api payments-hub/terminal-requests.ts brandKeyOf. Pure.
 */
export type TerminalBrand = 'square' | 'stripe' | 'helcim' | 'dejavoo' | 'sumup' | 'adyen' | 'clover' | 'godaddy' | 'pax' | 'verifone' | 'ingenico' | 'other';

export const BRAND_CHOICES: { key: TerminalBrand; name: string }[] = [
  { key: 'square', name: 'Square' }, { key: 'stripe', name: 'Stripe (WisePOS E, S700)' }, { key: 'helcim', name: 'Helcim' },
  { key: 'dejavoo', name: 'Dejavoo / iPOSpays' }, { key: 'clover', name: 'Clover' }, { key: 'godaddy', name: 'GoDaddy / Poynt' },
  { key: 'pax', name: 'PAX' }, { key: 'verifone', name: 'Verifone' }, { key: 'ingenico', name: 'Ingenico' },
  { key: 'sumup', name: 'SumUp' }, { key: 'adyen', name: 'Adyen' }, { key: 'other', name: 'Khác / Other' },
];

export function brandKeyOf(brand: string, model = ''): TerminalBrand {
  const s = `${brand} ${model}`.toLowerCase();
  if (/square/.test(s)) return 'square';
  if (/stripe|bbpos|wisepos/.test(s)) return 'stripe';
  if (/helcim/.test(s)) return 'helcim';
  if (/dejavoo|ipospays|\bz11\b|\bqd\d|\bp1\b|\bp3\b|\bp5\b/.test(s)) return 'dejavoo';
  if (/sumup|solo/.test(s)) return 'sumup';
  if (/adyen/.test(s)) return 'adyen';
  if (/clover/.test(s)) return 'clover';
  if (/godaddy|go daddy|poynt/.test(s)) return 'godaddy';
  if (/\bpax\b|a920|a80|s300/.test(s)) return 'pax';
  if (/verifone|vx\d|v400|engage/.test(s)) return 'verifone';
  if (/ingenico|desk\/|move\/|lane\//.test(s)) return 'ingenico';
  return 'other';
}

export interface Guide { driven: boolean; title: string; steps: string[]; note?: string }

const MANUAL_VI = [
  'Bán trên máy quẹt thẻ của tiệm như bình thường.',
  'Trong Lumio, ở bước Thanh toán chọn "Thẻ" và nhập đúng số tiền (kể cả tip) — doanh thu, tip và lương thợ vẫn tính đúng.',
  'Lumio đã nhận yêu cầu của tiệm và sẽ báo khi máy này nối thẳng được (máy tự nhận số tiền).',
];
const MANUAL_EN = [
  'Ring the sale on your own card machine as usual.',
  'In Lumio, pick "Card" at checkout and enter the same amount (tip included) — revenue, tips and payroll stay right.',
  'Lumio has your request and will tell you when this machine can be driven directly (the amount sent to it).',
];

export function guideFor(key: TerminalBrand, vi: boolean): Guide {
  const T = (v: string, e: string) => (vi ? v : e);
  switch (key) {
    case 'square':
      return {
        driven: true, title: T('Square Terminal — Lumio gửi số tiền thẳng vào máy', 'Square Terminal — Lumio sends the amount to it'),
        steps: vi ? [
          'Vào developer.squareup.com bằng tài khoản Square CỦA TIỆM → Create application.',
          'Mở app vừa tạo → Production → copy Access Token và Location ID (mục Locations).',
          'Lumio → Máy quẹt thẻ → chọn "Square Terminal" → dán Access Token + Location ID → Kết nối.',
          'Bấm "Thêm máy quẹt" → Lumio hiện mã ghép (device code). Trên máy Square Terminal: Sign in → Use a device code → nhập mã.',
          'Chạy "giao dịch thử" 1$ để kiểm tra. Cũng từ tài khoản này, Lumio thu được tiền cọc online của khách.',
        ] : [
          'Go to developer.squareup.com with the SALON\'S Square account → Create application.',
          'Open it → Production → copy the Access Token and the Location ID (Locations).',
          'Lumio → Card terminals → "Square Terminal" → paste the token + Location ID → Connect.',
          'Click "Add reader" → Lumio shows a device code. On the Square Terminal: Sign in → Use a device code → enter it.',
          'Run a $1 test charge. The same account also takes customers\' online deposits.',
        ],
      };
    case 'stripe':
      return {
        driven: true, title: T('Stripe Terminal (WisePOS E / S700)', 'Stripe Terminal (WisePOS E / S700)'),
        steps: vi ? [
          'Stripe Dashboard → Developers → API keys → Create restricted key: cấp quyền Terminal, PaymentIntents, Checkout Sessions, Refunds (Write).',
          'Terminal → Locations → tạo địa điểm, copy Location ID (tml_…).',
          'Lumio → Máy quẹt thẻ → "Stripe Terminal" → dán key + Location ID → Kết nối.',
          'Trên máy: vuốt từ trái → Settings → Generate pairing code. Trong Lumio, ở khung Stripe đã kết nối → mục "Máy quẹt (reader)" → nhập mã ghép → bấm "Thêm máy quẹt".',
          'Chạy giao dịch thử. Key này cũng dùng để thu cọc online (Stripe Checkout).',
        ] : [
          'Stripe Dashboard → Developers → API keys → Create restricted key with Terminal, PaymentIntents, Checkout Sessions and Refunds (Write).',
          'Terminal → Locations → create one, copy the Location ID (tml_…).',
          'Lumio → Card terminals → "Stripe Terminal" → paste the key + Location ID → Connect.',
          'On the reader: swipe from the left → Settings → Generate pairing code. In Lumio, in the connected Stripe box → "Card readers" → enter the pairing code → "Add card reader".',
          'Run a test charge. The same key also takes online deposits (Stripe Checkout).',
        ],
      };
    case 'helcim':
      return {
        driven: true, title: T('Helcim Smart Terminal', 'Helcim Smart Terminal'),
        steps: vi ? [
          'Helcim Dashboard → Settings → Integrations → API Access → tạo API token (bật Payments + Payments Hardware).',
          'Lumio → Máy quẹt thẻ → "Helcim" → dán token → Kết nối.',
          'Trên Smart Terminal xem mã thiết bị (device code) → Lumio → "Thêm máy quẹt" → nhập mã.',
          'Chạy giao dịch thử. Cùng tài khoản này thu được cọc online.',
        ] : [
          'Helcim Dashboard → Settings → Integrations → API Access → create a token (Payments + Payments Hardware).',
          'Lumio → Card terminals → "Helcim" → paste it → Connect.',
          'Read the device code on the Smart Terminal → Lumio → "Add reader" → enter it.',
          'Run a test charge. The same account takes online deposits too.',
        ],
      };
    case 'dejavoo':
      return {
        driven: true, title: T('Dejavoo / iPOSpays (P1, P3, QD…)', 'Dejavoo / iPOSpays (P1, P3, QD…)'),
        steps: vi ? [
          'Gọi ISO/đơn vị cấp máy, nhờ bật chế độ SPIn (semi-integrated) cho máy.',
          'Cổng iPOSpays của tiệm → Settings → Generate Ecom/TOP Merchant Keys → chọn TPN → Generate Token.',
          'Lumio → Máy quẹt thẻ → "Dejavoo / iPOSpays" → nhập TPN (in trên máy hoặc trong iPOSpays) + token → Kết nối.',
          'Chạy giao dịch thử: máy tự hiện số tiền.',
        ] : [
          'Ask your ISO / provider to switch the terminal to SPIn (semi-integrated) mode.',
          'Your iPOSpays portal → Settings → Generate Ecom/TOP Merchant Keys → pick the TPN → Generate Token.',
          'Lumio → Card terminals → "Dejavoo / iPOSpays" → enter the TPN + token → Connect.',
          'Run a test charge: the amount appears on the terminal.',
        ],
      };
    case 'sumup':
      return {
        driven: true, title: 'SumUp Solo',
        steps: vi
          ? ['SumUp Dashboard → Developers → tạo API key.', 'Lumio → Máy quẹt thẻ → "SumUp" → dán key → Kết nối.', 'Trên Solo lấy pairing code → Lumio → "Thêm máy quẹt".']
          : ['SumUp Dashboard → Developers → create an API key.', 'Lumio → Card terminals → "SumUp" → paste it → Connect.', 'Get the pairing code on the Solo → Lumio → "Add reader".'],
      };
    case 'adyen':
      return {
        driven: true, title: 'Adyen',
        steps: vi
          ? ['Adyen Customer Area → Developers → API credentials → API key có quyền "Cloud Device API".', 'Lumio → Máy quẹt thẻ → "Adyen" → nhập key + merchant account + môi trường.', 'Thêm từng máy bằng POI / device id in trên máy.']
          : ['Adyen Customer Area → Developers → API credentials → a key with the "Cloud Device API" role.', 'Lumio → Card terminals → "Adyen" → key + merchant account + environment.', 'Add each terminal by the POI / device id printed on it.'],
      };
    case 'clover':
      return {
        driven: false, title: T('Clover — thu cọc online được ngay; máy tại quầy ghi nhận tay', 'Clover — online deposits now; the counter device is recorded by hand'),
        steps: vi ? [
          'Thu cọc online qua Clover: Clover Dashboard → Account & Setup → Ecommerce API Tokens → tạo token loại Hosted Checkout (Private). Merchant ID xem ở Account & Setup → Merchants.',
          'Clover Dashboard → Settings → Ecommerce → Hosted Checkout → Webhook: dán địa chỉ webhook Lumio hiện ở ô Clover (trang Máy quẹt thẻ) → Generate signing secret → copy.',
          'Lumio → Máy quẹt thẻ → "Clover (cọc online)" → nhập Merchant ID + token + signing secret → Kết nối.',
          ...MANUAL_VI,
        ] : [
          'Online deposits with Clover: Clover Dashboard → Account & Setup → Ecommerce API Tokens → create a Hosted Checkout (private) token. The Merchant ID is under Account & Setup → Merchants.',
          'Clover Dashboard → Settings → Ecommerce → Hosted Checkout → Webhook: paste the Lumio webhook address shown in the Clover box (Card terminals page) → Generate signing secret → copy it.',
          'Lumio → Card terminals → "Clover (online deposits)" → Merchant ID + token + signing secret → Connect.',
          ...MANUAL_EN,
        ],
      };
    case 'godaddy':
      return { driven: false, title: T('GoDaddy / Poynt — ghi nhận tay', 'GoDaddy / Poynt — recorded by hand'), steps: vi ? MANUAL_VI : MANUAL_EN };
    case 'pax':
    case 'verifone':
    case 'ingenico':
      return {
        driven: false, title: T('Máy của tiệm chạy qua đơn vị xử lý thẻ (ISO)', 'Your machine runs through a card processor (ISO)'),
        steps: vi ? [
          'Xem trên màn hình máy / hoá đơn tên đơn vị xử lý. Nếu là iPOSpays / Dejavoo (SPIn): kết nối như Dejavoo — Lumio gửi số tiền thẳng vào máy.',
          ...MANUAL_VI,
        ] : [
          'Check the processor name on the screen or a receipt. If it is iPOSpays / Dejavoo (SPIn): connect it as Dejavoo — Lumio sends the amount to it.',
          ...MANUAL_EN,
        ],
      };
    default:
      return { driven: false, title: T('Lumio sẽ xem máy của tiệm', 'Lumio will look at your machine'), steps: vi ? MANUAL_VI : MANUAL_EN };
  }
}
