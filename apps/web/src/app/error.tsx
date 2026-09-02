'use client';

/**
 * What the person sees when a page throws.
 *
 * Next's default is one generic English sentence pointing at a console no
 * phone user can open — which turns every real defect into "lỗi hệ thống"
 * with nothing to act on. This screen shows the actual message and stack
 * instead, so a screenshot from any device carries the diagnosis with it,
 * and one tap tries again without hunting for a refresh gesture.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>😵</div>
        <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>Có lỗi xảy ra · Something broke</h1>
        <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 14px' }}>
          Chụp màn hình này gửi cho đội Lumio là đủ để sửa. · A screenshot of this screen is enough to fix it.
        </p>
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.5,
          background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 12,
          maxHeight: 260, overflow: 'auto', color: '#fbbf24',
        }}>
          {String(error?.message || error)}{error?.digest ? `\n\ndigest: ${error.digest}` : ''}{'\n\n'}{String(error?.stack || '').slice(0, 800)}
        </pre>
        <button onClick={() => reset()} style={{
          marginTop: 14, width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
          background: '#6366f1', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}>
          Thử lại · Try again
        </button>
        <button onClick={() => { window.location.href = '/salon'; }} style={{
          marginTop: 8, width: '100%', padding: '12px 16px', borderRadius: 10, border: '1px solid #334155',
          background: 'transparent', color: '#e2e8f0', fontSize: 15, fontWeight: 600, cursor: 'pointer',
        }}>
          Về trang quản lý · Back to dashboard
        </button>
      </div>
    </div>
  );
}
