'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/**
 * Super Admin: the Drive archive, connected once.
 *
 * One button, one account. The agency's own Google signs in, the app makes a
 * "Lumio Booking" folder in that Drive and a folder per salon under it, and
 * every file a salon sends lands in its own folder with a readable name. The
 * scope is the narrowest Google offers (`drive.file`: only what this app
 * created), which is why the folders are made by the app and not by hand.
 */

interface Status {
  connected: boolean;
  email: string | null;
  rootFolderUrl: string | null;
  clientReady: boolean;
  redirectUri: string;
}

export function GoogleDriveCard({ token, onSaveClient }: {
  token: string | null;
  /** Save a client id/secret into platform config, when the env vars are not set. */
  onSaveClient: (id: string, secret: string) => Promise<void>;
}) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cid, setCid] = useState('');
  const [csec, setCsec] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setSt(await apiFetch<Status>('/storage/gdrive/status', { token }).catch(() => null));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Google bounced the browser back here with a verdict in the query string.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const v = q.get('gdrive');
    if (!v) return;
    setMsg(v === 'ok'
      ? { ok: true, text: 'Đã kết nối Google Drive. Folder "Lumio Booking" đã được tạo trong Drive của tài khoản vừa đăng nhập.' }
      : { ok: false, text: `Google không cho kết nối (${q.get('msg') ?? 'lỗi'}). Kiểm tra Client ID/Secret và Redirect URI rồi thử lại.` });
    const url = new URL(window.location.href);
    url.searchParams.delete('gdrive'); url.searchParams.delete('msg');
    window.history.replaceState({}, '', url.toString());
  }, []);

  async function connect() {
    if (!token) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ url: string }>('/storage/gdrive/auth-url', { token });
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
      await apiFetch('/storage/gdrive/disconnect', { method: 'POST', token });
      setMsg({ ok: true, text: 'Đã ngắt. File đã lưu vẫn còn nguyên trong Drive; chỉ không sao lưu thêm nữa.' });
      await load();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'error' }); }
    finally { setBusy(false); }
  }

  async function saveClient() {
    setBusy(true); setMsg(null);
    try {
      await onSaveClient(cid.trim(), csec.trim());
      setCid(''); setCsec('');
      setMsg({ ok: true, text: 'Đã lưu Client ID/Secret.' });
      await load();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'error' }); }
    finally { setBusy(false); }
  }

  return (
    <section id="google-drive" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>📁 Google Drive — kho lưu file tiệm gửi</h2>
        {st && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: st.connected ? 'rgba(34,197,94,.14)' : 'var(--c0f172a)',
            border: `1px solid ${st.connected ? '#22c55e' : 'var(--c475569)'}`,
            color: st.connected ? '#86efac' : 'var(--c94a3b8)',
          }}>
            {st.connected ? `Đã kết nối${st.email ? ` — ${st.email}` : ''}` : 'Chưa kết nối'}
          </span>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.6, margin: '0 0 12px' }}>
        Ảnh và clip tiệm gửi qua thẻ đề xuất vẫn lên kho FTP để đăng bài; bản sao đi vào Drive của Lumio,
        mỗi tiệm một folder đặt theo tên tiệm, file đặt tên theo ngày và việc. Anh và nhân viên mở Drive là thấy.
      </p>

      {msg && (
        <div style={{
          marginBottom: 12, padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.6,
          background: msg.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          color: msg.ok ? 'var(--c4ade80)' : 'var(--cfca5a5)',
        }}>{msg.text}</div>
      )}

      {st?.connected ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {st.rootFolderUrl && (
            <a href={st.rootFolderUrl} target="_blank" rel="noopener noreferrer" style={{ ...ghost, borderColor: '#6366f1', color: 'var(--ca5b4fc)' }}>
              Mở folder "Lumio Booking" →
            </a>
          )}
          <button onClick={disconnect} disabled={busy} style={{ ...ghost, color: 'var(--cf87171)' }}>Ngắt kết nối</button>
        </div>
      ) : (
        <>
          {st && !st.clientReady && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, color: 'var(--cfde68a)', marginBottom: 8, lineHeight: 1.6 }}>
                Chưa có Google Client ID/Secret. Nếu Render đã có <code style={code}>GOOGLE_CLIENT_ID</code> / <code style={code}>GOOGLE_CLIENT_SECRET</code>
                (hoặc <code style={code}>GBP_CLIENT_ID</code> / <code style={code}>GBP_CLIENT_SECRET</code> của Google Business Profile) thì không cần điền — tải lại trang.
                Không thì dán vào đây:
              </div>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                <input style={inp} value={cid} onChange={(e) => setCid(e.target.value)} placeholder="Client ID (…apps.googleusercontent.com)" />
                <input style={inp} value={csec} onChange={(e) => setCsec(e.target.value)} placeholder="Client secret" type="password" />
              </div>
              <button onClick={saveClient} disabled={busy || !cid || !csec} style={{ ...ghost, marginTop: 6 }}>Lưu Client ID/Secret</button>
            </div>
          )}
          <button onClick={connect} disabled={busy || !st?.clientReady} style={{ ...primaryBtn, opacity: st?.clientReady ? 1 : 0.5 }}>
            {busy ? '…' : 'Kết nối Google Drive'}
          </button>
        </>
      )}

      <div style={hintBox}>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.7 }}>
          <b>Setup một lần trên Google Cloud</b> (cùng project với Google Business Profile):
          <br />1. APIs &amp; Services → Library → bật <b>Google Drive API</b>.
          <br />2. Credentials → OAuth client đang dùng → Authorized redirect URIs → thêm:
          {st?.redirectUri && (
            <div style={{ ...codeBox, marginTop: 4, marginBottom: 4 }}>{st.redirectUri}</div>
          )}
          3. OAuth consent screen → Publishing status = <b>In production</b>. Quyền xin là <code style={code}>drive.file</code> — loại không nhạy cảm,
          Google không bắt xét duyệt; nếu để "Testing" thì phiên hết hạn sau 7 ngày và phải kết nối lại.
          <br />4. Bấm <b>Kết nối Google Drive</b> → Google hỏi chọn tài khoản → chọn <b>tài khoản Google riêng dành làm kho lưu trữ</b>
          (không cần là tài khoản đang đăng nhập Chrome, cũng không cần cùng tài khoản với Google Cloud).
          Tài khoản đó sẽ là chủ của folder "Lumio Booking" và mọi file bên trong — dung lượng 15GB tính vào Drive của nó.
          Kết nối xong, email hiện ở góc trên thẻ này: kiểm tra đúng tài khoản kho rồi mới thôi.
        </div>
      </div>
    </section>
  );
}

const card: React.CSSProperties = { background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 14, padding: 20, marginBottom: 18 };
const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 14, marginBottom: 0 };
const primaryBtn: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const ghost: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
const code: React.CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 6, padding: '2px 6px', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--ca5b4fc)' };
const hintBox: React.CSSProperties = { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--c334155)' };
const codeBox: React.CSSProperties = { background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--ccbd5e1)', overflowX: 'auto', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace' };
