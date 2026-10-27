/**
 * THE WORDS A BOOKING LINK'S PREVIEW USES — per trade, never "nail" by default.
 *
 * When an owner pastes their booking link into Facebook, Messenger, Zalo or a
 * text, the platform shows the page's <title> and description. Every shop
 * that was not a RESTAURANT showed "Book a Nail Appointment Online" — hair
 * salons, massage spas, clinics and cafés too. The API now says which trade a
 * shop is (api public/seo-trade.ts); this file turns it into the title, the
 * description's first sentence and the schema.org type. Vietnamese wording for
 * shops in Vietnam (VND), English elsewhere. Pure.
 */

export type SeoTrade =
  | 'NAIL' | 'HAIR' | 'LASH' | 'SPA' | 'MASSAGE' | 'DENTAL' | 'BEAUTY'
  | 'RESTAURANT' | 'CAFE' | 'BAKERY' | 'BUBBLE_TEA' | 'FAST_FOOD'
  | 'REAL_ESTATE' | 'SERVICE';

interface Words {
  /** Title after "{name} — ". */
  title: [en: string, vi: string];
  /** Description lead; {name} is replaced. */
  lead: [en: string, vi: string];
  /** The closing sentence of the description. */
  how: [en: string, vi: string];
  schema: string;
  /** Restaurants reserve tables; everyone else books appointments. */
  table: boolean;
}

const APPT_HOW: [string, string] = ['Fast, easy 24/7 online booking — pick your service, staff and time.', 'Đặt lịch online 24/7 nhanh gọn — chọn dịch vụ, nhân viên và giờ.'];
const TABLE_HOW: [string, string] = ['Fast, easy 24/7 online reservations — pick your party size, date and time.', 'Đặt bàn online 24/7 — chọn số khách, ngày và giờ.'];

const WORDS: Record<SeoTrade, Words> = {
  NAIL: { title: ['Book a Nail Appointment Online', 'Đặt lịch làm nail online'], lead: ['Book your nail appointment at {name} online', 'Đặt lịch làm nail tại {name} online'], how: ['Fast, easy 24/7 online booking — pick your service, technician and time.', 'Đặt lịch online 24/7 nhanh gọn — chọn dịch vụ, thợ và giờ.'], schema: 'NailSalon', table: false },
  HAIR: { title: ['Book a Hair Appointment Online', 'Đặt lịch làm tóc online'], lead: ['Book your hair appointment at {name} online', 'Đặt lịch làm tóc tại {name} online'], how: ['Fast, easy 24/7 online booking — pick your service, stylist and time.', 'Đặt lịch online 24/7 nhanh gọn — chọn dịch vụ, thợ và giờ.'], schema: 'HairSalon', table: false },
  LASH: { title: ['Book a Lash & Brow Appointment Online', 'Đặt lịch nối mi & chân mày online'], lead: ['Book your lash or brow appointment at {name} online', 'Đặt lịch nối mi, chân mày tại {name} online'], how: APPT_HOW, schema: 'BeautySalon', table: false },
  SPA: { title: ['Book a Spa Appointment Online', 'Đặt lịch spa online'], lead: ['Book your spa appointment at {name} online', 'Đặt lịch spa tại {name} online'], how: APPT_HOW, schema: 'DaySpa', table: false },
  MASSAGE: { title: ['Book a Massage Online', 'Đặt lịch massage online'], lead: ['Book your massage at {name} online', 'Đặt lịch massage tại {name} online'], how: ['Fast, easy 24/7 online booking — pick your treatment, therapist and time.', 'Đặt lịch online 24/7 nhanh gọn — chọn liệu trình, kỹ thuật viên và giờ.'], schema: 'HealthAndBeautyBusiness', table: false },
  BEAUTY: { title: ['Book an Appointment Online', 'Đặt lịch hẹn online'], lead: ['Book your appointment at {name} online', 'Đặt lịch hẹn tại {name} online'], how: APPT_HOW, schema: 'BeautySalon', table: false },
  DENTAL: { title: ['Book an Appointment Online', 'Đặt lịch khám online'], lead: ['Book your appointment at {name} online', 'Đặt lịch khám tại {name} online'], how: ['Fast, easy 24/7 online booking — pick your visit, provider and time.', 'Đặt lịch online 24/7 — chọn dịch vụ, bác sĩ và giờ.'], schema: 'Dentist', table: false },
  RESTAURANT: { title: ['Book a Table Online', 'Đặt bàn online'], lead: ['Reserve a table at {name} online', 'Đặt bàn tại {name} online'], how: TABLE_HOW, schema: 'Restaurant', table: true },
  CAFE: { title: ['Reserve a Table Online', 'Đặt bàn online'], lead: ['Reserve a table at {name} online', 'Đặt bàn tại {name} online'], how: TABLE_HOW, schema: 'CafeOrCoffeeShop', table: true },
  BAKERY: { title: ['Reserve Online', 'Đặt chỗ online'], lead: ['Reserve at {name} online', 'Đặt chỗ tại {name} online'], how: TABLE_HOW, schema: 'Bakery', table: true },
  BUBBLE_TEA: { title: ['Reserve Online', 'Đặt chỗ online'], lead: ['Reserve at {name} online', 'Đặt chỗ tại {name} online'], how: TABLE_HOW, schema: 'CafeOrCoffeeShop', table: true },
  FAST_FOOD: { title: ['Reserve Online', 'Đặt chỗ online'], lead: ['Reserve at {name} online', 'Đặt chỗ tại {name} online'], how: TABLE_HOW, schema: 'FastFoodRestaurant', table: true },
  REAL_ESTATE: { title: ['Book a Consultation Online', 'Đặt lịch tư vấn online'], lead: ['Book a consultation with {name} online', 'Đặt lịch tư vấn với {name} online'], how: ['Pick a date and time that suits you — 24/7.', 'Chọn ngày giờ phù hợp — 24/7.'], schema: 'RealEstateAgent', table: false },
  SERVICE: { title: ['Book an Appointment Online', 'Đặt lịch hẹn online'], lead: ['Book your appointment at {name} online', 'Đặt lịch hẹn tại {name} online'], how: APPT_HOW, schema: 'LocalBusiness', table: false },
};

/**
 * The trade to use: the API's answer, or — from an older API that sends none —
 * the business type alone. Without a trade a salon is "an appointment", not
 * a nail appointment.
 */
export function tradeOf(s: { trade?: string | null; businessType?: string | null }): SeoTrade {
  const t = String(s.trade ?? '').toUpperCase();
  if (t in WORDS) return t as SeoTrade;
  const b = String(s.businessType ?? '').toUpperCase();
  if (b === 'RESTAURANT') return 'RESTAURANT';
  if (b === 'REAL_ESTATE') return 'REAL_ESTATE';
  if (b === 'SERVICE') return 'SERVICE';
  return 'BEAUTY';
}

export interface SeoText { title: string; lead: string; how: string; schema: string; table: boolean; vi: boolean }

export function seoText(s: { name: string; trade?: string | null; businessType?: string | null; currency?: string | null }): SeoText {
  const w = WORDS[tradeOf(s)];
  const vi = String(s.currency ?? '').toUpperCase() === 'VND';
  const i = vi ? 1 : 0;
  return {
    title: `${s.name} — ${w.title[i]}`,
    lead: w.lead[i].replace('{name}', s.name),
    how: w.how[i],
    schema: w.schema,
    table: w.table,
    vi,
  };
}
