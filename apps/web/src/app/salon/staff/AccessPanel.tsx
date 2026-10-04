'use client';

/**
 * WHO MAY DO WHAT — the staff member's login and the screens they can open.
 *
 * The owner used to pick a role from three buttons with no idea what each one
 * allowed, could not change a login's email after creating it, and could not
 * give one receptionist a little more than another. This panel says it plainly:
 * the login (email, on/off, password), the role, and the exact list of screens,
 * which starts from the role and can be adjusted per person. The same list is
 * what the server enforces — it is read from /staff/access-catalog.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

export type Role = 'MANAGER' | 'RECEPTIONIST' | 'TECHNICIAN';
type Cap = string;

/** Fallback when the catalogue cannot be read — mirrors api/src/auth/capabilities.ts. */
const FALLBACK_PRESETS: Record<Role, Cap[]> = {
  MANAGER: ['dashboard', 'pos', 'orders', 'calendar', 'bookings', 'walkins', 'waitlist', 'customers', 'services', 'products', 'staff', 'payroll', 'reviews', 'marketing', 'inventory', 'reports', 'payments', 'notifications', 'pos.discount', 'pos.void', 'bookings.delete', 'customers.delete'],
  RECEPTIONIST: ['pos', 'orders', 'calendar', 'bookings', 'walkins', 'waitlist', 'customers', 'pos.discount'],
  TECHNICIAN: [],
};

/** The screens, grouped the way an owner thinks about them. */
export const ACCESS_GROUPS: { id: string; vi: string; en: string; items: { cap: Cap; vi: string; en: string; hintVi: string; hintEn: string }[] }[] = [
  {
    id: 'desk', vi: 'Quầy lễ tân', en: 'Front desk',
    items: [
      { cap: 'calendar', vi: 'Lịch hẹn', en: 'Calendar', hintVi: 'Xem, đặt, dời lịch', hintEn: 'See, book and move appointments' },
      { cap: 'bookings', vi: 'Danh sách đặt lịch', en: 'Bookings', hintVi: 'Xác nhận, check-in, huỷ', hintEn: 'Confirm, check in, cancel' },
      { cap: 'walkins', vi: 'Walk-in & xoay tua', en: 'Walk-ins & turns', hintVi: 'Nhận khách, giao thợ', hintEn: 'Take walk-ins, hand to techs' },
      { cap: 'waitlist', vi: 'Danh sách chờ', en: 'Waitlist', hintVi: '', hintEn: '' },
      { cap: 'customers', vi: 'Khách hàng', en: 'Customers', hintVi: 'Hồ sơ, lịch sử, ghi chú', hintEn: 'Profiles, history, notes' },
      { cap: 'pos', vi: 'Tính tiền & thẻ quà tặng', en: 'Checkout & gift cards', hintVi: 'Thu tiền, tip, thẻ quà', hintEn: 'Take payment, tips, gift cards' },
      { cap: 'orders', vi: 'Hoá đơn', en: 'Orders', hintVi: 'Xem, in lại hoá đơn', hintEn: 'View and reprint receipts' },
    ],
  },
  {
    // Not screens but actions at the counter — the ones an owner wants to
    // decide person by person.
    id: 'actions', vi: 'Thao tác nhạy cảm tại quầy', en: 'Sensitive counter actions',
    items: [
      { cap: 'pos.discount', vi: 'Giảm giá tay khi tính tiền', en: 'Type a discount at checkout', hintVi: 'Mã khuyến mãi, điểm thưởng vẫn dùng được', hintEn: 'Promo codes and points still work' },
      { cap: 'pos.void', vi: 'Huỷ / xoá hoá đơn đã thu', en: 'Void or delete a paid ticket', hintVi: 'Trả tiền lại cho khách', hintEn: 'Moves money back' },
      { cap: 'bookings.delete', vi: 'Xoá hẳn lịch hẹn', en: 'Delete a booking for good', hintVi: 'Huỷ lịch thì luôn được', hintEn: 'Cancelling is always allowed' },
      { cap: 'customers.delete', vi: 'Xoá khách hàng', en: 'Delete a client', hintVi: 'Mất cả lịch sử của khách', hintEn: 'Erases their history' },
    ],
  },
  {
    id: 'shop', vi: 'Cửa hàng', en: 'Shop',
    items: [
      { cap: 'services', vi: 'Dịch vụ & giá', en: 'Services & prices', hintVi: 'Sửa menu, giá', hintEn: 'Edit the menu and prices' },
      { cap: 'products', vi: 'Sản phẩm', en: 'Products', hintVi: '', hintEn: '' },
      { cap: 'inventory', vi: 'Kho', en: 'Inventory', hintVi: '', hintEn: '' },
      { cap: 'staff', vi: 'Nhân viên (xem)', en: 'Staff (view)', hintVi: 'Chỉ chủ tiệm sửa được nhân viên', hintEn: 'Only the owner edits staff' },
    ],
  },
  {
    id: 'money', vi: 'Tiền & báo cáo', en: 'Money & reports',
    items: [
      { cap: 'dashboard', vi: 'Tổng quan doanh thu', en: 'Dashboard', hintVi: 'Doanh thu hôm nay của tiệm', hintEn: "The salon's takings" },
      { cap: 'reports', vi: 'Báo cáo & chốt ca', en: 'Reports & shifts', hintVi: '', hintEn: '' },
      { cap: 'payments', vi: 'Thanh toán', en: 'Payments', hintVi: '', hintEn: '' },
      { cap: 'payroll', vi: 'Lương thợ', en: 'Payroll', hintVi: 'Thấy lương của mọi người', hintEn: "Sees everyone's pay" },
    ],
  },
  {
    id: 'mkt', vi: 'Marketing', en: 'Marketing',
    items: [
      { cap: 'reviews', vi: 'Đánh giá & phản hồi', en: 'Reviews & feedback', hintVi: '', hintEn: '' },
      { cap: 'marketing', vi: 'Marketing & bài đăng', en: 'Marketing & posts', hintVi: '', hintEn: '' },
      { cap: 'notifications', vi: 'Tin nhắn SMS / email', en: 'SMS / email', hintVi: '', hintEn: '' },
    ],
  },
];
const OWNER_ONLY_VI = 'Cài đặt tiệm, gói dịch vụ & thanh toán Lumio, kết nối tài khoản';
const OWNER_ONLY_EN = 'Salon settings, Lumio plan & billing, connected accounts';

