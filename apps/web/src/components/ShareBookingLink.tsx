'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';

/**
 * Compact "Booking link" control for the salon admin sidebar.
 * Shows the salon's public booking URL (lumiobooking.com/<slug>) in a small
 * popover with one-tap Copy and Open. Takes no page space — it's a single
 * button that expands a popover only when clicked.
 */
export function ShareBookingLink() {
  const { token } = useAuth();
  const [slug, setSlug] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ slug: string } | null>('/me/tenant', { token })
      .then((t) => setSlug(t?.slug ?? null))
      .catch(() => {});
  }, [token]);

  // Close the popover when clicking outside it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!slug) return null;
  const url = `${typeof window !== 'undefined' ? window.location.origin : 'https://lumiobooking.com'}/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
          border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 14,
        }}
      >
        <span aria-hidden>🔗</span> Booking link
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 60,
            background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,.5)',
          }}
        >
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Your public booking page</div>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
              border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 13,
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={copy}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                border: '1px solid #4f46e5', background: copied ? '#22c55e' : '#4f46e5', color: '#fff',
              }}
            >
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontSize: 13,
                border: '1px solid #334155', background: 'transparent', color: '#e2e8f0',
              }}
            >
              Open
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
