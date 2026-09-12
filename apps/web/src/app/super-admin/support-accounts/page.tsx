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
  /**
   * Which pair of people this employee works with. A plain name, shared with
   * the salons they look after — never a permission. See support-teams.ts.
   */
  supportTeam?: string | null;
  /**
   * This employee's own list of screens. Non-empty, it REPLACES the level's
   * preset; empty, the preset stands. Absent on a build older than the column.
   */
  supportCaps?: string[];
}

/** One tickable screen, as the server describes it. */
interface CapRow {
  id: string;
  label: string;
  /** Its DATA is the salon's money or its customers — a tick to think about. */
  private: boolean;
}

type SupportLevel = 'content' | 'setup' | 'full';

/**
 * The three levels, in the words the person choosing has to weigh.
 *
 * Written as what the employee WILL and WILL NOT see rather than as a rank,
 * because "level 2" tells the reader nothing and "cannot see the takings" is
 * the entire decision. The order is narrowest first: the safe pick is the one
 * the eye lands on.
 *
 * These are PRESETS. An employee whose slice none of the three cuts gets a
 * hand-picked list instead, ticked on their own row, and that list replaces the
 * preset entirely. The presets stay because ticking twenty-one boxes for every
 * new starter is how a permission system ends up with everybody on "toàn quyền".
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

/** The ticks this employee actually carries, tolerating an older API shape. */
const custom = (a: Account): string[] => (Array.isArray(a.supportCaps) ? a.supportCaps : []);

/**
 * What the panel starts ticked with for somebody who has no list yet.
 *
 * Their preset's contents, so the first thing the owner does is UNtick what
 * this person should not have. Starting from an empty panel would make the
 * obvious first action — open it, tick the one extra screen, save — quietly
 * remove everything else they had.
 */
