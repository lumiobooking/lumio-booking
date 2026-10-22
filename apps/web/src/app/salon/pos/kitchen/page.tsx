'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useLang } from '../../../../lib/i18n';
import { ticketTone, tillError } from '../../../../lib/restaurant-till';

/**
 * THE KITCHEN SCREEN (KDS). A tablet on the pass instead of (or as well as)
 * paper tickets: every dish sent from the till or a table QR, one card per
 * table and send round, oldest first. The cook taps a dish when it is done
 * (or "all done" for the card); the card leaves the screen, the server's bill
 * shows "✓ Ready", and "Just done" keeps it for 30 minutes in case it was a
 * mis-tap. Dishes cancelled after sending stay struck through for 15 minutes
 * so nobody keeps cooking them. Each station (Kitchen, Bar…) can show only
 * its own dishes. Everything is the restaurant's own data, tenant-scoped on
 * the server.
 */

interface KLine { id: string; name: string; quantity: number; note: string | null; options: string[]; station: string; state: string; readyAt: string | null; voidReason: string | null }
interface Ticket { key: string; checkId: string; number: number; label: string; takeaway: boolean; guests: number; server: string | null; batch: number; sentAt: string | null; lines: KLine[]; readyAt?: string }
interface Board { stations: { key: string; name: string }[]; warnMinutes: number; tickets: Ticket[]; done: Ticket[] }

const C = { panel: 'var(--c0f172a)', raised: 'var(--c1e293b)', line: 'var(--line)', border: 'var(--c334155)', text: 'var(--ce2e8f0)', strong: 'var(--cf1f5f9)', muted: 'var(--c94a3b8)' };
const btn: CSSProperties = { minHeight: 44, padding: '0 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' };
const chip = (on: boolean): CSSProperties => (on
  ? { ...btn, minHeight: 40, borderRadius: 999, border: 'none', background: '#4f46e5', color: '#fff' }
  : { ...btn, minHeight: 40, borderRadius: 999 });
const STATION_KEY = 'lumio_kds_station';

export default function KitchenPage() {
  return <SalonShell><Kitchen /></SalonShell>;
}

