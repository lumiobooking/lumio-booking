'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

interface MyProfile {
  id: string; firstName: string; lastName: string | null;
  email: string | null; phone: string | null; avatarUrl: string | null;
  tipQrUrl: string | null; tipHandle: string | null;
}

// Fit an uploaded image (the tip QR) fully onto a white square so it stays sharp
// and scannable — never cropped like an avatar.
function fileToQrDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image'));
      img.onload = () => {
        const SIZE = 460;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, SIZE, SIZE);
        const scale = Math.min(SIZE / img.width, SIZE / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function StaffTipsPage() {
  return (
    <StaffShell title="Tips">
      <Inner />
    </StaffShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const [p, setP] = useState<MyProfile | null>(null);
  const [handle, setHandle] = useState('');
  const [qr, setQr] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const r = await apiFetch<MyProfile>('/staff/me', { token });
      setP(r); setHandle(r.tipHandle ?? ''); setQr(r.tipQrUrl ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function pickQr(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image file'); return; }
    setBusy(true); setError(null);
    try { setQr(await fileToQrDataUrl(file)); }
    catch { setError('Could not process that image'); }
    finally { setBusy(false); }
  }

  async function save() {
    setSaving(true); setError(null); setMsg(null);
    try {
      await apiFetch('/staff/me', { method: 'PATCH', token, body: { tipQrUrl: qr, tipHandle: handle.trim() || undefined } });
      setMsg('Saved! Your tip QR is ready to show clients.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }

  if (loading) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  const name = [p?.firstName, p?.lastName].filter(Boolean).join(' ').trim() || 'Me';
  const ready = !!(qr || handle.trim());

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}

      <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 16px', textAlign: 'center' }}>
        When a client wants to tip you, tap <b style={{ color: '#e2e8f0' }}>Show to client</b> and turn your phone toward them to scan. Money goes straight to you — the salon never holds it.
      </p>

      {/* Live preview of the card the client will see */}
      <TipCard name={name} avatar={p?.avatarUrl ?? null} qr={qr} handle={handle} />

      <button
        onClick={() => setFull(true)}
        disabled={!ready}
        style={{ ...ui.primaryBtn, width: '100%', padding: '15px', fontSize: 16, marginTop: 16, opacity: ready ? 1 : 0.5, cursor: ready ? 'pointer' : 'default' }}
      >
        📱 Show to client (full screen)
      </button>
      {!ready && <p style={{ color: '#64748b', fontSize: 12.5, textAlign: 'center', marginTop: 8 }}>Add your payment QR and/or handle below first.</p>}

      {/* Editor */}
      <section style={{ ...ui.card, marginTop: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>💸 Your tip details</div>
        <p style={{ color: '#64748b', fontSize: 12.5, margin: '0 0 14px' }}>Upload your Venmo / Zelle / Cash App QR and (optionally) your handle. This stays in sync with what your manager sets up.</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {qr
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={qr} alt="tip QR" width={92} height={92} style={{ borderRadius: 12, objectFit: 'cover', border: '1px solid #334155', background: '#fff' }} />
            : <span style={{ width: 92, height: 92, borderRadius: 12, background: '#0f172a', border: '1px dashed #475569', color: '#64748b', display: 'grid', placeItems: 'center', fontSize: 26 }}>🔳</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ ...ui.input, padding: '9px 14px', cursor: 'pointer', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              📷 {busy ? 'Processing…' : qr ? 'Change QR' : 'Upload QR'}
              <input type="file" accept="image/*" onChange={pickQr} style={{ display: 'none' }} />
            </label>
            {qr && <button type="button" onClick={() => setQr('')} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 }}>Remove QR</button>}
          </div>
        </div>

        <label style={{ display: 'block' }}>
          <span style={ui.label}>Handle / payment link (optional)</span>
          <input style={ui.input} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@venmo-handle or cash.app/$you" />
        </label>

        <button onClick={save} disabled={saving} style={{ ...ui.primaryBtn, marginTop: 16 }}>{saving ? 'Saving…' : 'Save tip details'}</button>
      </section>

      {full && <FullScreenTip name={name} avatar={p?.avatarUrl ?? null} qr={qr} handle={handle} onClose={() => setFull(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The premium card the CLIENT sees — greeting, QR, handle, thank-you. */
/* ------------------------------------------------------------------ */
function TipCard({ name, avatar, qr, handle, big = false }: { name: string; avatar: string | null; qr: string; handle: string; big?: boolean }) {
  const first = name.split(' ')[0] || name;
  const qrSize = big ? 260 : 210;
  const outer: CSSProperties = {
    borderRadius: 26, padding: 2,
    background: 'linear-gradient(140deg, #a78bfa 0%, #6366f1 45%, #22d3ee 100%)',
    boxShadow: '0 24px 70px rgba(99,102,241,0.38)',
    maxWidth: big ? 420 : 380, margin: '0 auto', width: '100%',
  };
  const inner: CSSProperties = {
    borderRadius: 24, padding: big ? '34px 26px 30px' : '26px 22px 26px',
    background: 'radial-gradient(120% 90% at 50% 0%, #1e2544 0%, #0f172a 60%, #0b1120 100%)',
    textAlign: 'center', position: 'relative', overflow: 'hidden',
  };
  return (
    <div style={outer}>
      <div style={inner}>
        <div style={{ position: 'absolute', top: -40, left: '50%', transform: 'translateX(-50%)', width: 200, height: 120, background: 'radial-gradient(closest-side, rgba(167,139,250,0.35), transparent)', pointerEvents: 'none' }} />
        {avatar
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={avatar} alt={name} width={66} height={66} style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.35)', boxShadow: '0 6px 18px rgba(0,0,0,0.4)' }} />
          : <span style={{ width: 66, height: 66, borderRadius: '50%', background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', display: 'inline-grid', placeItems: 'center', fontSize: 26, fontWeight: 800, border: '2px solid rgba(255,255,255,0.35)' }}>{first.charAt(0).toUpperCase()}</span>}
        <div style={{ fontSize: big ? 24 : 21, fontWeight: 800, color: '#f8fafc', marginTop: 10, letterSpacing: 0.2 }}>{name}</div>
        <div style={{ fontSize: 13.5, color: '#c4b5fd', marginTop: 4, fontWeight: 500 }}>Thank you for letting me pamper you 💜</div>

        <div style={{ marginTop: 18, display: 'grid', placeItems: 'center' }}>
          {qr
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={qr} alt="Tip QR code" width={qrSize} height={qrSize} style={{ borderRadius: 18, background: '#fff', padding: 12, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }} />
            : <div style={{ width: qrSize, height: qrSize, borderRadius: 18, background: 'rgba(255,255,255,0.06)', border: '1px dashed #475569', color: '#94a3b8', display: 'grid', placeItems: 'center', fontSize: 13, padding: 20 }}>Add your payment QR to show it here</div>}
        </div>

        {handle.trim() && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 16, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '7px 15px', color: '#e9d5ff', fontSize: 14, fontWeight: 600 }}>
            <span>💳</span>{handle.trim()}
          </div>
        )}

        <div style={{ fontSize: 13.5, color: '#93a4c8', marginTop: 18, lineHeight: 1.5 }}>
          Scan the code to send {first} a tip.<br />It truly makes my day — thank you! 🌸
        </div>
      </div>
    </div>
  );
}

/* Full-screen mode: turn the phone to the client. */
function FullScreenTip({ name, avatar, qr, handle, onClose }: { name: string; avatar: string | null; qr: string; handle: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'linear-gradient(160deg, #2e1065 0%, #1e1b4b 45%, #0b1120 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
      <button onClick={onClose} aria-label="Close" style={{ position: 'fixed', top: 16, right: 16, width: 40, height: 40, borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <TipCard name={name} avatar={avatar} qr={qr} handle={handle} big />
      </div>
    </div>
  );
}
