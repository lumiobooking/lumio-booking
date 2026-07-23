'use client';

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import Link from 'next/link';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

interface Item {
  key: string;
  group: 'payments' | 'marketing' | 'messaging' | 'website';
  name: string;
  connected: boolean;
  state: 'ok' | 'warn' | 'error' | 'off';
  detail: string | null;
  lastActivity: string | null;
  testPath: string | null;
  manageHref: string;
}

const STATE: Record<string, { color: string; bg: string; vi: string; en: string }> = {
  ok:    { color: '#22c55e', bg: '#052e16', vi: 'Đã kết nối ✓', en: 'Connected ✓' },
  warn:  { color: '#f59e0b', bg: '#3a2606', vi: 'Cần chú ý', en: 'Needs attention' },
  error: { color: '#ef4444', bg: '#3f1212', vi: 'Lỗi kết nối', en: 'Connection error' },
  off:   { color: '#64748b', bg: '#1e293b', vi: 'Chưa kết nối', en: 'Not connected' },
};

const GROUPS: Array<{ key: Item['group']; vi: string; en: string; icon: string }> = [
  { key: 'payments',  vi: 'Thanh toán', en: 'Payments', icon: '💳' },
  { key: 'marketing', vi: 'Marketing & Google', en: 'Marketing & Google', icon: '📣' },
  { key: 'messaging', vi: 'Tin nhắn & Email', en: 'Messaging & Email', icon: '✉️' },
  { key: 'website',   vi: 'Website', en: 'Website', icon: '🌐' },
];

export default function ConnectionsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // key -> test result while/after running
  const [testing, setTesting] = useState<Record<string, 'run' | 'ok' | 'fail'>>({});
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try { setItems((await apiFetch<{ items: Item[] }>('/integrations', { token })).items); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function runTest(it: Item) {
    if (!it.testPath) return;
    setTesting((m) => ({ ...m, [it.key]: 'run' })); setTestMsg((m) => ({ ...m, [it.key]: '' }));
    try {
      const r = await apiFetch<any>(it.testPath, { method: 'POST', token, body: {} });
      const pass = r?.ok === true || r?.online === true || r?.sent === true;
      setTesting((m) => ({ ...m, [it.key]: pass ? 'ok' : 'fail' }));
      setTestMsg((m) => ({ ...m, [it.key]: String(r?.message || r?.error || (pass ? '' : 'Không phản hồi đúng')) }));
      if (pass) await load();
    } catch (e) {
      setTesting((m) => ({ ...m, [it.key]: 'fail' }));
      setTestMsg((m) => ({ ...m, [it.key]: e instanceof Error ? e.message : 'error' }));
    }
  }

  const okCount = items.filter((x) => x.state === 'ok').length;
  const problem = items.filter((x) => x.state === 'error' || x.state === 'warn').length;

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{T('Kết nối hệ thống', 'Connections')}</h1>
      <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
        {T('Tất cả kết nối bên thứ ba của tiệm ở một nơi — xanh là chạy tốt.', 'Every third-party connection in one place — green means working.')}
        {!loading && <> · <b style={{ color: '#22c55e' }}>{okCount} {T('đang chạy', 'working')}</b>{problem > 0 && <> · <b style={{ color: '#f59e0b' }}>{problem} {T('cần xem', 'need attention')}</b></>}</>}
      </p>

      {err && <div style={ui.banner}>{err}</div>}
      {loading ? <p style={{ color: '#94a3b8' }}>{T('Đang tải…', 'Loading…')}</p> : (
        GROUPS.map((g) => {
          const rows = items.filter((x) => x.group === g.key);
          if (rows.length === 0) return null;
          return (
            <div key={g.key} style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>{g.icon} {T(g.vi, g.en)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((it) => {
                  const st = STATE[it.state] ?? STATE.off;
                  const t = testing[it.key];
                  return (
                    <div key={it.key} style={{ background: '#111a2c', border: `1px solid ${it.state === 'error' ? '#7f1d1d' : '#1e293b'}`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}`, borderRadius: 999, padding: '2px 10px', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{T(st.vi, st.en)}</span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{it.name}</span>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                          {it.testPath && (
                            <button onClick={() => runTest(it)} disabled={t === 'run'} style={mini}>
                              {t === 'run' ? T('Đang kiểm…', 'Testing…') : T('Kiểm tra', 'Test')}
                            </button>
                          )}
                          <Link href={it.manageHref} style={{ ...mini, textDecoration: 'none', display: 'inline-block' }}>{T('Quản lý →', 'Manage →')}</Link>
                        </span>
                      </div>
                      {(it.detail || it.lastActivity) && (
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                          {it.detail}
                          {it.lastActivity && <span> · {T('hoạt động gần nhất', 'last activity')}: {new Date(it.lastActivity).toLocaleString(vi ? 'vi-VN' : 'en-US')}</span>}
                        </div>
                      )}
                      {t === 'ok' && <div style={{ fontSize: 12.5, color: '#22c55e', marginTop: 6 }}>✓ {T('Kiểm tra thành công — kết nối đang hoạt động.', 'Test passed — the connection works.')} {testMsg[it.key]}</div>}
                      {t === 'fail' && <div style={{ fontSize: 12.5, color: '#f87171', marginTop: 6 }}>✗ {T('Kiểm tra thất bại', 'Test failed')}{testMsg[it.key] ? `: ${testMsg[it.key]}` : ''} — {T('bấm Quản lý để sửa.', 'open Manage to fix.')}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <p style={{ fontSize: 12, color: '#64748b', marginTop: 18 }}>
        {T('Nút "Kiểm tra" gọi thẳng tới nhà cung cấp (Square, Twilio, Meta...) bằng khóa tiệm đã lưu — thấy ✓ nghĩa là kết nối thật sự hoạt động, không phải chỉ "đã lưu key".',
           '"Test" calls the provider directly (Square, Twilio, Meta...) with the saved key — a ✓ means the connection genuinely works, not just "a key was saved".')}
      </p>
    </section>
  );
}

const mini: CSSProperties = { padding: '5px 12px', borderRadius: 7, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 12.5, cursor: 'pointer' };