const capsOfPreset = (level: string, all: CapRow[], presets: Record<string, string[]>): string[] => {
  const p = presets[level];
  if (Array.isArray(p) && p.length) return p;
  // No answer from the server: tick nothing rather than guess, and the panel
  // says why. Saving from here is still the owner's explicit choice.
  return all.length ? [] : [];
};

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
  // The tickable screens, named by the server — the same half that refuses the
  // requests. Empty on an API build older than this screen, which is why the
  // panel says so instead of drawing nothing.
  const [catalog, setCatalog] = useState<CapRow[]>([]);
  // What each preset contains, from the server. Used only to open the tick
  // panel on the employee's CURRENT access — see capsOfPreset.
  const [presets, setPresets] = useState<Record<string, string[]>>({});
  // Whose ticks are open, and the unsaved state of them. Held apart from `rows`
  // so closing the panel without saving cannot leave a half-edited account on
  // screen looking saved.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try { setRows(await apiFetch<Account[]>('/support/accounts', { token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, [token]);

  // Asked for once. A failure here is not an error on screen: the level
  // dropdown still works, and the panel explains why it has no boxes.
  useEffect(() => {
    if (!token) return;
    apiFetch<{ caps: CapRow[]; presets?: Record<string, string[]> }>('/support/capabilities', { token })
      .then((r) => { setCatalog(Array.isArray(r?.caps) ? r.caps : []); setPresets(r?.presets ?? {}); })
      .catch(() => { setCatalog([]); setPresets({}); });
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

  /**
   * Put somebody on a team, or take them off one.
   *
   * A free text box with the teams that already exist offered underneath, not
   * a fixed list: teams are created by typing a new name here, and a dropdown
   * with no "new…" option would mean the first team could never be made. The
   * suggestions are what stop "Nhóm 1" and "nhóm 1 " becoming two teams.
   */
  async function setTeam(a: Account, supportTeam: string) {
    if (!token) return;
    const next = supportTeam.replace(/\s+/g, ' ').trim();
    if (next === (a.supportTeam ?? '')) return;
    setBusy(a.id); setMsg(null); setError(null);
    try {
      await apiFetch(`/support/accounts/${a.id}/team`, { method: 'POST', token, body: { team: next } });
      setMsg(next ? `${a.email}: nhóm ${next}.` : `${a.email}: đã bỏ khỏi nhóm.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đổi được nhóm');
    } finally { setBusy(null); }
  }

  /**
   * Change the preset. Deliberately sends NO `supportCaps`, so an employee on a
   * hand-picked list keeps it: the two controls sit on one row and a person
   * nudging the dropdown does not expect the ticks underneath to vanish.
   */
  async function setLevel(a: Account, supportLevel: SupportLevel) {
    if (!token || supportLevel === a.supportLevel) return;
    setBusy(a.id); setError(null); setMsg(null);
    try {
      await apiFetch(`/support/accounts/${a.id}/level`, { method: 'POST', token, body: { supportLevel } });
      setMsg(custom(a).length
        ? `${a.email}: mức nền ${LEVEL(supportLevel).label} — nhưng bạn ấy đang dùng danh sách riêng nên mức nền chưa có tác dụng.`
        : `${a.email}: ${LEVEL(supportLevel).label}. Có hiệu lực từ lần vào tiệm tiếp theo của bạn ấy.`);
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Update failed'); }
    finally { setBusy(null); }
  }

  /**
   * Save the ticks. An empty list is a real answer — "back to the preset" — so
   * it is sent, not skipped.
   */
  async function saveCaps(a: Account, caps: string[]) {
    if (!token) return;
    setBusy(a.id); setError(null); setMsg(null);
    try {
      await apiFetch(`/support/accounts/${a.id}/level`, {
        method: 'POST', token, body: { supportLevel: a.supportLevel, supportCaps: caps },
      });
      setMsg(caps.length
        ? `${a.email}: ${caps.length} mục riêng. Có hiệu lực từ lần vào tiệm tiếp theo của bạn ấy.`
        : `${a.email}: quay về mức ${LEVEL(a.supportLevel).label}.`);
      setEditing(null);
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Không lưu được') }
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
          {' '}Ai cần đúng vài mục mà 3 mức không khớp thì bấm <b>Tuỳ chỉnh</b> ở dòng của bạn ấy và tick từng mục;
          danh sách riêng <b>thay thế</b> mức nền chứ không cộng thêm.
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
          {/* Every team that already has somebody on it, offered as you type.
              This is what keeps "Nhóm 1" from becoming three teams. */}
          <datalist id="lumio-teams">
            {[...new Set(rows.map((r) => (r.supportTeam ?? '').trim()).filter(Boolean))].sort().map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
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
            <div key={a.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderBottom: editing === a.id ? 'none' : '1px solid var(--c1f2937)', background: 'var(--c111827)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{`${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email}</div>
                <div style={{ fontSize: 12.5, color: 'var(--c64748b)' }}>
                  {a.email}{a.lastLoginAt ? ` · last login ${new Date(a.lastLoginAt).toLocaleDateString(uiLocale())}` : ' · never logged in'}
                </div>
              </div>
              {/* The team, edited where the person is. Naming a team IS
                  creating it — there is nowhere else to make one, on purpose:
                  a team is a name two screens agree on, not a record. */}
              <input
                list="lumio-teams"
                defaultValue={a.supportTeam ?? ''}
                disabled={busy === a.id}
                placeholder="Nhóm…"
                onBlur={(e) => setTeam(a, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                title="Nhóm phụ trách — gõ tên mới để tạo nhóm"
                style={{
                  width: 104, background: 'var(--c0f172a)', color: a.supportTeam ? 'var(--ink-link)' : 'var(--c64748b)',
                  border: `1px solid ${a.supportTeam ? '#6366f1' : 'var(--c334155)'}`, borderRadius: 8,
                  padding: '6px 9px', fontSize: 12.5, fontWeight: 700,
                }}
              />
              <select
                value={a.supportLevel}
                disabled={busy === a.id}
                onChange={(e) => setLevel(a, e.target.value as SupportLevel)}
                title={custom(a).length
                  ? `Mức nền (đang bị danh sách riêng ${custom(a).length} mục thay thế)`
                  : `Thấy: ${LEVEL(a.supportLevel).sees}\nẨn: ${LEVEL(a.supportLevel).hides}`}
                style={{
                  background: 'var(--c0f172a)',
                  // Greyed while a hand-picked list is in force, because the
                  // preset is not what this employee sees and a coloured badge
                  // saying "Setup" next to a half-empty menu reads as a bug.
                  color: custom(a).length ? 'var(--c64748b)' : LEVEL(a.supportLevel).tone,
                  border: `1px solid ${custom(a).length ? 'var(--c334155)' : LEVEL(a.supportLevel).tone}`,
                  borderRadius: 8, padding: '6px 9px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  opacity: custom(a).length ? 0.6 : 1,
                }}
              >
                {LEVELS.map((l) => <option key={l.id} value={l.id} style={{ color: 'var(--ce2e8f0)' }}>{l.label}</option>)}
              </select>
              {/* The ticks. Closed by default: most employees are on a preset,
                  and twenty-one boxes on every row would bury the three names
                  that answer the question for five of the six of them. */}
              <button
                onClick={() => {
                  const on = editing === a.id;
                  setEditing(on ? null : a.id);
                  setDraft(on ? [] : custom(a).length ? custom(a) : capsOfPreset(a.supportLevel, catalog, presets));
                  setMsg(null); setError(null);
                }}
                disabled={busy === a.id}
                title="Chọn từng mục cho riêng bạn này"
                style={{
                  background: custom(a).length ? 'var(--c312e81)' : 'transparent',
                  border: `1px solid ${custom(a).length ? '#6366f1' : 'var(--c334155)'}`,
                  color: custom(a).length ? 'var(--ink-link)' : 'var(--c94a3b8)',
                  borderRadius: 8, padding: '6px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {custom(a).length ? `Riêng · ${custom(a).length}` : 'Tuỳ chỉnh'}{editing === a.id ? ' ▴' : ' ▾'}
              </button>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: a.isActive ? 'var(--ink-good)' : 'var(--ink-bad)' }}>
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
            {editing === a.id && (
              <div style={{ background: 'var(--c0f172a)', borderBottom: '1px solid var(--c1f2937)', padding: '14px 16px 16px' }}>
                <div style={{ fontSize: 13, color: 'var(--ce2e8f0)', fontWeight: 700, marginBottom: 4 }}>
                  Chọn từng mục cho {`${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email}
                </div>
                {/* Said plainly, because this is the one thing about the feature
                    that surprises people: the list is not added to the preset,
                    it takes its place. */}
                <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.6, marginBottom: 12 }}>
                  Danh sách này <b>thay thế</b> mức <b>{LEVEL(a.supportLevel).label}</b> — không phải cộng thêm.
                  Bỏ tick hết rồi Lưu là quay về mức đó. Có hiệu lực từ lần bạn ấy vào tiệm tiếp theo.
                </div>

                {catalog.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--cfca5a5)', lineHeight: 1.6 }}>
                    API chưa trả về danh sách mục (bản API đang chạy cũ hơn màn hình này).
                    Deploy lại API rồi mở lại — mức quyền ở trên vẫn dùng được bình thường.
                  </div>
                ) : (
                  <>
                    {([[false, 'Công việc hằng ngày'], [true, 'Tiền & dữ liệu khách — cân nhắc trước khi tick']] as [boolean, string][]).map(([priv, title]) => {
                      const group = catalog.filter((c) => c.private === priv);
                      if (!group.length) return null;
                      return (
                        <div key={title} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: .3, textTransform: 'uppercase', color: priv ? 'var(--ink-bad)' : 'var(--c64748b)', marginBottom: 7 }}>
                            {title}
                          </div>
                          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
                            {group.map((c) => {
                              const on = draft.includes(c.id);
                              return (
                                <label
                                  key={c.id}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                                    fontSize: 12.5, lineHeight: 1.4, padding: '7px 10px', borderRadius: 8,
                                    background: on ? 'var(--c111827)' : 'transparent',
                                    border: `1px solid ${on ? (priv ? '#b45309' : '#6366f1') : 'var(--c1f2937)'}`,
                                    color: on ? 'var(--ce2e8f0)' : 'var(--c94a3b8)',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => setDraft(on ? draft.filter((x) => x !== c.id) : [...draft, c.id])}
                                    style={{ accentColor: priv ? '#f59e0b' : '#6366f1', width: 15, height: 15, flex: '0 0 auto' }}
                                  />
                                  <span>{c.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                      <button onClick={() => saveCaps(a, draft)} disabled={busy === a.id}
                        style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busy === a.id ? 0.5 : 1 }}>
                        {busy === a.id ? '…' : `Lưu ${draft.length} mục`}
                      </button>
                      {/* The way back, spelled out. Without it the only route
                          off a hand-picked list is "untick all twenty-one",
                          which nobody finds. */}
                      <button onClick={() => saveCaps(a, [])} disabled={busy === a.id || custom(a).length === 0}
                        title="Bỏ danh sách riêng, dùng lại mức quyền ở trên"
                        style={{ background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', opacity: custom(a).length === 0 ? 0.4 : 1 }}>
                        Dùng lại mức {LEVEL(a.supportLevel).label}
                      </button>
                      <button onClick={() => { setEditing(null); setDraft([]); }} disabled={busy === a.id}
                        style={{ background: 'transparent', border: 'none', color: 'var(--c94a3b8)', fontSize: 13, cursor: 'pointer' }}>
                        Huỷ
                      </button>
                      {draft.length === 0 && (
                        <span style={{ fontSize: 12, color: 'var(--cfbbf24)' }}>
                          Chưa tick mục nào — Lưu sẽ đưa bạn ấy về mức {LEVEL(a.supportLevel).label}.
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          )))}
        </div>
      </div>
    </main>
  );
}

const input: React.CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 8, padding: '10px 12px', fontSize: 14 };
const screen: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c0b1120)' };