export function useAccessCatalog(token: string | null) {
  const [presets, setPresets] = useState<Record<Role, Cap[]>>(FALLBACK_PRESETS);
  useEffect(() => {
    if (!token) return;
    apiFetch<{ presets: Record<Role, Cap[]> }>('/staff/access-catalog', { token })
      .then((r) => { if (r?.presets) setPresets(r.presets); })
      .catch(() => undefined);
  }, [token]);
  return presets;
}

const ROLE_TEXT: Record<Role, { vi: string; en: string; emoji: string; whoVi: string; whoEn: string }> = {
  TECHNICIAN: { vi: 'Thợ', en: 'Technician', emoji: '💅', whoVi: 'Dùng app thợ: chỉ thấy lịch, khách và thu nhập của chính mình.', whoEn: 'Uses the tech app: only their own schedule, clients and earnings.' },
  RECEPTIONIST: { vi: 'Lễ tân', en: 'Receptionist', emoji: '💵', whoVi: 'Quầy lễ tân: nhận khách, đặt/dời lịch, giao thợ, tính tiền. Không thấy doanh thu, báo cáo, lương.', whoEn: 'Front desk: greet, book and move, hand to techs, check out. No takings, reports or pay.' },
  MANAGER: { vi: 'Quản lý', en: 'Manager', emoji: '👔', whoVi: 'Gần như toàn quyền vận hành, trừ cài đặt tiệm, gói Lumio và kết nối tài khoản.', whoEn: 'Runs the shop: everything except settings, the Lumio plan and connected accounts.' },
};

