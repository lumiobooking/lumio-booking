'use client';

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '../../lib/auth';
import { useLang } from '../../lib/i18n';
import { LumioLogo } from '../../components/LumioLogo';

/**
 * SIGN IN — the first screen every salon owner, front desk and technician sees.
 *
 *  - A welcoming header (gradient band, what Lumio does in three words) instead
 *    of a bare logo over "Sign in to the admin console".
 *  - 👁 shows the password as typed, so a wrong key is seen before pressing Sign in.
 *  - "Tôi không phải robot": Cloudflare Turnstile when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 *    is set (the API checks it with LOGIN_TURNSTILE_SECRET); until then a plain
 *    tick box, and the API's 10-tries-a-minute limit still applies.
 *  - Vietnamese or English, the same switch as inside the app.
 */

const SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

export default function LoginPage() {
  const { login } = useAuth();
  const { lang, setLang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [human, setHuman] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ---- Cloudflare Turnstile (only when a site key is configured) ----
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const resetCaptcha = useCallback(() => {
    setCaptcha(null);
    const ts = (window as unknown as { turnstile?: Turnstile }).turnstile;
    try { if (ts && widgetId.current) ts.reset(widgetId.current); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!SITE_KEY || !boxRef.current) return;
    let cancelled = false;
    const draw = () => {
      const ts = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (cancelled || !ts || !boxRef.current || widgetId.current) return;
      widgetId.current = ts.render(boxRef.current, {
        sitekey: SITE_KEY,
        language: vi ? 'vi' : 'en',
        callback: (t: string) => setCaptcha(t),
        'expired-callback': () => setCaptcha(null),
        'error-callback': () => setCaptcha(null),
      });
    };
    if ((window as unknown as { turnstile?: Turnstile }).turnstile) draw();
    else {
      const id = 'cf-turnstile-script';
      let s = document.getElementById(id) as HTMLScriptElement | null;
      if (!s) {
        s = document.createElement('script');
        s.id = id;
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }
      s.addEventListener('load', draw);
    }
    return () => {
      cancelled = true;
      const ts = (window as unknown as { turnstile?: Turnstile }).turnstile;
      try { if (ts && widgetId.current) ts.remove(widgetId.current); } catch { /* ignore */ }
      widgetId.current = null;
    };
  }, [vi]);

  const passed = SITE_KEY ? !!captcha : human;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!passed) { setError(L('Vui lòng xác nhận bạn không phải là robot.', 'Please confirm you are not a robot.')); return; }
    setLoading(true);
    try {
      const user = await login(email, password, captcha ?? undefined);
      // A "Connect …" that came back while signed out (oauth/confirm) resumes there.
      let resume = '';
      try {
        const raw = window.sessionStorage.getItem('lumio_oauth_resume');
        window.sessionStorage.removeItem('lumio_oauth_resume');
        if (raw && raw.startsWith('/oauth/confirm?')) resume = raw;
      } catch { /* storage refused: normal routing */ }
      // Route by role.
      if (resume) {
        router.push(resume);
      } else if (user.role === 'SUPER_ADMIN') {
        router.push('/super-admin/tenants');
      } else if (user.role === 'SALON_ADMIN') {
        router.push('/salon');
      } else if (user.role === 'STAFF') {
        // Where a staff member starts is decided by what they may open, not by
        // the word "staff": a receptionist lands on the front desk, a manager
        // on the dashboard, a technician in the technicians' app.
        router.push(homeFor(user));
      } else if (user.role === 'SUPPORT') {
        router.push('/agency');
      } else {
        router.push('/');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(/invalid credentials/i.test(msg) ? L('Email hoặc mật khẩu chưa đúng. Bấm 👁 để xem lại mật khẩu đã gõ.', 'Wrong email or password. Tap 👁 to check the password you typed.') : msg);
      // A Turnstile answer is good for one try only.
      if (SITE_KEY) resetCaptcha();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'radial-gradient(1200px 600px at 10% -10%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(900px 500px at 110% 110%, rgba(236,72,153,0.14), transparent 60%), var(--c0b1120)' }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 420, background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 24px 60px -24px rgba(15,23,42,0.45)' }}>
        {/* ---- header band ---- */}
        <div style={{ position: 'relative', padding: '26px 26px 22px', background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #db2777 100%)', color: '#fff' }}>
          <span aria-hidden="true" style={{ position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
          <span aria-hidden="true" style={{ position: 'absolute', right: 40, bottom: -50, width: 110, height: 110, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 10px', borderRadius: 14, background: 'rgba(255,255,255,0.95)' }}>
              <LumioLogo size={30} sub="Booking" color="#0f172a" />
            </span>
            <span role="group" aria-label={L('Ngôn ngữ', 'Language')} style={{ display: 'inline-flex', borderRadius: 999, background: 'rgba(255,255,255,0.18)', padding: 3 }}>
              {(['vi', 'en'] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                  style={{ border: 0, borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: lang === l ? '#fff' : 'transparent', color: lang === l ? '#4f46e5' : '#fff' }}>
                  {l.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
          <h1 style={{ position: 'relative', margin: '18px 0 4px', fontSize: 26, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.2 }}>
            {L('Chào mừng trở lại 👋', 'Welcome back 👋')}
          </h1>
          <p style={{ position: 'relative', margin: 0, fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,0.88)' }}>
            {L('Đăng nhập để quản lý lịch hẹn, thu ngân và marketing của tiệm — tất cả ở một nơi.', 'Sign in to run your salon’s bookings, checkout and marketing — all in one place.')}
          </p>
          <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
            {[L('📅 Lịch hẹn', '📅 Bookings'), L('💳 Thu ngân', '💳 Checkout'), L('✨ Marketing AI', '✨ AI marketing')].map((c) => (
              <span key={c} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.25)' }}>{c}</span>
            ))}
          </div>
        </div>

        {/* ---- the form ---- */}
        <div style={{ padding: '20px 26px 24px' }}>
          <label htmlFor="login-email" style={labelStyle}>Email</label>
          <input id="login-email" type="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@salon.com" style={inputStyle} />

          <label htmlFor="login-password" style={labelStyle}>{L('Mật khẩu', 'Password')}</label>
          <div style={{ position: 'relative' }}>
            <input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required style={{ ...inputStyle, paddingRight: 48 }} />
            <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show}
              aria-label={show ? L('Ẩn mật khẩu', 'Hide password') : L('Hiện mật khẩu', 'Show password')}
              title={show ? L('Ẩn mật khẩu', 'Hide password') : L('Hiện mật khẩu', 'Show password')}
              style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, border: 0, borderRadius: 10, background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              {show ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>

          {/* ---- not a robot ---- */}
          <div style={{ marginTop: 16 }}>
            {SITE_KEY ? (
              <div ref={boxRef} style={{ minHeight: 65 }} />
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: `1px solid ${human ? 'rgba(34,197,94,0.55)' : 'var(--c334155)'}`, background: human ? 'rgba(34,197,94,0.08)' : 'var(--c0f172a)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={human} onChange={(e) => setHuman(e.target.checked)} style={{ width: 22, height: 22, accentColor: '#16a34a', cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{L('Tôi không phải là robot', 'I’m not a robot')}</span>
                <span aria-hidden="true" style={{ fontSize: 20 }}>🛡️</span>
              </label>
            )}
          </div>

          {error && (
            <div role="alert" style={{ background: 'var(--c7f1d1d)', color: 'var(--cfecaca)', padding: '9px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.45, marginTop: 14 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading || !passed}
            style={{ ...buttonStyle, opacity: loading || !passed ? 0.6 : 1, cursor: loading || !passed ? 'not-allowed' : 'pointer' }}>
            {loading ? L('Đang đăng nhập…', 'Signing in…') : L('Đăng nhập', 'Sign in')}
          </button>

          {/* Shortcut so a customer-facing tablet can reach the display screen
              without signing in (it pairs with a code from the register). */}
          <a href="/display" style={displayLinkStyle}>
            📱 {L('Mở màn hình cho khách', 'Open customer display')} →
          </a>
        </div>
      </form>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--ccbd5e1)',
  margin: '14px 0 6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 46,
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid var(--c475569)',
  background: 'var(--c0f172a)',
  color: 'var(--ce2e8f0)',
  fontSize: 15,
};

const buttonStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 18,
  height: 48,
  borderRadius: 12,
  border: 'none',
  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
  color: 'white',
  fontWeight: 700,
  fontSize: 15,
  boxShadow: '0 10px 24px -10px rgba(79,70,229,0.7)',
  fontFamily: 'inherit',
};

const displayLinkStyle: React.CSSProperties = {
  display: 'block',
  textAlign: 'center',
  marginTop: 14,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid var(--c334155)',
  background: 'var(--c0f172a)',
  color: 'var(--ca5f3fc)',
  fontWeight: 600,
  fontSize: 13,
  textDecoration: 'none',
};
