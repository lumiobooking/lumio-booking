'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { isVN } from '../lib/markets';

/**
 * Connect a Zalo OA to the bot.
 *
 * It lived under Settings → Notifications → SMS Việt Nam, beneath the ZNS
 * template ids, because that is where the first Zalo integration (ZNS) went
 * and this one was filed next to it. Nobody looking for "kết nối Zalo AI"
 * opens the SMS panel; they open the bot's page, find Facebook there, and
 * conclude Zalo does not exist. The OA is the bot's third mouth — same brain
 * as Messenger and Instagram — so it is drawn where the other two are.
 *
 * Drawn only for a salon that trades in Vietnam. A Texas salon has no OA and
 * a panel asking it for one reads as a bug.
 */
export function ZaloOaPanel({ token, embedded }: { token: string | null; embedded?: boolean }) {
  type Status = { market?: string; oauthReady?: boolean; oauthMissing?: string[]; apiHost?: string; connected: boolean; oaid: string; oaName?: string; appId?: string; tokenExpiresAt?: string | null };
  const [st, setSt] = useState<Status | null>(null);
  const [f, setF] = useState({ appId: '', appSecret: '', oaSecretKey: '', oaid: '', oaName: '', accessToken: '', refreshToken: '' });
  const [zMsg, setZMsg] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; text?: string }>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

  // Back from Zalo's screen: ?zalo=connected&oa=… or ?zalo=error&msg=…
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const z = q.get('zalo');
    if (!z) return;
    if (z === 'connected') setResult({ ok: true, text: `Đã kết nối Zalo OA${q.get('oa') ? ` · ${q.get('oa')}` : ''} — bot sẽ trả lời tin nhắn Zalo như Messenger.` });
    else {
      const m = q.get('msg') || '';
      const why: Record<string, string> = {
        invalid_state: 'Phiên kết nối không hợp lệ — bấm Kết nối lại từ đầu.',
        expired: 'Quá 10 phút — bấm Kết nối lại.',
        token_exchange: 'Zalo không cấp token. Kiểm tra app Lumio đã Kích hoạt và Callback Url đúng.',
        not_configured: 'Zalo chưa được cấu hình phía Lumio.',
        no_oa: 'Zalo không trả về OA nào — chọn đúng OA của tiệm khi Zalo hỏi.',
      };
      setResult({ ok: false, text: why[m] || `Kết nối thất bại (${m || 'unknown'}).` });
    }
    // Clear the query so a refresh does not replay the banner.
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const startOauth = async () => {
    setZMsg({ kind: 'busy' });
    try {
      const r = await apiFetch<{ url: string }>('/zalo/oauth/url', { token });
      window.location.assign(r.url);
    } catch (e) {
      setZMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Không mở được Zalo' });
    }
  };

  useEffect(() => {
    let alive = true;
    apiFetch<Status>('/zalo', { token })
      .then((r) => { if (!alive) return; setSt(r); setF((v) => ({ ...v, appId: r.appId ?? '', oaid: r.oaid ?? '', oaName: r.oaName ?? '' })); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [token]);

  if (!st || !isVN(st.market)) return null;

  const connect = async () => {
    setZMsg({ kind: 'busy' });
    try {
      const r = await apiFetch<{ connected: boolean; oaid: string }>('/zalo/connect', { method: 'POST', token, body: f });
      setSt((v) => ({ ...(v ?? { oaid: '' }), ...r }));
      setF((v) => ({ ...v, appSecret: '', oaSecretKey: '', accessToken: '', refreshToken: '' }));
      setZMsg({ kind: 'ok', text: 'Đã kết nối Zalo OA — bot sẽ trả lời tin nhắn Zalo như Messenger.' });
    } catch (e) {
      setZMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Kết nối thất bại' });
    }
  };
  const disconnect = async () => {
    setZMsg({ kind: 'busy' });
    try {
      await apiFetch('/zalo/disconnect', { method: 'POST', token });
      setSt((v) => ({ ...(v ?? { oaid: '' }), connected: false, oaid: '' }));
      setZMsg({ kind: 'ok', text: 'Đã ngắt kết nối.' });
    } catch (e) {
      setZMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Không ngắt được' });
    }
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label style={{ display: 'block' }}><span style={{ ...ui.label, minHeight: 30, display: 'block' }}>{label}</span>{children}</label>
  );

  const showForm = open || !st.connected;

  return (
    <div style={embedded ? { marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--c1e293b)' } : { ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--ce2e8f0)' }}>
          Kết nối Zalo OA
        </div>
        {st.connected
          ? <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>● Đã kết nối{st.oaName ? ` · ${st.oaName}` : ''}{st.oaid ? ` · OA ${st.oaid}` : ''}</span>
          : <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>chưa kết nối</span>}
        {st.connected && (
          <button onClick={() => setOpen((o) => !o)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 8, padding: '5px 10px', fontSize: 12.5, cursor: 'pointer' }}>
            {open ? 'Đóng' : 'Cập nhật / đổi token'}
          </button>
        )}
      </div>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: '6px 0 10px', lineHeight: 1.55 }}>
        Cùng bộ não AI đang trả lời Messenger và Instagram — thêm cái miệng Zalo. Khách nhắn Zalo OA của tiệm, bot tư vấn và chốt lịch;
        tin hiện trong cùng Hộp thư, nhân viên nhận chat y như Messenger.
      </p>

      {result && (
        <div style={{ background: result.ok ? '#052e1e' : 'var(--c7f1d1d)', color: result.ok ? 'var(--cbbf7d0)' : 'var(--cfecaca)', border: `1px solid ${result.ok ? '#10b981' : '#ef4444'}`, borderRadius: 9, padding: '9px 12px', fontSize: 13, marginBottom: 12 }}>
          {result.ok ? '✅ ' : '⚠️ '}{result.text}
        </div>
      )}

      {/* The path a salon takes: one button, Zalo's own screen, Đồng ý.
          Everything below the fold is for an app that is not Lumio's. */}
      {st.oauthReady && showForm && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={startOauth}
            disabled={zMsg.kind === 'busy'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 10, border: 'none', background: '#0068ff', color: '#fff', cursor: 'pointer', fontSize: 14.5, fontWeight: 800 }}
          >
            <span style={{ fontSize: 16 }}>Z</span>{zMsg.kind === 'busy' ? 'Đang mở Zalo…' : (st.connected ? 'Kết nối lại Zalo OA' : 'Kết nối Zalo OA')}
          </button>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 8, lineHeight: 1.55 }}>
            Zalo sẽ hỏi đăng nhập bằng tài khoản <b>quản trị OA</b> của tiệm → chọn OA → bấm <b>Đồng ý</b>. Không cần dán mã hay token gì cả.
          </div>
          {zMsg.kind === 'err' && <p style={{ color: '#ef4444', fontSize: 13, margin: '6px 0 0' }}>{zMsg.text}</p>}
          <button onClick={() => setAdvanced((a) => !a)} style={{ background: 'transparent', border: 'none', color: 'var(--c64748b)', fontSize: 12, cursor: 'pointer', padding: '8px 0 0' }}>
            {advanced ? '▾' : '▸'} Nhập thủ công (nâng cao — dùng app Zalo riêng)
          </button>
        </div>
      )}

      {showForm && (!st.oauthReady || advanced) && (
        <>
          {!st.oauthReady && (
            <div style={{ fontSize: 12.5, color: '#fbbf24', marginBottom: 10, lineHeight: 1.6 }}>
              Kết nối một nút chưa bật. Server <code>{st.apiHost || '?'}</code> chưa thấy biến:{' '}
              <code>{(st.oauthMissing?.length ? st.oauthMissing : ['ZALO_APP_ID', 'ZALO_APP_SECRET']).join(', ')}</code>
              {' '}— thêm vào Render → service có đúng tên miền đó → Environment → Save, rồi tải lại trang này. Tạm thời có thể nhập thủ công bên dưới.
            </div>
          )}
          <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c1e293b)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Lấy 6 giá trị ở đâu — làm theo thứ tự:</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li><b>developers.zalo.me</b> → Tạo ứng dụng (loại Official Account) → lấy <b>App ID</b> và <b>App Secret Key</b>.</li>
              <li>Trong app đó → <b>Official Account</b> → Liên kết OA của tiệm (chủ OA bấm chấp nhận trong OA Manager → Quản lý → Quản lý liên kết).</li>
              <li>App → <b>Webhook</b>: dán URL bên dưới, tick sự kiện <i>user_send_text</i>, lấy <b>OA Secret Key</b>.</li>
              <li>App → <b>Công cụ khai thác API</b> (API Explorer) → chọn OA → lấy <b>Access token</b> và <b>Refresh token</b>.</li>
            </ol>
            <div style={{ marginTop: 6 }}>URL webhook: <code style={{ fontSize: 11.5, wordBreak: 'break-all', color: '#a5b4fc' }}>{`${apiBase}/public/zalo/webhook`}</code></div>
          </div>
          {/* Chrome read this grid as a login form and filled App ID with the
              person's email and the secret with their password. The names
              and autocomplete values below are what stops it. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label="App ID"><input style={ui.input} name="zalo-app-id" autoComplete="off" inputMode="numeric" value={f.appId} onChange={(e) => setF({ ...f, appId: e.target.value })} /></Field>
            <Field label="App Secret Key"><input style={ui.input} type="password" name="zalo-app-secret" autoComplete="new-password" value={f.appSecret} onChange={(e) => setF({ ...f, appSecret: e.target.value })} placeholder={st.connected ? 'Đã lưu' : ''} /></Field>
            <Field label="OA Secret Key (webhook)"><input style={ui.input} type="password" name="zalo-oa-secret" autoComplete="new-password" value={f.oaSecretKey} onChange={(e) => setF({ ...f, oaSecretKey: e.target.value })} placeholder={st.connected ? 'Đã lưu' : ''} /></Field>
            <Field label="OA ID"><input style={ui.input} name="zalo-oa-id" autoComplete="off" inputMode="numeric" value={f.oaid} onChange={(e) => setF({ ...f, oaid: e.target.value })} /></Field>
            <Field label="Tên OA (tùy chọn)"><input style={ui.input} name="zalo-oa-name" autoComplete="off" value={f.oaName} onChange={(e) => setF({ ...f, oaName: e.target.value })} placeholder="Tiệm Nail ABC" /></Field>
            <Field label="Access token"><input style={ui.input} type="password" name="zalo-access-token" autoComplete="new-password" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} placeholder={st.connected ? 'Đã lưu' : ''} /></Field>
            <Field label="Refresh token"><input style={ui.input} type="password" name="zalo-refresh-token" autoComplete="new-password" value={f.refreshToken} onChange={(e) => setF({ ...f, refreshToken: e.target.value })} placeholder={st.connected ? 'Đã lưu' : ''} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              style={{ padding: '9px 14px', borderRadius: 8, border: 'none', background: '#0068ff', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              disabled={zMsg.kind === 'busy'}
              onClick={connect}
            >{zMsg.kind === 'busy' ? 'Đang xử lý…' : (st.connected ? 'Cập nhật kết nối' : 'Kết nối Zalo OA')}</button>
            {st.connected && (
              <button
                style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer', fontSize: 13 }}
                disabled={zMsg.kind === 'busy'}
                onClick={disconnect}
              >Ngắt kết nối</button>
            )}
          </div>
        </>
      )}
      {zMsg.kind === 'ok' && <p style={{ color: '#22c55e', fontSize: 13, margin: '6px 0 0' }}>{zMsg.text}</p>}
      {zMsg.kind === 'err' && (!st.oauthReady || advanced) && <p style={{ color: '#ef4444', fontSize: 13, margin: '6px 0 0' }}>{zMsg.text}</p>}
    </div>
  );
}
