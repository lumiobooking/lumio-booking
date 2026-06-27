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