function Kitchen() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const [board, setBoard] = useState<Board | null>(null);
  const [station, setStation] = useState<string>(() => { try { return localStorage.getItem(STATION_KEY) ?? ''; } catch { return ''; } });
  const [now, setNow] = useState(() => new Date());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  const beep = useCallback(() => {
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.25);
      setTimeout(() => { void ctx.close(); }, 600);
    } catch { /* no audio */ }
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const b = await apiFetch<Board>(`/restaurant/kitchen${station ? `?station=${encodeURIComponent(station)}` : ''}`, { token });
      setBoard(b); setErr('');
      const keys = new Set(b.tickets.map((t) => t.key));
      if (seen.current && sound && [...keys].some((k) => !seen.current!.has(k))) beep();
      seen.current = keys;
    } catch (e) { setErr(tillError(e instanceof ApiError || e instanceof Error ? e.message : String(e), vi)); }
  }, [token, station, sound, beep, vi]);

  useEffect(() => { seen.current = null; void load(); }, [station]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => { setNow(new Date()); void load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  function pickStation(k: string) {
    setStation(k);
    try { localStorage.setItem(STATION_KEY, k); } catch { /* private mode */ }
  }

  async function mark(ids: string[], ready: boolean) {
    if (!token || !ids.length) return;
    setBusy(true);
    try {
      await apiFetch('/restaurant/kitchen/ready', { method: 'POST', token, body: { lineIds: ids, ready } });
      await load();
    } catch (e) { setErr(tillError(e instanceof Error ? e.message : String(e), vi)); }
    finally { setBusy(false); }
  }

  function fullscreen() {
    try { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); } catch { /* not allowed */ }
  }

  const stationName = (k: string) => board?.stations.find((s) => s.key === k)?.name ?? k;
  const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '');
  const tickets = board?.tickets ?? [];
  const late = board?.warnMinutes ?? 15;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: C.text }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: '10px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: C.strong }}>{L('Màn hình bếp', 'Kitchen screen')}</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>{L(`${tickets.length} phiếu đang làm · chạm món khi xong`, `${tickets.length} tickets cooking · tap a dish when it is done`)}</div>
        </div>
        <button type="button" onClick={() => pickStation('')} style={chip(!station)}>{L('Tất cả', 'All')}</button>
        {(board?.stations ?? []).map((s) => <button key={s.key} type="button" onClick={() => pickStation(s.key)} style={chip(station === s.key)}>{s.name}</button>)}
        <button type="button" aria-pressed={sound} onClick={() => setSound((x) => !x)} style={btn}>{sound ? L('Chuông: bật', 'Sound: on') : L('Chuông: tắt', 'Sound: off')}</button>
        <button type="button" onClick={fullscreen} style={btn}>{L('Toàn màn hình', 'Full screen')}</button>
        <a href="/salon/pos" style={{ ...btn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>‹ {L('Thu ngân', 'Till')}</a>
      </div>
      {err && <div role="alert" style={{ padding: '10px 14px', borderRadius: 12, fontWeight: 700, background: 'var(--c450a0a)', color: 'var(--cfca5a5)' }}>{err}</div>}
      {!board && !err && <p style={{ color: C.muted }}>{L('Đang tải…', 'Loading…')}</p>}
      {board && tickets.length === 0 && (
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 30, textAlign: 'center', color: C.muted, fontSize: 16 }}>
          {L('Không có món nào đang chờ. Món báo bếp từ thu ngân hoặc QR sẽ hiện ở đây.', 'Nothing waiting. Dishes sent from the till or a table QR show up here.')}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10, alignItems: 'start' }}>
        {tickets.map((t) => {
          const { mins, tone } = ticketTone(t.sentAt, now, late);
          const cooking = t.lines.filter((l) => l.state === 'SENT' && !l.readyAt);
          const head: CSSProperties = tone === 'late' ? { background: '#b91c1c', color: '#fff' } : tone === 'warn' ? { background: '#f59e0b', color: '#1c1917' } : { background: '#4f46e5', color: '#fff' };
          return (
            <article key={t.key} aria-label={t.label} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <header style={{ ...head, padding: '8px 12px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <b style={{ fontSize: 19, flex: 1, minWidth: 0 }}>{t.takeaway ? t.label : `${L('Bàn', 'Table')} ${t.label}`}</b>
                <span style={{ fontWeight: 800, fontSize: 16 }}>{mins}′</span>
              </header>
              <div style={{ padding: '4px 12px', fontSize: 12, color: C.muted, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span>#{t.number}{t.batch ? ` · ${L('lần', 'round')} ${t.batch}` : ''}{t.server ? ` · ${t.server}` : ''}</span>
                <span>{clock(t.sentAt)}</span>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {t.lines.map((l) => {
                  const voided = l.state === 'VOID';
                  const done = !!l.readyAt;
                  return (
                    <li key={l.id}>
                      <button type="button" disabled={busy || voided} onClick={() => void mark([l.id], !done)}
                        style={{ width: '100%', textAlign: 'left', minHeight: 48, padding: '6px 8px', borderRadius: 10, border: `1px solid ${voided ? '#b91c1c' : C.line}`, background: done ? C.raised : C.panel, color: voided ? 'var(--ink-bad)' : done ? C.muted : C.text, cursor: voided ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <b style={{ fontSize: 18, minWidth: 30, textDecoration: voided || done ? 'line-through' : undefined }}>{l.quantity}×</b>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <b style={{ fontSize: 16, textDecoration: voided || done ? 'line-through' : undefined }}>{l.name}</b>
                          {!station && <span style={{ fontSize: 11, color: C.muted }}> · {stationName(l.station)}</span>}
                          {l.options.length > 0 && <><br /><span style={{ fontSize: 13.5 }}>+ {l.options.join(', ')}</span></>}
                          {l.note && <><br /><span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-warn)' }}>“{l.note}”</span></>}
                          {voided && <><br /><span style={{ fontSize: 12.5, fontWeight: 800 }}>{L('HUỶ', 'CANCELLED')}{l.voidReason ? ` · ${l.voidReason}` : ''}</span></>}
                        </span>
                        {done && !voided && <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-good)' }}>✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" disabled={busy || cooking.length === 0} onClick={() => void mark(cooking.map((l) => l.id), true)}
                style={{ margin: '0 8px 8px', minHeight: 48, borderRadius: 12, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>
                {L(`Xong cả phiếu · ${cooking.length} món`, `All done · ${cooking.length}`)}
              </button>
            </article>
          );
        })}
      </div>
      {board && board.done.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" onClick={() => setShowDone((x) => !x)} style={{ ...btn, alignSelf: 'flex-start' }}>
            {showDone ? '▾' : '▸'} {L(`Vừa xong (${board.done.length}) · bấm “Làm lại” nếu chạm nhầm`, `Just done (${board.done.length}) · “Undo” if it was a mis-tap`)}
          </button>
          {showDone && board.done.map((t) => (
            <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, background: C.raised, flexWrap: 'wrap' }}>
              <b style={{ minWidth: 90 }}>{t.takeaway ? t.label : `${L('Bàn', 'Table')} ${t.label}`}</b>
              <span style={{ flex: 1, minWidth: 0, color: C.muted, fontSize: 13 }}>{t.lines.filter((l) => l.state === 'SENT').map((l) => `${l.quantity}× ${l.name}`).join(', ')}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{clock(t.readyAt)}</span>
              <button type="button" disabled={busy} onClick={() => void mark(t.lines.filter((l) => l.state === 'SENT' && l.readyAt).map((l) => l.id), false)} style={btn}>{L('Làm lại', 'Undo')}</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
