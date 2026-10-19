'use client';

/**
 * /sign/<token> — the client fills in and signs their massage forms on their
 * own phone (a texted link) or on the check-in iPad. No login: the token is
 * the credential. The salon's own screens sign in a popup instead (SignFlow).
 *
 * `?return=/path` sends the iPad back to the salon's screen when done.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PAPER } from '../../../components/forms/FormRenderer';
import { SignFlow } from '../../../components/forms/SignFlow';
import { safeReturn } from '../../../lib/client-forms';

const PAGE_BG = '#f5f3ef';
const INK = '#1f2937';

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [back, setBack] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    try { setBack(safeReturn(new URLSearchParams(window.location.search).get('return'))); } catch { setBack(null); }
  }, []);
  useEffect(() => {
    if (!finished || !back) return;
    const t = window.setTimeout(() => { window.location.href = back; }, 5000);
    return () => window.clearTimeout(t);
  }, [finished, back]);
  const onFinished = useCallback(() => setFinished(true), []);

  return (
    <main style={{ minHeight: '100dvh', background: PAGE_BG, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: INK }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 48px' }}>
        {token && (
          <SignFlow token={token} onFinished={onFinished}
            finishedExtra={back ? (
              <button type="button" onClick={() => { window.location.href = back; }}
                style={{ marginTop: 10, minHeight: 50, padding: '0 24px', borderRadius: 14, border: 'none', background: PAPER.accent, color: PAPER.onAccent, fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
                Xong — đưa máy lại cho tiệm · Done
              </button>
            ) : null} />
        )}
      </div>
    </main>
  );
}
