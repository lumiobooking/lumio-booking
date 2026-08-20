'use client';

/**
 * The one-time setup screen for a brand-new deployment.
 *
 * A new market means an empty database and no way in — the API only offers
 * login. This page creates the first Super Admin, and only ever works once:
 * the backend refuses the moment a single account exists, so this becomes a
 * dead page rather than a door left ajar.
 *
 * It is a page rather than a command line because the person doing this is the
 * owner, not an engineer, and because their password should be typed into their
 * own browser and nowhere else — not into a chat, a terminal history, or a
 * support ticket.
 */
import { useState, FormEvent } from 'react';
import { apiFetch } from '../../lib/api';
import { ui } from '../../lib/ui';
import MarketBadge from '../../components/MarketBadge';

export default function BootstrapPage() {
  const [form, setForm] = useState({ email: '', password: '', confirm: '', token: '', firstName: '', lastName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Checked here so a typo costs a moment rather than a locked-out system:
    // this page works exactly once, and there is no "forgot password" yet.
    if (form.password !== form.confirm) { setError('Hai ô mật khẩu chưa giống nhau.'); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ created: boolean; email: string }>('/auth/bootstrap', {
        method: 'POST',
        body: {
          email: form.email.trim(),
          password: form.password,
          token: form.token.trim(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
        },
      });
      setDone(r.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được tài khoản.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main style={wrap}>
        <div style={card}>
          <h1 style={{ fontSize: 22, margin: '0 0 8px', color: '#e2e8f0' }}>✓ Đã tạo tài khoản</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6 }}>
            Tài khoản Super Admin <strong style={{ color: '#e2e8f0' }}>{done}</strong> đã sẵn sàng.
          </p>
          <p style={{ color: '#fbbf24', fontSize: 13, lineHeight: 1.6, marginTop: 14 }}>
            Trang này giờ đã tự khoá — nó chỉ chạy được một lần. Vào Render và{' '}
            <strong>xoá biến <code>BOOTSTRAP_TOKEN</code></strong> để không còn gì thừa nằm lại.
          </p>
          <a href="/login" style={{ ...ui.primaryBtn, display: 'inline-block', marginTop: 16, textDecoration: 'none' }}>
            Đăng nhập
          </a>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <form onSubmit={submit} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0, color: '#e2e8f0' }}>Thiết lập lần đầu</h1>
          <MarketBadge />
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13.5, lineHeight: 1.6, margin: '4px 0 18px' }}>
          Tạo tài khoản Super Admin đầu tiên cho hệ thống này. Trang này chỉ chạy được
          <strong style={{ color: '#e2e8f0' }}> một lần</strong> — có một tài khoản rồi thì nó tự khoá vĩnh viễn.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Tên">
            <input style={ui.input} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          </Field>
          <Field label="Họ">
            <input style={ui.input} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
          </Field>
        </div>

        <Field label="Email đăng nhập">
          <input style={ui.input} type="email" autoComplete="username" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>

        <Field label="Mật khẩu — tối thiểu 12 ký tự, có chữ hoa, chữ thường và số">
          <input style={ui.input} type="password" autoComplete="new-password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} />
        </Field>

        <Field label="Nhập lại mật khẩu">
          <input style={ui.input} type="password" autoComplete="new-password" value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })} required minLength={12} />
        </Field>

        <Field label="Mã thiết lập — giá trị BOOTSTRAP_TOKEN bạn đặt trong Render">
          <input style={ui.input} type="password" autoComplete="off" value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })} required minLength={16} />
        </Field>

        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: 8, padding: '10px 12px', fontSize: 13.5, marginTop: 12 }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={busy} style={{ ...ui.primaryBtn, width: '100%', marginTop: 16, padding: 12, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Đang tạo…' : 'Tạo tài khoản Super Admin'}
        </button>

        <p style={{ color: '#64748b', fontSize: 11.5, lineHeight: 1.6, marginTop: 14 }}>
          Mật khẩu này chỉ đi từ trình duyệt của bạn tới máy chủ của bạn. Không ai khác nhìn thấy nó,
          kể cả trong log — nên hãy lưu vào trình quản lý mật khẩu ngay, hệ thống chưa có chức năng quên mật khẩu.
        </p>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginTop: 12 }}>
      <span style={{ ...ui.label, display: 'block', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}

const wrap: React.CSSProperties = {
  minHeight: '100vh', display: 'grid', placeItems: 'center',
  background: '#0b1120', padding: 24,
};
const card: React.CSSProperties = {
  width: '100%', maxWidth: 460, background: '#111827',
  border: '1px solid #1f2937', borderRadius: 16, padding: 28,
};
