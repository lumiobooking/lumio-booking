'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';

/**
 * Super Admin: Pinterest Trends, connected once, by a button.
 *
 * The manual way (authorize link, code off the address bar, curl with a
 * base64 header, copy the right string out of JSON into Render) is the way
 * that produced a secret in two screenshots and "CODE" sent literally. So:
 * the app id and secret live in Render as env vars, and this card does the
 * rest — one press, Pinterest asks for consent, the server keeps the token.
 */

interface Status {
  connected: boolean;
  viaEnv: boolean;
  username: string | null;
  connectedAt: string | null;
  scopes: string[];
  hasTrends: boolean;
  appReady: boolean;
  redirectUri: string;
  appId: string | null;
}

export function PinterestCard({ token }: { token: string | null }) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setSt(await apiFetch<Status>('/content/pinterest/status', { token }).catch(() => null));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Pinterest bounced the browser back with a verdict in the query string.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const v = q.get('pinterest');
    if (!v) return;
    setMsg(v === 'ok'
      ? { ok: true, text: 'Đã kết nối Pinterest. Bảng Ý tưởng → Từ khoá sẽ có dải "Đang lên trên Pinterest" ở lần kéo tới (hoặc bấm "Kéo lại").' }
      : { ok: false, text: `Pinterest không cho kết nối (${q.get('msg') ?? 'lỗi'}). Kiểm tra Redirect URI trong app Pinterest có đúng y hệt dòng bên dưới, và PINTEREST_APP_ID / PINTEREST_APP_SECRET trên Render.` });
    const url = new URL(window.location.href);
    url.searchParams.delete('pinterest'); url.searchParams.delete('msg');
    window.history.replaceState({}, '', url.toString());
  }, []);

  async function connect() {
    if (!token) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ url: string }>('/content/pinterest/connect', { token });
      window.location.assign(r.url);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'error' });
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!token) return;
    setBusy(true); setMsg(null);
    try {
      await apiFetch('/content/pinterest/disconnect', { method: 'POST', token });
      setMsg({ ok: true, text: 'Đã ngắt. Dải Pinterest trên bảng Ý tưởng sẽ trống cho đến khi kết nối lại.' });
      await load();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'error' }); }
    finally { setBusy(false); }
  }

  async function copyUri() {
    if (!st?.redirectUri) return;
    try { await navigator.clipboard.writeText(st.redirectUri); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the text is selectable */ }
  }

  return (
    <section id="pinterest" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>📌 Pinterest Trends — từ khoá đang lên</h2>
        {st && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: st.connected ? 'rgba(34,197,94,.14)' : 'var(--c0f172a)',
            border: `1px solid ${st.connected ? '#22c55e' : 'var(--c475569)'}`,
            color: st.connected ? 'var(--ink-good)' : 'var(--c94a3b8)',
          }}>
            {st.connected ? `Đã kết nối${st.username ? ` — @${st.username}` : st.viaEnv ? ' — qua biến môi trường' : ''}` : 'Chưa kết nối'}
          </span>
        )}
        {st?.connected && !st.hasTrends && (
          <span style={{ fontSize: 12, color: 'var(--ink-warn)', fontWeight: 700 }}>thiếu quyền trends:read — bấm Kết nối lại</span>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.6, margin: '0 0 12px' }}>
        Pinterest cho biết khách <b>ghim gì trước khi đi làm đẹp</b> — thường sớm hơn Google vài tuần. Kết nối một lần bằng tài khoản Pinterest của Lumio,
        mọi tiệm dùng chung; dữ liệu là xu hướng công khai, không phải dữ liệu riêng của tiệm nào.
      </p>

      {msg && (
        <div style={{
          marginBottom: 12, padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
          background: msg.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          color: msg.ok ? 'var(--c4ade80)' : 'var(--cfca5a5)',
        }}>{msg.text}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {st?.connected ? (
          <>
            <button onClick={connect} disabled={busy || !st.appReady} style={ghost}>Kết nối lại</button>
            <button onClick={disconnect} disabled={busy} style={{ ...ghost, color: 'var(--cf87171)' }}>Ngắt kết nối</button>
            {st.connectedAt && <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>từ {new Date(st.connectedAt).toLocaleDateString('vi-VN')}</span>}
          </>
        ) : (
          <button onClick={connect} disabled={busy || !st?.appReady} style={{ ...primaryBtn, opacity: st?.appReady ? 1 : 0.5 }}>
            {busy ? '…' : 'Kết nối Pinterest'}
          </button>
        )}
        {st && !st.appReady && (
          <span style={{ fontSize: 12.5, color: 'var(--cfde68a)' }}>
            Chưa có <code style={code}>PINTEREST_APP_ID</code> / <code style={code}>PINTEREST_APP_SECRET</code> trên Render (service API).
          </span>
        )}
      </div>

      <div style={hintBox}>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.7 }}>
          <b>Setup một lần</b> — chỉ ba việc, không cần terminal:
          <br />1. Render → service API → Environment: đặt <code style={code}>PINTEREST_APP_ID</code> (App id trong console Pinterest{st?.appId ? `, hiện là ${st.appId}` : ''})
          và <code style={code}>PINTEREST_APP_SECRET</code> (App secret key — bấm Reset lấy cái mới nếu đã từng lộ). Không cần <code style={code}>PINTEREST_REFRESH_TOKEN</code> nữa.
          <br />2. Console Pinterest → app → <b>Redirect URIs</b> → thêm đúng y hệt dòng này:
          {st?.redirectUri && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, marginBottom: 4 }}>
              <div style={{ ...codeBox, flex: 1 }}>{st.redirectUri}</div>
              <button onClick={copyUri} style={{ ...ghost, padding: '5px 10px', fontSize: 12 }}>{copied ? '✓ Đã chép' : 'Chép'}</button>
            </div>
          )}
          3. Đăng nhập Pinterest bằng tài khoản Lumio trên trình duyệt này, rồi bấm <b>Kết nối Pinterest</b> → Pinterest hỏi cho phép → xong.
          <br />App đang ở <b>Trial access</b> vẫn kéo được Trends; nếu lần kéo báo 403 thì bấm <b>Upgrade access</b> trong console.
        </div>
      </div>
    </section>
  );
}

const card: CSSProperties = { background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 14, padding: 20, marginBottom: 18 };
const primaryBtn: CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const ghost: CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer', textDecoration: 'none', display: 'inline-block', fontFamily: 'inherit' };
const code: CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 6, padding: '2px 6px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--ca5b4fc)' };
const hintBox: CSSProperties = { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--c334155)' };
const codeBox: CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--ccbd5e1)', overflowX: 'auto', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace' };
