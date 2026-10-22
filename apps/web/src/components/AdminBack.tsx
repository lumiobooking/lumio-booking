'use client';

/**
 * ONE WAY BACK, IN THE SAME PLACE ON EVERY ADMIN SCREEN.
 *
 * Some Super Admin screens had a small "← Salons" at the far right of the
 * title row, some had it at the left, and two (content, AI usage) had none —
 * the only way out was the browser's back button, which after a few saves is
 * not where you came from. Top left, above the title, a real button-sized
 * target, on every screen that is not the list itself.
 */
export function AdminBack({ href = '/super-admin/tenants', label = 'Salons' }: { href?: string; label?: string }) {
  return (
    <a href={href} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 12px', marginBottom: 12,
      borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)',
      fontSize: 13, fontWeight: 700, textDecoration: 'none',
    }}>
      ← {label}
    </a>
  );
}
