'use client';

import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * "Install app" button for the PWA.
 * - Chrome/Edge/Android: captures `beforeinstallprompt` and triggers the native install dialog.
 * - iOS Safari (no beforeinstallprompt): shows Add-to-Home-Screen instructions.
 * - Already installed (standalone display mode): renders nothing.
 */
export function InstallAppButton({ label = 'Install app' }: { label?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    // Hide if already running as an installed app.
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) { setInstalled(true); return; }

    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua) && !/crios|fxios/.test(ua);
    setIsIos(ios);

    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;
  // Nothing to offer: not iOS and no install prompt captured yet.
  if (!isIos && !deferred) return null;

  async function install() {
    if (isIos) { setShowIosHelp((v) => !v); return; }
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={install}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 10, cursor: 'pointer',
          border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff',
          fontSize: 14, fontWeight: 600,
        }}
      >
        <span aria-hidden>⬇</span> {label}
      </button>
      {showIosHelp && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 260, zIndex: 50,
            background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 14,
            color: '#e2e8f0', fontSize: 13, lineHeight: 1.5, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Install on iPhone / iPad</div>
          <div>1. Tap the <strong>Share</strong> button <span aria-hidden>􀈂</span> in Safari.</div>
          <div>2. Choose <strong>Add to Home Screen</strong>.</div>
          <div>3. Tap <strong>Add</strong> — the app icon appears on your home screen.</div>
          <button
            onClick={() => setShowIosHelp(false)}
            style={{ marginTop: 8, background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 13, padding: 0 }}
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
