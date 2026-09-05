'use client';

// Super Admin: manage Lumio SUPPORT staff accounts. One email per employee —
// audit logs name the person, and switching one account off revokes their
// access to every salon at once.

import { useCallback, useEffect, useState, FormEvent } from 'react';
import MarketBadge from '../../../components/MarketBadge';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { uiLocale } from '../../../lib/datetime';

interface Account {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** How much of a salon this employee sees once inside it. */
  supportLevel: SupportLevel;
}

type SupportLevel = 'content' | 'setup' | 'full';

/**
 * The three levels, in the words the person choosing has to weigh.
 *
 * Written as what the employee WILL and WILL NOT see rather than as a rank,
 * because "level 2" tells the reader nothing and "cannot see the takings" is
 * the entire decision. The order is narrowest first: the safe pick is the one
 * the eye lands on.
 */
const LEVELS: { id: SupportLevel; label: string; sees: string; hides: string; tone: string }[] = [
  {
    id: 'content',
    label: 'Nội dung & marketing',
    sees: 'Lịch đăng bài, kế hoạch marketing, duyệt bài, đánh giá, Inbox/Messenger, AI Hotline',
    hides: 'Tiền, khách hàng, dịch vụ, nhân viên, cài đặt, kết nối',
    tone: '#22c55e',
  },
  {
    id: 'setup',
    label: 'Setup toàn diện',
    sees: 'Mọi thứ ở trên, cộng dịch vụ, thợ, ghế, cài đặt tiệm, kết nối kênh, thông báo',
    hides: 'Doanh thu, POS, hoá đơn, lương, giao dịch thẻ, danh sách khách, lịch hẹn',
    tone: '#6366f1',
  },
  {
    id: 'full',
    label: 'Toàn quyền như chủ tiệm',
    sees: 'Mọi thứ trong tiệm, kể cả doanh thu và dữ liệu khách',
    hides: 'Không ẩn gì. Chỉ cấp cho người quản lý.',
    tone: '#f59e0b',
  },
];

const LEVEL = (id: string) => LEVELS.find((l) => l.id === id) ?? LEVELS[1];

