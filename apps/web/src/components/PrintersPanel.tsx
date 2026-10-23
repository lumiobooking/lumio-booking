'use client';

/**
 * PRINTERS — one-touch setup.
 *
 * The shop needs one Windows computer with the printers plugged in (USB) or on
 * the network. "Add a computer" gives one line to paste into Windows' Run box
 * (Win + R) — or a message to send the shop on Zalo, or a small .bat file.
 * That is all the shop does. The computer then shows up here with the printers
 * it found, and the owner (or Lumio support, from far away) picks which
 * printer prints the bills and which the kitchen tickets, and presses "Test".
 * Everything is the business's own; the server checks it.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';

interface Route { printer?: string; host?: string; port?: number; beep?: boolean }
interface Device {
  id: string; name: string; paired: boolean; pairExpiresAt: string | null; online: boolean; lastSeenAt: string | null;
  printers: string[]; defaultPrinter: string | null; routes: Record<string, Route>; upToDate: boolean;
}
interface Listing { version: string; pendingJobs: number; stations: { key: string; name: string }[]; devices: Device[] }
interface Installer { id: string; code: string; expiresAt: string; url: string; runLine: string }

const C = { panel: 'var(--c0f172a)', raised: 'var(--c1e293b)', line: 'var(--line)', border: 'var(--c334155)', text: 'var(--ce2e8f0)', strong: 'var(--cf1f5f9)', muted: 'var(--c94a3b8)' };
const btn: CSSProperties = { minHeight: 40, padding: '0 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' };
const primary: CSSProperties = { ...btn, border: 'none', background: '#4f46e5', color: '#fff' };
const field: CSSProperties = { minHeight: 40, borderRadius: 10, border: `1px solid ${C.border}`, padding: '0 10px', background: C.panel, color: C.text, fontSize: 14, fontFamily: 'inherit' };
const card: CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 };

/** The select value for a route, and back. */
const valueOf = (r?: Route) => (!r ? '' : r.host ? 'net' : r.printer ? `p:${r.printer}` : 'default');
function routeFrom(v: string, prev?: Route): Route | null {
  if (!v) return null;
  if (v === 'default') return { printer: '' };
  if (v === 'net') return { host: prev?.host ?? '', port: prev?.port ?? 9100, beep: prev?.beep ?? true };
  return { printer: v.slice(2) };
}

