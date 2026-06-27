'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Lang = 'en' | 'vi';
const KEY = 'lumio_lang';

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} });

/** App-wide language provider (persists choice in localStorage). Mounted once in
 * the root layout so the Salon Admin UI + pages can switch EN/VI reactively. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v === 'vi' || v === 'en') setLangState(v); } catch { /* ignore */ }
  }, []);
  const setLang = (l: Lang) => {
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
    setLangState(l);
  };
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLang() { return useContext(Ctx); }

/**
 * Shared dictionary for the Salon Admin UI. Add keys as pages are translated.
 * Customer-facing booking pages stay English (US/Canada customers).
 */
const DICT: Record<string, { en: string; vi: string }> = {
  // sidebar nav
  'nav.dashboard': { en: 'Dashboard', vi: 'Tổng quan' },
  'nav.pos': { en: 'POS / Checkout', vi: 'Bán hàng / Thu ngân' },
  'nav.orders': { en: 'Orders', vi: 'Đơn hàng' },
  'nav.calendar': { en: 'Calendar', vi: 'Lịch hẹn' },
  'nav.bookings': { en: 'Bookings', vi: 'Đặt lịch' },
  'nav.walkins': { en: 'Walk-ins · Turns', vi: 'Khách vãng lai · Lượt' },
  'nav.waitlist': { en: 'Waitlist', vi: 'Danh sách chờ' },
  'nav.customers': { en: 'Customers', vi: 'Khách hàng' },
  'nav.services': { en: 'Services', vi: 'Dịch vụ' },
  'nav.products': { en: 'Products', vi: 'Sản phẩm' },
  'nav.staff': { en: 'Staff', vi: 'Nhân viên' },
  'nav.payroll': { en: 'Lương thợ · Payroll', vi: 'Lương thợ' },
  'nav.reviews': { en: 'Reviews & rewards', vi: 'Đánh giá & thưởng' },
  'nav.report': { en: 'Sales report', vi: 'Báo cáo doanh thu' },
  'nav.payments': { en: 'Payments', vi: 'Thanh toán' },
  'nav.notifications': { en: 'Notifications', vi: 'Thông báo' },
  'nav.integrations': { en: 'Integrations', vi: 'Tích hợp' },
  'nav.billing': { en: 'Billing & plan', vi: 'Gói & thanh toán' },
  'nav.settings': { en: 'Settings', vi: 'Cài đặt' },
  // shell common
  'shell.subtitle': { en: 'Salon dashboard', vi: 'Quản lý tiệm' },
  'shell.myAccount': { en: 'My account', vi: 'Tài khoản của tôi' },
  'shell.logout': { en: 'Log out', vi: 'Đăng xuất' },
  'shell.installApp': { en: 'Install app', vi: 'Cài ứng dụng' },
  // Walk-ins & turns
  'wi.title': { en: 'Walk-ins & Turns', vi: 'Khách vãng lai & Lượt' },
  'wi.subtitle': { en: 'Add a walk-in; the system suggests the tech who is up next (fewest turns, available) — no more fights over turns.', vi: 'Thêm khách vãng lai, hệ thống tự gợi ý thợ tới lượt (ít lượt nhất, đang rảnh) — hết cảnh giành lượt.' },
  'wi.customer': { en: 'Customer (optional)', vi: 'Khách (tuỳ chọn)' },
  'wi.namePh': { en: 'Name / Walk-in', vi: 'Tên / Walk-in' },
  'wi.phone': { en: 'Phone (optional)', vi: 'SĐT (tuỳ chọn)' },
  'wi.service': { en: 'Service (optional)', vi: 'Dịch vụ (tuỳ chọn)' },
  'wi.partySize': { en: 'Party size', vi: 'Số người' },
  'wi.addQueue': { en: '+ Add to queue', vi: '+ Thêm vào hàng đợi' },
  'wi.turnsToday': { en: "Each tech's turns today", vi: 'Lượt hôm nay của từng thợ' },
  'wi.noStaff': { en: 'No technicians yet. Add them in the Staff page.', vi: 'Chưa có thợ. Thêm thợ ở mục Staff.' },
  'wi.nextUp': { en: '● UP NEXT', vi: '● TỚI LƯỢT' },
  'wi.serving': { en: '○ Serving', vi: '○ Đang làm' },
  'wi.free': { en: 'Available', vi: 'Rảnh' },
  'wi.turns': { en: 'turns', vi: 'lượt' },
  'wi.waiting': { en: 'Waiting', vi: 'Đang chờ' },
  'wi.noWaiting': { en: 'No one waiting.', vi: 'Không có khách chờ.' },
  'wi.noService': { en: 'No service picked', vi: 'Chưa chọn dịch vụ' },
  'wi.pickStaff': { en: 'Pick a tech…', vi: 'Chọn thợ…' },
  'wi.people': { en: 'people', vi: 'người' },
  'wi.assign': { en: 'Assign', vi: 'Giao' },
  'wi.cancel': { en: 'Cancel', vi: 'Huỷ' },
  'wi.inService': { en: 'In service', vi: 'Đang làm' },
  'wi.noInService': { en: 'No one in service yet.', vi: 'Chưa có ai đang làm.' },
  'wi.tech': { en: 'tech', vi: 'thợ' },
  'wi.done': { en: 'Done', vi: 'Xong' },
  'wi.busy': { en: 'busy', vi: 'bận' },
  'wi.upnext': { en: 'up next', vi: 'tới lượt' },
  'wi.waited': { en: 'waited', vi: 'chờ' },
  // Payroll
  'pr.title': { en: 'Technician Payroll', vi: 'Bảng lương thợ · Payroll' },
  'pr.subtitle': { en: "Each tech's pay = commission (rate set in Staff) + tips, for the selected period.", vi: 'Lương phải trả mỗi thợ = hoa hồng (theo % cài ở Staff) + tip, trong kỳ đã chọn.' },
  'pr.print': { en: 'Print', vi: 'In' },
  'pr.kTotal': { en: 'TOTAL TO PAY', vi: 'TỔNG LƯƠNG PHẢI TRẢ' },
  'pr.kCommission': { en: 'Total commission', vi: 'Tổng hoa hồng' },
  'pr.kTips': { en: 'Total tips', vi: 'Tổng tip' },
  'pr.kRevenue': { en: 'Revenue (paid)', vi: 'Doanh thu (đã trả)' },
  'pr.cTech': { en: 'Technician', vi: 'Thợ' },
  'pr.cCount': { en: '# Svc', vi: 'Số DV' },
  'pr.cRevenue': { en: 'Service revenue', vi: 'Doanh thu DV' },
  'pr.cCommission': { en: 'Commission', vi: 'Hoa hồng' },
  'pr.cTips': { en: 'Tips', vi: 'Tip' },
  'pr.cTotal': { en: 'TOTAL PAY', vi: 'TỔNG LƯƠNG' },
  'pr.empty': { en: 'No transactions in this period (pay is from paid POS orders).', vi: 'Chưa có giao dịch trong kỳ này (lương tính từ đơn POS đã thanh toán).' },
  'pr.note': { en: "Commission = service revenue × each tech's %, set in Staff → Edit. Tips come from the tip entered at POS checkout. Total pay = commission + tips.", vi: 'Hoa hồng = doanh thu dịch vụ × % của từng thợ (cài ở Staff → Edit → Commission %). Tip lấy từ ô tip lúc thanh toán POS. Tổng lương = hoa hồng + tip.' },
};

/** Translate a key for the given language; falls back to the key itself. */
export function tr(key: string, lang: Lang): string {
  const e = DICT[key];
  return e ? e[lang] : key;
}

/** Map a sidebar nav href to its translation key. */
export const NAV_KEY: Record<string, string> = {
  '/salon': 'nav.dashboard',
  '/salon/pos': 'nav.pos',
  '/salon/orders': 'nav.orders',
  '/salon/calendar': 'nav.calendar',
  '/salon/bookings': 'nav.bookings',
  '/salon/walkins': 'nav.walkins',
  '/salon/waitlist': 'nav.waitlist',
  '/salon/customers': 'nav.customers',
  '/salon/services': 'nav.services',
  '/salon/products': 'nav.products',
  '/salon/staff': 'nav.staff',
  '/salon/payroll': 'nav.payroll',
  '/salon/reviews': 'nav.reviews',
  '/salon/pos/report': 'nav.report',
  '/salon/payments': 'nav.payments',
  '/salon/notifications': 'nav.notifications',
  '/salon/integrations': 'nav.integrations',
  '/salon/billing': 'nav.billing',
  '/salon/settings': 'nav.settings',
};