export default function SupportAccountsPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Which row is asking "really?". Deleting a colleague's account is one click
  // away from deleting the wrong colleague's account, and the two rows look
  // alike at a glance — so the second click has to name the person.
  const [confirming, setConfirming] = useState<string | null>(null);
  // The default is the middle level, not the widest: an account created in a
  // hurry should not be the one that can read the salon's takings.
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '', supportLevel: 'setup' as SupportLevel });

  const load = useCallback(async () => {
    if (!token) return;
    try { setRows(await apiFetch<Account[]>('/support/accounts', { token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    if (!ready) return;
    if (!user || user.role !== 'SUPER_ADMIN') { router.replace('/login'); return; }
    load();
  }, [ready, user, router, load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy('new'); setError(null); setMsg(null);
    try {
      await apiFetch('/support/accounts', { method: 'POST', token, body: form });
      setMsg(`Created ${form.email}. Send them the password yourself — it is not shown again.`);
      setForm({ email: '', password: '', firstName: '', lastName: '', supportLevel: form.supportLevel });
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Create failed'); }
    finally { setBusy(null); }
  }

  async function setLevel(a: Account, supportLevel: SupportLevel) {
    if (!token || supportLevel === a.supportLevel) return;
    setBusy(a.id); setError(null); setMsg(null);
    try {
      await apiFetch(`/support/accounts/${a.id}/level`, { method: 'POST', token, body: { supportLevel } });
      setMsg(`${a.email}: ${LEVEL(supportLevel).label}. Có hiệu lực từ lần vào tiệm tiếp theo của bạn ấy.`);
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Update failed'); }
    finally { setBusy(null); }
  }

  async function remove(a: Account) {
    if (!token) return;
    setBusy(a.id); setError(null); setMsg(null);
    try {
      await apiFetch(`/support/accounts/${a.id}`, { method: 'DELETE', token });
      setMsg(`Đã xoá ${a.email}. Phiên đang mở của bạn ấy cũng đứt trong vòng 10 giây.`);
      setConfirming(null);
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Delete failed'); }
    finally { setBusy(null); }
  }

  async function toggle(a: Account) {
    if (!token) return;
    setBusy(a.id); setError(null);
    try {
      await apiFetch(`/support/accounts/${a.id}/active`, { method: 'POST', token, body: { isActive: !a.isActive } });
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Update failed'); }
    finally { setBusy(null); }
  }

  if (!ready || loading) return <main style={screen}><div style={{ color: 'var(--c94a3b8)' }}>Loading…</div></main>;

  return (
    <main style={{ minHeight: '100vh', background: 'var(--c0b1120)', color: 'var(--ce2e8f0)', padding: '28px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><h1 style={{ fontSize: 22, margin: 0 }}>Support accounts</h1><MarketBadge /></div>
          <a href="/super-admin/tenants" style={{ marginLeft: 'auto', color: 'var(--c818cf8)', fontSize: 13.5, textDecoration: 'none' }}>← Tenants</a>
        </div>
        <p style={{ color: 'var(--c94a3b8)', fontSize: 14, margin: '0 0 18px' }}>
          Setup staff log in with these and enter salons from the <b>/agency</b> page. They cannot touch plans, billing or tenant management.
        </p>
        <p style={{ color: 'var(--c64748b)', fontSize: 13, margin: '-10px 0 18px', lineHeight: 1.6 }}>
          Mức quyền quyết định bạn ấy thấy gì <i>bên trong</i> tiệm. Đổi mức có hiệu lực từ lần vào tiệm kế tiếp —
          phiên đang mở giữ nguyên mức đã cấp, và nhật ký ghi lại mức của từng phiên.
        </p>

        {error && <div style={{ background: 'var(--c7f1d1d)', color: 'var(--cfecaca)', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 12 }}>{error}</div>}
        {msg && <div style={{ background: 'var(--c14532d)', color: 'var(--cbbf7d0)', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 12 }}>{msg}</div>}

        <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, background: 'var(--c111827)', border: '1px solid var(--c1f2937)', borderRadius: 12, padding: 14, marginBottom: 18 }}>
          <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={input} />
          <input required type="text" placeholder="Password (min 8)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={input} />
          <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} style={input} />
          <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} style={input} />
          <button type="submit" disabled={busy === 'new'} style={{ background: '#6366f1', border: 'none', color: 'white', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: busy === 'new' ? 0.5 : 1 }}>
            {busy === 'new' ? '…' : '+ Create'}
          </button>

          {/* The level, chosen before the account exists rather than after.
              An account created wide and narrowed later is an account that
              was wide for as long as nobody got round to it. */}
          <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginBottom: 7 }}>
              Bạn này được xem gì trong tiệm của khách?
            </div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
              {LEVELS.map((l) => {
                const on = form.supportLevel === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setForm({ ...form, supportLevel: l.id })}
                    style={{
                      textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px',
                      background: on ? 'var(--c0f172a)' : 'transparent',
                      border: `1px solid ${on ? l.tone : 'var(--c334155)'}`,
                      boxShadow: on ? `0 0 0 2px ${l.tone}33` : 'none',
                    }}
                  >
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: on ? l.tone : 'var(--ce2e8f0)' }}>
                      {on ? '● ' : '○ '}{l.label}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.5, marginTop: 4 }}>
                      Thấy: {l.sees}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.5, marginTop: 2 }}>
                      Ẩn: {l.hides}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </form>

        <div style={{ border: '1px solid var(--c1f2937)', borderRadius: 12, overflow: 'hidden' }}>
          {rows.length === 0 && <div style={{ padding: 18, color: 'var(--c64748b)', fontSize: 14 }}>No support accounts yet.</div>}
          {rows.map((a) => (confirming === a.id ? (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--c1f2937)', background: 'var(--c450a0a)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--cfecaca)' }}>
                  Xoá hẳn {`${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email}?
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--cfca5a5)', lineHeight: 1.55 }}>
                  {a.email} — không khôi phục được. Lịch sử làm việc và nhật ký vẫn giữ nguyên tên bạn ấy;
                  phiên đang mở trong tiệm sẽ đứt trong vòng 10 giây. Chỉ muốn tạm ngưng thì bấm <b>Disable</b>.
                </div>
              </div>
              <button onClick={() => setConfirming(null)} disabled={busy === a.id}
                style={{ background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
                Huỷ
              </button>
              <button onClick={() => remove(a)} disabled={busy === a.id}
                style={{ background: '#ef4444', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy === a.id ? 0.5 : 1 }}>
                {busy === a.id ? '…' : 'Xoá hẳn'}
              </button>
            </div>
          ) : (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--c1f2937)', background: 'var(--c111827)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{`${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email}</div>
                <div style={{ fontSize: 12.5, color: 'var(--c64748b)' }}>
                  {a.email}{a.lastLoginAt ? ` · last login ${new Date(a.lastLoginAt).toLocaleDateString(uiLocale())}` : ' · never logged in'}
                </div>
              </div>
              <select
                value={a.supportLevel}
                disabled={busy === a.id}
                onChange={(e) => setLevel(a, e.target.value as SupportLevel)}
                title={`Thấy: ${LEVEL(a.supportLevel).sees}\nẨn: ${LEVEL(a.supportLevel).hides}`}
                style={{
                  background: 'var(--c0f172a)', color: LEVEL(a.supportLevel).tone,
                  border: `1px solid ${LEVEL(a.supportLevel).tone}`, borderRadius: 8,
                  padding: '6px 9px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {LEVELS.map((l) => <option key={l.id} value={l.id} style={{ color: 'var(--ce2e8f0)' }}>{l.label}</option>)}
              </select>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: a.isActive ? '#22c55e' : '#ef4444' }}>
                {a.isActive ? 'ACTIVE' : 'DISABLED'}
              </span>
              <button onClick={() => toggle(a)} disabled={busy === a.id}
                style={{ background: 'transparent', border: '1px solid var(--c334155)', color: a.isActive ? 'var(--cf87171)' : 'var(--c4ade80)', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer', opacity: busy === a.id ? 0.5 : 1 }}>
                {busy === a.id ? '…' : a.isActive ? 'Disable' : 'Enable'}
              </button>
              {/* Quiet by default: Disable is the everyday answer, and the
                  destructive one should not compete with it for the eye. */}
              <button onClick={() => { setConfirming(a.id); setMsg(null); setError(null); }} disabled={busy === a.id}
                title="Xoá hẳn tài khoản này"
                style={{ background: 'transparent', border: 'none', color: 'var(--c64748b)', borderRadius: 8, padding: '7px 8px', fontSize: 14, cursor: 'pointer' }}>
                🗑
              </button>
            </div>
          )))}
        </div>
      </div>
    </main>
  );
}

const input: React.CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '10px 12px', fontSize: 14 };
const screen: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c0b1120)' };
