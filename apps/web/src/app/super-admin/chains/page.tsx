'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface TenantLite { id: string; name: string; accountGroupId?: string | null }
interface GroupUser { id: string; email: string; role: string }
interface Group { id: string; name: string; createdAt: string; tenants: { id: string; name: string }[]; users: GroupUser[] }

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 18 };
const input: React.CSSProperties = { padding: '9px 11px', borderRadius: 8, border: '1px solid #334155', background: '#0b1120', color: '#e2e8f0', fontSize: 14 };
const btn: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const ghost: React.CSSProperties = { padding: '7px 11px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer' };

export default function ChainsPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (!token) router.replace('/login');
    else if (user && user.role !== 'SUPER_ADMIN') router.replace('/');
  }, [ready, token, user, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const [g, t] = await Promise.all([
        apiFetch<Group[]>('/tenants/groups', { token }),
        apiFetch<TenantLite[]>('/tenants', { token }),
      ]);
      setGroups(g); setTenants(t);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try { await apiFetch('/tenants/groups', { method: 'POST', token, body: { name: newName.trim() } }); setNewName(''); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function assignTenant(groupId: string, tenantId: string) {
    if (!tenantId) return;
    try { await apiFetch(`/tenants/${tenantId}/group`, { method: 'POST', token, body: { accountGroupId: groupId } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function removeTenant(tenantId: string) {
    try { await apiFetch(`/tenants/${tenantId}/group`, { method: 'POST', token, body: { accountGroupId: null } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function linkOwner(groupId: string, email: string) {
    if (!email.trim()) return;
    try { await apiFetch(`/tenants/groups/${groupId}/link-user`, { method: 'POST', token, body: { email: email.trim() } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function unlinkUser(groupId: string, userId: string) {
    try { await apiFetch(`/tenants/groups/${groupId}/unlink-user`, { method: 'POST', token, body: { userId } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function renameGroup(id: string, name: string) {
    if (!name.trim()) return;
    try { await apiFetch(`/tenants/groups/${id}`, { method: 'PATCH', token, body: { name: name.trim() } }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  async function deleteGroup(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Xoá chuỗi này? Các tiệm sẽ được gỡ khỏi chuỗi (dữ liệu mỗi tiệm vẫn giữ nguyên).')) return;
    try { await apiFetch(`/tenants/groups/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  const ungrouped = tenants.filter((t) => !t.accountGroupId);

  return (
    <main style={{ minHeight: '100vh', background: '#0b1120', color: '#e2e8f0', padding: '28px 24px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Chuỗi / Nhiều chi nhánh</h1>
          <Link href="/super-admin/tenants" style={{ ...ghost, textDecoration: 'none' }}>← Tiệm</Link>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 18px' }}>
          Gom các tiệm thành một chuỗi, rồi liên kết tài khoản chủ (theo email đăng nhập). Chủ đó sẽ chuyển được giữa các chi nhánh và xem báo cáo gộp. Mỗi tiệm vẫn tách dữ liệu hoàn toàn.
        </p>

        {err && <div style={{ background: '#7f1d1d', color: '#fecaca', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 14 }}>{err}</div>}

        <form onSubmit={createGroup} style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 18 }}>
          <label style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 5 }}>Tên chuỗi mới</span>
            <input style={{ ...input, width: '100%', boxSizing: 'border-box' }} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="VD: Lumio Nails — chuỗi Houston" />
          </label>
          <button type="submit" style={btn}>+ Tạo chuỗi</button>
        </form>

        {loading ? <p style={{ color: '#94a3b8' }}>Đang tải…</p> : groups.length === 0 ? (
          <p style={{ color: '#64748b' }}>Chưa có chuỗi nào. Tạo một chuỗi ở trên để bắt đầu.</p>
        ) : groups.map((g) => (
          <div key={g.id} style={{ ...card, marginBottom: 16 }}>
            <GroupHeader name={g.name} onRename={(n) => renameGroup(g.id, n)} onDelete={() => deleteGroup(g.id)} />

            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>CHI NHÁNH ({g.tenants.length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {g.tenants.map((t) => (
                <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1e293b', border: '1px solid #334155', borderRadius: 999, padding: '5px 6px 5px 12px', fontSize: 13 }}>
                  {t.name}
                  <button onClick={() => removeTenant(t.id)} title="Gỡ khỏi chuỗi" style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </span>
              ))}
              {g.tenants.length === 0 && <span style={{ color: '#64748b', fontSize: 13 }}>Chưa có chi nhánh.</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              <select defaultValue="" onChange={(e) => { assignTenant(g.id, e.target.value); e.target.value = ''; }} style={{ ...input }}>
                <option value="">+ Thêm tiệm vào chuỗi…</option>
                {ungrouped.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>TÀI KHOẢN CHỦ CHUỖI</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {g.users.map((u) => (
                <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#312e81', border: '1px solid #4f46e5', borderRadius: 999, padding: '5px 6px 5px 12px', fontSize: 13 }}>
                  {u.email}
                  <button onClick={() => unlinkUser(g.id, u.id)} title="Bỏ liên kết" style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </span>
              ))}
              {g.users.length === 0 && <span style={{ color: '#64748b', fontSize: 13 }}>Chưa liên kết chủ nào.</span>}
            </div>
            <LinkOwnerForm onLink={(email) => linkOwner(g.id, email)} />
          </div>
        ))}
      </div>
    </main>
  );
}

function GroupHeader({ name, onRename, onDelete }: { name: string; onRename: (name: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name);
  if (editing) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} style={{ ...input, flex: 1, maxWidth: 360 }} />
        <button onClick={() => { onRename(val); setEditing(false); }} style={btn}>Lưu</button>
        <button onClick={() => { setVal(name); setEditing(false); }} style={ghost}>Huỷ</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 }}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>🏢 {name}</div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={() => { setVal(name); setEditing(true); }} style={ghost}>Sửa tên</button>
        <button onClick={onDelete} style={{ ...ghost, borderColor: '#7f1d1d', color: '#fca5a5' }}>Xoá</button>
      </div>
    </div>
  );
}

function LinkOwnerForm({ onLink }: { onLink: (email: string) => void }) {
  const [email, setEmail] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); onLink(email); setEmail(''); }} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input style={{ ...input, flex: 1, maxWidth: 320 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email đăng nhập của chủ…" />
      <button type="submit" style={ghost}>Liên kết chủ</button>
    </form>
  );
}