export function PrintersPanel() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const [data, setData] = useState<Listing | null>(null);
  const [inst, setInst] = useState<Installer | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await apiFetch<Listing>('/print-devices', { token })); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);
  // The computer that used the code has arrived: the setup box has done its job.
  useEffect(() => {
    if (inst && data?.devices.some((d) => d.id === inst.id && d.paired)) {
      setInst(null);
      setMsg(L('Đã kết nối máy tính. Chọn máy in cho từng loại phiếu rồi bấm “In thử”.', 'Computer connected. Pick a printer for each kind of ticket, then press “Test”.'));
    }
  }, [data, inst]); // eslint-disable-line react-hooks/exhaustive-deps

  async function newInstaller() {
    if (!token) return;
    setBusy(true); setErr('');
    try { setInst(await apiFetch<Installer>('/print-devices/installer', { method: 'POST', token })); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const devices = (data?.devices ?? []).filter((d) => d.paired);
  const anyOnline = devices.some((d) => d.online);

  return (
    <section style={{ ...card, marginBottom: 18 }}>
      <div>
        <b style={{ fontSize: 17, color: C.strong }}>🖨️ {L('Máy in', 'Printers')}</b>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
          {L('In hoá đơn, phiếu tạm tính và phiếu bếp ra máy in ở tiệm. Cần một máy tính Windows có cắm máy in (USB hoặc qua mạng). Cài một lần, không cần cài thêm phần mềm.', 'Print bills, guest checks and kitchen tickets at the shop. Needs one Windows computer with the printers (USB or network). Set up once; nothing else to install.')}
        </div>
      </div>
      {err && <div role="alert" style={{ color: 'var(--ink-bad)', fontWeight: 700, fontSize: 13.5 }}>{err}</div>}
      {msg && <div role="status" style={{ color: 'var(--ink-good)', fontWeight: 700, fontSize: 13.5 }}>{msg}</div>}
      {data && data.pendingJobs > 0 && !anyOnline && (
        <div style={{ color: 'var(--ink-warn)', fontWeight: 700, fontSize: 13.5 }}>
          {L(`${data.pendingJobs} phiếu đang chờ in nhưng chưa có máy tính nào đang chạy.`, `${data.pendingJobs} tickets waiting, but no computer is running.`)}
        </div>
      )}
      {devices.map((d) => <DeviceCard key={d.id} d={d} stations={data?.stations ?? []} vi={vi} token={token} onChanged={load} />)}
      {inst ? <InstallBox inst={inst} vi={vi} busy={busy} onNew={() => void newInstaller()} onClose={() => setInst(null)} />
        : (
          <button type="button" disabled={busy} onClick={() => void newInstaller()} style={{ ...primary, alignSelf: 'flex-start', minHeight: 44 }}>
            + {devices.length ? L('Thêm máy tính', 'Add a computer') : L('Kết nối máy in', 'Connect a printer')}
          </button>
        )}
    </section>
  );
}

function InstallBox({ inst, vi, busy, onNew, onClose }: { inst: Installer; vi: boolean; busy: boolean; onNew: () => void; onClose: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [copied, setCopied] = useState('');
  const until = new Date(inst.expiresAt).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  const zalo = vi
    ? `Nhờ anh/chị làm giúp trên máy tính có cắm máy in:\n1. Nhấn phím Windows + R\n2. Dán dòng dưới đây vào ô hiện ra, bấm Enter:\n${inst.runLine}\n3. Thấy chữ "Da cai xong" là xong ạ.`
    : `On the computer with the printer, please:\n1. Press Windows + R\n2. Paste the line below into the box and press Enter:\n${inst.runLine}\n3. When it says "Da cai xong", you are done.`;
  function copy(text: string, what: string) {
    try { void navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 2500); } catch { /* no clipboard */ }
  }
  function download() {
    const blob = new Blob([`@echo off\r\n${inst.runLine}\r\n`], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Lumio-Print-cai-dat.bat';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  return (
    <div style={{ border: '2px solid #4f46e5', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b style={{ color: C.strong }}>{L('Cài trên máy tính có cắm máy in', 'On the computer with the printer')}</b>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
        <li>{L('Nhấn phím', 'Press')} <kbd style={{ padding: '1px 6px', borderRadius: 6, border: `1px solid ${C.border}` }}>⊞ Windows</kbd> + <kbd style={{ padding: '1px 6px', borderRadius: 6, border: `1px solid ${C.border}` }}>R</kbd></li>
        <li>
          {L('Dán dòng này vào ô hiện ra, bấm Enter:', 'Paste this line into the box and press Enter:')}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <code style={{ flex: '1 1 260px', minWidth: 0, padding: '8px 10px', borderRadius: 10, background: C.raised, fontSize: 12, wordBreak: 'break-all' }}>{inst.runLine}</code>
            <button type="button" onClick={() => copy(inst.runLine, 'line')} style={btn}>{copied === 'line' ? L('Đã chép ✓', 'Copied ✓') : L('Chép', 'Copy')}</button>
          </div>
        </li>
        <li>{L('Cửa sổ hiện “Da cai xong” là xong. Máy tính sẽ tự hiện ở đây sau vài giây.', 'When the window says “Da cai xong”, it is done. The computer shows up here in a few seconds.')}</li>
      </ol>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => copy(zalo, 'zalo')} style={btn}>{copied === 'zalo' ? L('Đã chép ✓', 'Copied ✓') : L('Chép tin nhắn gửi khách (Zalo)', 'Copy a message for the shop')}</button>
        <button type="button" onClick={download} style={btn}>{L('Tải file cài đặt (.bat)', 'Download setup file (.bat)')}</button>
        <button type="button" disabled={busy} onClick={onNew} style={btn}>{L('Tạo mã mới', 'New code')}</button>
        <button type="button" onClick={onClose} style={btn}>{L('Đóng', 'Close')}</button>
      </div>
      <span style={{ fontSize: 12.5, color: C.muted }}>
        {L(`Mã dùng một lần, hết hạn lúc ${until}. Không cần quyền quản trị; nếu Windows hỏi, bấm “Có/Run”. Đang chờ máy tính kết nối…`, `Single use, expires at ${until}. No admin rights needed; if Windows asks, press “Run”. Waiting for the computer…`)}
      </span>
    </div>
  );
}

function DeviceCard({ d, stations, vi, token, onChanged }: { d: Device; stations: { key: string; name: string }[]; vi: boolean; token: string | null; onChanged: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [routes, setRoutes] = useState<Record<string, Route>>(d.routes);
  const [dirty, setDirty] = useState(false);
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { if (!dirty) setRoutes(d.routes); }, [d.routes, dirty]);

  const keys = [...stations.map((s) => s.key), '*'];
  const label = (k: string) => (k === 'COUNTER' ? L('Hoá đơn & phiếu tạm tính', 'Bills & guest checks')
    : k === '*' ? L('Mọi phiếu còn lại', 'Everything else')
      : stations.find((s) => s.key === k)?.name ?? k);
  const set = (k: string, r: Route | null) => {
    setRoutes((xs) => { const n = { ...xs }; if (r) n[k] = r; else delete n[k]; return n; });
    setDirty(true);
  };
  async function save() {
    if (Object.values(routes).some((r) => r.host !== undefined && !/^[A-Za-z0-9.-]{3,}$/.test(r.host))) {
      setNote(L('Nhập địa chỉ IP của máy in mạng (VD: 192.168.1.50).', 'Type the network printer’s IP (e.g. 192.168.1.50).'));
      return;
    }
    try {
      await apiFetch(`/print-devices/${d.id}`, { method: 'PATCH', token, body: { routes } });
      setDirty(false); setNote(L('Đã lưu.', 'Saved.')); onChanged();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
  }
  async function test(k: string) {
    try {
      if (dirty) await save();
      await apiFetch(`/print-devices/${d.id}/test`, { method: 'POST', token, body: { route: k } });
      setNote(L(`Đã gửi phiếu in thử (${label(k)}). Phiếu ra trong vài giây.`, `Test sent (${label(k)}). It prints in a few seconds.`));
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
  }
  async function remove() {
    if (!sure) { setSure(true); return; }
    try { await apiFetch(`/print-devices/${d.id}`, { method: 'DELETE', token }); onChanged(); }
    catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
  }
  const last = d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: C.raised }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15.5, color: C.strong }}>💻 {d.name || 'PC'}</b>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: d.online ? 'var(--ink-good)' : 'var(--ink-bad)' }}>
          ● {d.online ? L('Đang chạy', 'Running') : L(`Mất kết nối${last ? ` · lần cuối ${last}` : ''}`, `Offline${last ? ` · last ${last}` : ''}`)}
        </span>
        {d.online && !d.upToDate && <span style={{ fontSize: 12, color: C.muted }}>{L('đang tự cập nhật…', 'updating itself…')}</span>}
      </div>
      {!d.online && <span style={{ fontSize: 12.5, color: C.muted }}>{L('Kiểm tra máy tính đã bật và có mạng. Lumio Print tự chạy khi mở máy.', 'Check the computer is on and online. Lumio Print starts with Windows.')}</span>}
      <span style={{ fontSize: 12.5, color: d.printers.length ? C.muted : 'var(--ink-warn)' }}>
        {d.printers.length ? `${L('Máy in tìm thấy', 'Printers found')}: ${d.printers.join(', ')}` : L('Chưa thấy máy in nào trên máy tính này. Cài driver máy in (hoặc dùng máy in mạng bên dưới).', 'No printer on this computer yet. Install the printer driver (or use a network printer below).')}
      </span>
      {keys.map((k) => {
        const r = routes[k];
        const v = valueOf(r);
        return (
          <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 170px', fontWeight: 600, fontSize: 13.5 }}>{label(k)}</span>
            <select value={v} aria-label={label(k)} onChange={(e) => set(k, routeFrom(e.target.value, r))} style={{ ...field, flex: '2 1 220px' }}>
              <option value="">{L('— Không in ở máy này', '— Not on this computer')}</option>
              <option value="default">{L('Máy in mặc định', 'Default printer')}{d.defaultPrinter ? ` (${d.defaultPrinter})` : ''}</option>
              {d.printers.map((p) => <option key={p} value={`p:${p}`}>{p}</option>)}
              {r?.printer && !d.printers.includes(r.printer) && <option value={`p:${r.printer}`}>{r.printer}</option>}
              <option value="net">{L('Máy in mạng (nhập IP)…', 'Network printer (IP)…')}</option>
            </select>
            {r?.host !== undefined && (
              <>
                <input value={r.host ?? ''} placeholder="192.168.1.50" inputMode="decimal" aria-label="IP" onChange={(e) => set(k, { ...r, host: e.target.value.trim() })} style={{ ...field, width: 140 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
                  <input type="checkbox" checked={!!r.beep} onChange={(e) => set(k, { ...r, beep: e.target.checked })} />{L('Kêu bíp', 'Beep')}
                </label>
              </>
            )}
            <button type="button" disabled={!r || !d.online} onClick={() => void test(k)} style={{ ...btn, opacity: !r || !d.online ? 0.5 : 1 }}>{L('In thử', 'Test')}</button>
          </div>
        );
      })}
      <span style={{ fontSize: 12, color: C.muted }}>
        {L('Máy in USB / cài driver: in có dấu, tên bàn chữ to. Máy in mạng (IP): không cần driver, tự cắt giấy, kêu bíp, nhưng in không dấu.', 'USB / driver printers: Vietnamese accents, large table name. Network (IP) printers: no driver, auto-cut, beep, but no accents.')}
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {dirty && <button type="button" onClick={() => void save()} style={primary}>{L('Lưu', 'Save')}</button>}
        <button type="button" onClick={() => void remove()} style={{ ...btn, color: 'var(--ink-bad)', ...(sure ? { borderColor: '#b91c1c' } : {}) }}>
          {sure ? L('Chắc chắn gỡ? Máy này sẽ ngừng in', 'Remove? It stops printing') : L('Gỡ máy này', 'Remove')}
        </button>
        {note && <span style={{ fontSize: 13, color: C.muted }}>{note}</span>}
      </div>
    </div>
  );
}
