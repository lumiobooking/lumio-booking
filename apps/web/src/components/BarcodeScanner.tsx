'use client';

import { useEffect, useRef, useState } from 'react';

// Loaded on demand from a CDN so it adds nothing to the app bundle and only runs
// when a cashier opens the camera scanner. Works across Android/Chrome and iOS
// Safari (the library falls back to a wasm decoder where BarcodeDetector is absent).
const CDN = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';

function loadLib(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Html5Qrcode) return resolve(w.Html5Qrcode);
    const existing = document.querySelector('script[data-h5q]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).Html5Qrcode));
      existing.addEventListener('error', () => reject(new Error('load failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = CDN;
    s.async = true;
    s.setAttribute('data-h5q', '1');
    s.onload = () => resolve((window as any).Html5Qrcode);
    s.onerror = () => reject(new Error('load failed'));
    document.head.appendChild(s);
  });
}

/**
 * Full-screen camera barcode/QR scanner. Calls onDetect once with the decoded
 * value, then the caller closes it. Strings are passed in so the component stays
 * language-agnostic.
 */
export function BarcodeScanner({
  onDetect,
  onClose,
  title,
  hint,
  errorText,
}: {
  onDetect: (code: string) => void;
  onClose: () => void;
  title: string;
  hint: string;
  errorText: string;
}) {
  const [err, setErr] = useState(false);
  const scannerRef = useRef<any>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Html5Qrcode = await loadLib();
        if (cancelled) return;
        const w = window as any;
        const f = w.Html5QrcodeSupportedFormats;
        const formatsToSupport = f
          ? [f.UPC_A, f.UPC_E, f.EAN_13, f.EAN_8, f.CODE_128, f.CODE_39, f.CODE_93, f.ITF, f.QR_CODE]
          : undefined;
        const scanner = new Html5Qrcode('lumio-bc-reader', { formatsToSupport, verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 260, height: 170 } },
          (decoded: string) => {
            if (doneRef.current) return;
            doneRef.current = true;
            onDetect(decoded);
            stop();
          },
          () => {},
        );
      } catch {
        setErr(true);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function stop() {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {
        /* already stopped */
      }
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={() => { stop(); onClose(); }}
    >
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: 16, width: '100%', maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ color: '#e2e8f0', fontSize: 16 }}>📷 {title}</strong>
          <button onClick={() => { stop(); onClose(); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 26, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
        <div id="lumio-bc-reader" style={{ width: '100%', minHeight: 240, borderRadius: 12, overflow: 'hidden', background: '#000' }} />
        {err ? (
          <p style={{ color: '#f59e0b', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{errorText}</p>
        ) : (
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 12, textAlign: 'center' }}>{hint}</p>
        )}
      </div>
    </div>
  );
}