/** The role comparison, so an owner sees in one glance what each role opens. */
export function RoleMatrix({ vi, presets }: { vi: boolean; presets: Record<Role, Cap[]> }) {
  const roles: Role[] = ['MANAGER', 'RECEPTIONIST', 'TECHNICIAN'];
  const cell: React.CSSProperties = { padding: '7px 10px', borderTop: '1px solid var(--line)', fontSize: 13, whiteSpace: 'nowrap' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {roles.map((r) => (
          <div key={r} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: 'var(--c0f172a)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--cf1f5f9)' }}>{ROLE_TEXT[r].emoji} {vi ? ROLE_TEXT[r].vi : ROLE_TEXT[r].en}</div>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 4, lineHeight: 1.45 }}>{vi ? ROLE_TEXT[r].whoVi : ROLE_TEXT[r].whoEn}</div>
          </div>
        ))}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--c1e293b)' }}>
              <th style={{ ...cell, borderTop: 'none', textAlign: 'left', color: 'var(--ccbd5e1)' }}>{vi ? 'Mục' : 'Area'}</th>
              <th style={{ ...cell, borderTop: 'none', color: 'var(--ccbd5e1)' }}>{vi ? 'Chủ tiệm' : 'Owner'}</th>
              {roles.map((r) => <th key={r} style={{ ...cell, borderTop: 'none', color: 'var(--ccbd5e1)' }}>{vi ? ROLE_TEXT[r].vi : ROLE_TEXT[r].en}</th>)}
            </tr>
          </thead>
          <tbody>
            {ACCESS_GROUPS.flatMap((g) => g.items).map((it) => (
              <tr key={it.cap}>
                <td style={{ ...cell, color: 'var(--ce2e8f0)' }}>{vi ? it.vi : it.en}</td>
                <td style={{ ...cell, textAlign: 'center', color: 'var(--ink-good)' }}>✓</td>
                {roles.map((r) => (
                  <td key={r} style={{ ...cell, textAlign: 'center', color: presets[r]?.includes(it.cap) ? 'var(--ink-good)' : 'var(--c64748b)' }}>
                    {presets[r]?.includes(it.cap) ? '✓' : '—'}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td style={{ ...cell, color: 'var(--ce2e8f0)', whiteSpace: 'normal' }}>{vi ? OWNER_ONLY_VI : OWNER_ONLY_EN}</td>
              <td style={{ ...cell, textAlign: 'center', color: 'var(--ink-good)' }}>✓</td>
              {roles.map((r) => <td key={r} style={{ ...cell, textAlign: 'center', color: 'var(--c64748b)' }}>—</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
        {vi ? 'Đây là quyền mặc định. Bạn có thể bật/tắt thêm từng mục cho từng người trong mục "Tài khoản & quyền" khi sửa nhân viên.' : 'These are the defaults. Adjust any person in "Account & access" when editing them.'}
      </div>
    </div>
  );
}

/**
 * The checklist of screens for one person. `custom` null = the role's preset;
 * ticking anything turns it into this person's own list.
 */
export function PermissionChecklist({ vi, role, presets, custom, onChange }: {
  vi: boolean; role: Role; presets: Record<Role, Cap[]>; custom: Cap[] | null; onChange: (next: Cap[] | null) => void;
}) {
  const preset = presets[role] ?? [];
  const current = custom ?? preset;
  const differs = custom !== null && (custom.length !== preset.length || custom.some((c) => !preset.includes(c)));
  const toggle = (cap: Cap) => {
    const next = current.includes(cap) ? current.filter((c) => c !== cap) : [...current, cap];
    const same = next.length === preset.length && next.every((c) => preset.includes(c));
    onChange(same ? null : next);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...ui.label, marginBottom: 0 }}>{vi ? 'Được vào những mục' : 'Can open'}</span>
        {differs ? (
          <>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--c78350f)', color: 'var(--cfcd34d)' }}>{vi ? 'Đã tuỳ chỉnh' : 'Customised'}</span>
            <button type="button" onClick={() => onChange(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-link)', fontSize: 12.5, cursor: 'pointer', padding: 0 }}>
              {vi ? 'Về mặc định của vai trò' : "Back to the role's default"}
            </button>
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? 'Theo mặc định của vai trò' : "The role's default"}</span>
        )}
      </div>
      {role === 'TECHNICIAN' && current.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
          {vi ? 'Thợ không vào trang quản lý — họ dùng app thợ (lịch, khách và thu nhập của chính mình). Tick bên dưới nếu thợ này kiêm thêm việc, ví dụ tính tiền.' : 'Technicians use the tech app (their own schedule, clients and earnings). Tick below if this person also helps out, e.g. at checkout.'}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {ACCESS_GROUPS.map((g) => (
          <div key={g.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: 'var(--c0f172a)' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c94a3b8)', marginBottom: 6 }}>{vi ? g.vi : g.en}</div>
            {g.items.map((it) => {
              const on = current.includes(it.cap);
              return (
                <label key={it.cap} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '6px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(it.cap)} style={{ marginTop: 3 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: 'var(--ce2e8f0)', fontWeight: 600 }}>{vi ? it.vi : it.en}</span>
                    {(vi ? it.hintVi : it.hintEn) && <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? it.hintVi : it.hintEn}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>
        🔒 {vi ? 'Chỉ chủ tiệm' : 'Owner only'}: {vi ? OWNER_ONLY_VI : OWNER_ONLY_EN}.
      </div>
    </div>
  );
}

interface LoginInfo { id: string; email: string; isActive?: boolean; lastLoginAt?: string | null }

/** The sign-in account: create it, change its email, switch it off, reset the password. */
export function LoginSection({ vi, token, staffId, defaultEmail, login, onChanged }: {
  vi: boolean; token: string; staffId: string; defaultEmail: string; login: LoginInfo | null; onChanged: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [email, setEmail] = useState(login?.email ?? defaultEmail);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setEmail(login?.email ?? defaultEmail); }, [login?.email, defaultEmail]);
  const active = login?.isActive !== false;

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); setPw(''); onChanged(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : L('Không lưu được', 'Could not save') }); }
    finally { setBusy(null); }
  }
  const lastLogin = useMemo(() => (login?.lastLoginAt ? new Date(login.lastLoginAt).toLocaleString(vi ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null), [login?.lastLoginAt, vi]);
  const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' };
  const btn = (on: boolean): React.CSSProperties => ({ ...ui.primaryBtn, padding: '9px 14px', fontSize: 13, opacity: on ? 1 : 0.5, whiteSpace: 'nowrap' });

  if (!login) {
    const can = /.+@.+\..+/.test(email) && pw.length >= 8;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Người này chưa có tài khoản đăng nhập.', 'This person has no login yet.')}</div>
        <div style={row}>
          <label style={{ flex: '1 1 220px' }}><span style={ui.label}>{L('Email đăng nhập', 'Login email')}</span><input style={ui.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></label>
          <label style={{ flex: '1 1 180px' }}><span style={ui.label}>{L('Mật khẩu (ít nhất 8 ký tự)', 'Password (8+ characters)')}</span><input style={ui.input} type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
          <button type="button" disabled={!can || !!busy} style={btn(can)} onClick={() => run('create', () => apiFetch(`/staff/${staffId}/login`, { method: 'POST', token, body: { email: email.trim(), password: pw } }), L('Đã tạo tài khoản.', 'Login created.'))}>
            {busy === 'create' ? '…' : L('Tạo tài khoản', 'Create login')}
          </button>
        </div>
        {msg && <div style={{ fontSize: 12.5, color: msg.ok ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{msg.text}</div>}
      </div>
    );
  }

  const emailChanged = email.trim().toLowerCase() !== login.email && /.+@.+\..+/.test(email);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: active ? 'var(--c14532d)' : 'var(--c334155)', color: active ? 'var(--cbbf7d0)' : 'var(--ccbd5e1)' }}>
          {active ? L('Đang được đăng nhập', 'Can sign in') : L('Đã khoá đăng nhập', 'Sign-in switched off')}
        </span>
        {lastLogin && <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L('Đăng nhập gần nhất', 'Last sign-in')}: {lastLogin}</span>}
      </div>
      <div style={row}>
        <label style={{ flex: '1 1 260px' }}><span style={ui.label}>{L('Email đăng nhập', 'Login email')}</span><input style={ui.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></label>
        <button type="button" disabled={!emailChanged || !!busy} style={btn(emailChanged)} onClick={() => run('email', () => apiFetch(`/staff/${staffId}/login`, { method: 'PATCH', token, body: { email: email.trim() } }), L('Đã đổi email đăng nhập.', 'Login email changed.'))}>
          {busy === 'email' ? '…' : L('Đổi email', 'Change email')}
        </button>
      </div>
      <div style={row}>
        <label style={{ flex: '1 1 260px' }}><span style={ui.label}>{L('Mật khẩu mới (ít nhất 8 ký tự)', 'New password (8+ characters)')}</span><input style={ui.input} type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
        <button type="button" disabled={pw.length < 8 || !!busy} style={btn(pw.length >= 8)} onClick={() => run('pw', () => apiFetch(`/staff/${staffId}/password`, { method: 'POST', token, body: { password: pw } }), L('Đã đặt lại mật khẩu — người này cần đăng nhập lại.', 'Password reset — they need to sign in again.'))}>
          {busy === 'pw' ? '…' : L('Đặt lại mật khẩu', 'Reset password')}
        </button>
      </div>
      <div>
        <button type="button" disabled={!!busy}
          onClick={() => run('active', () => apiFetch(`/staff/${staffId}/login`, { method: 'PATCH', token, body: { active: !active } }), active ? L('Đã khoá đăng nhập.', 'Sign-in switched off.') : L('Đã mở lại đăng nhập.', 'Sign-in switched back on.'))}
          style={{ ...ui.dangerBtn, ...(active ? {} : { color: 'var(--ink-good)', borderColor: 'var(--c166534)' }) }}>
          {active ? L('Khoá đăng nhập', 'Switch sign-in off') : L('Mở lại đăng nhập', 'Switch sign-in back on')}
        </button>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 6 }}>
          {L('Khoá đăng nhập không xoá nhân viên, lịch hay lương — chỉ không cho vào hệ thống.', 'Switching sign-in off keeps the person, their bookings and pay — it only stops them signing in.')}
        </div>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{msg.text}</div>}
    </div>
  );
}

/** One titled block of the Account & access tab. */
export function AccessBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{title}</div>
      {children}
    </div>
  );
}
