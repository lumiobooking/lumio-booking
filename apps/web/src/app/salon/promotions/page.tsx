'use client';
/**
 * Giảm giá & phụ thu (10/11/2026, Nẩu Chill): event / grand-opening discounts
 * and holiday surcharges by date, in their own menu entry next to gift cards.
 * The rules live in the restaurant's settings (api restaurant/check-logic
 * priceRules) and apply by themselves on the guest check, the till and the
 * receipt. A one-off discount for one bill is typed at payment.
 */
import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { PriceRulesEditor } from '../../../components/RestaurantTill';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { ui } from '../../../lib/ui';
import type { PriceRule } from '../../../lib/restaurant-till';

type Settings = Record<string, unknown> & { priceRules?: PriceRule[] };

export default function PromotionsPage() {
  return (
    <SalonShell>
      <Promotions />
    </SalonShell>
  );
}

function Promotions() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const s = await apiFetch<Settings>('/restaurant/settings', { token });
      setSettings(s); setRules(s.priceRules ?? []); setDirty(false);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : L('Không tải được', 'Could not load') }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!token || !settings) return;
    setBusy(true); setMsg(null);
    try {
      // Every other restaurant setting is sent back as it was read.
      const saved = await apiFetch<Settings>('/restaurant/settings', { method: 'PATCH', token, body: { settings: { ...settings, priceRules: rules } } });
      setSettings(saved); setRules(saved.priceRules ?? []); setDirty(false);
      const dropped = rules.length - (saved.priceRules ?? []).length;
      setMsg({ ok: dropped === 0, text: dropped === 0 ? L('Đã lưu.', 'Saved.') : L(`Đã lưu. ${dropped} mục thiếu tên hoặc % không hợp lệ nên bị bỏ.`, `Saved. ${dropped} rule(s) without a name or with an invalid % were dropped.`) });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : L('Không lưu được', 'Could not save') }); }
    finally { setBusy(false); }
  }

  const sel: React.CSSProperties = { minHeight: 40, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', padding: '0 8px', fontFamily: 'inherit' };

  return (
    <section style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{L('Giảm giá & phụ thu', 'Discounts & surcharges')}</h1>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 14, marginTop: 0 }}>
        {L('Giảm giá khai trương, sự kiện, và phụ thu ngày lễ (Tết, 30/4…) theo ngày. Tự áp dụng trên tạm tính, màn thu ngân và hoá đơn. Giảm thêm cho một bill: nhập ở màn Thanh toán.',
          'Grand-opening and event discounts, and holiday surcharges, by date. Applied by themselves on the guest check, the till and the receipt. An extra discount for one bill: type it at payment.')}
      </p>
      {!settings && !msg && <p style={{ color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</p>}
      {settings && (
        <div style={{ ...ui.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PriceRulesEditor vi={vi} rules={rules} onChange={(r) => { setRules(r); setDirty(true); }} sel={sel} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <button type="button" onClick={() => void save()} disabled={busy || !dirty} style={{ ...ui.primaryBtn, opacity: busy || !dirty ? 0.6 : 1 }}>
              {busy ? L('Đang lưu…', 'Saving…') : L('Lưu', 'Save')}
            </button>
            {dirty && <span style={{ fontSize: 12.5, color: 'var(--ink-warn)' }}>{L('Chưa lưu', 'Not saved yet')}</span>}
          </div>
        </div>
      )}
      {msg && <div style={{ marginTop: 10, fontSize: 13.5, color: msg.ok ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{msg.text}</div>}
    </section>
  );
}
