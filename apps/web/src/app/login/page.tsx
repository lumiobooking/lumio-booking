'use client';

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { useLang } from '../../lib/i18n';
import { BRAND_BLUE } from '../../components/LumioLogo';

/**
 * SIGN IN — the first screen every salon owner, front desk and technician sees.
 *
 * Redesigned 19/11/2026 from the approved mockup "Ý tưởng 2 · Nổi khối, xanh
 * Lumio" (soft embossed card, the logo's blue):
 *  - The Lumio mark sits in a raised disc; while signing in it slides into the
 *    middle of the card with a blue ring, turns green with a tick on success,
 *    and the card shakes on a wrong password.
 *  - Inputs are pressed into the surface; the label floats up as you type.
 *  - 👁 shows the password as typed, so a wrong key is seen before pressing Sign in.
 *  - "Tôi không phải robot": Cloudflare Turnstile when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 *    is set (the API checks it with LOGIN_TURNSTILE_SECRET); until then a plain
 *    tick box, and the API's 10-tries-a-minute limit still applies.
 *  - The round “+” flips the card to start a new salon: name and email go on
 *    to the existing sign-up page (plan and payment are chosen there).
 *  - Vietnamese or English, the same switch as inside the app.
 *
 * One fixed light look on purpose (the brand's), so its colours are literal,
 * not the app's dark/light tokens.
 */

const SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();
const MARK = '/logo/lumio-mark.png';

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

const CSS = `
.lg2{--blue:${BRAND_BLUE};--deep:#0659b8;--ink:#0f2747;--ink2:#33465f;--muted:#52637d;--soft:#e8eef6;--sd:#c3cedd;--sl:#ffffff;
  position:relative;min-height:100dvh;overflow:hidden;background:var(--soft);color:var(--ink);display:flex;align-items:center;justify-content:center;
  padding:88px max(16px,env(safe-area-inset-right,0px)) 56px max(16px,env(safe-area-inset-left,0px));box-sizing:border-box;color-scheme:light}
.lg2 *{box-sizing:border-box}
.lg2 button,.lg2 input{font-family:inherit}
.lg2 :focus-visible{outline:3px solid rgba(10,128,245,.55);outline-offset:2px}
.lg2-blob{position:absolute;border-radius:50%;background:var(--soft);box-shadow:24px 24px 48px var(--sd),-24px -24px 48px var(--sl);pointer-events:none}
.lg2-orb{position:absolute;border-radius:50%;background:radial-gradient(circle at 35% 30%,#5cb0ff,var(--blue) 60%,var(--deep));opacity:.2;pointer-events:none;animation:lg2float 7s ease-in-out infinite}
.lg2-top{position:absolute;top:calc(20px + env(safe-area-inset-top,0px));left:max(20px,env(safe-area-inset-left,0px));right:max(20px,env(safe-area-inset-right,0px));display:flex;align-items:center;justify-content:space-between;gap:12px}
.lg2-brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800;white-space:nowrap;color:var(--ink)}
.lg2-brand b{color:var(--deep)}
.lg2-lang{display:inline-flex;gap:3px;padding:3px;border-radius:999px;background:var(--soft);box-shadow:inset 3px 3px 6px #c7d1df,inset -3px -3px 6px var(--sl)}
.lg2-lang button{height:30px;padding:0 12px;border:0;border-radius:999px;font-size:12.5px;font-weight:700;cursor:pointer;background:transparent;color:var(--muted)}
.lg2-lang button[aria-pressed="true"]{background:var(--deep);color:#ffffff}
.lg2-card{position:relative;width:100%;max-width:432px;perspective:1400px}
.lg2-flip{position:relative;height:700px;transform-style:preserve-3d;transition:transform .85s cubic-bezier(.3,1.25,.4,1)}
.lg2-flip.back{transform:rotateY(180deg)}
.lg2-side{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:32px;background:var(--soft);box-shadow:20px 20px 40px var(--sd),-20px -20px 40px var(--sl);padding:28px 30px}
.lg2-side.b{transform:rotateY(180deg)}
.lg2-face{display:flex;flex-direction:column;gap:15px}
.lg2-badge{width:84px;height:84px;margin:0 auto;border-radius:50%;background:var(--soft);box-shadow:8px 8px 16px var(--sd),-8px -8px 16px var(--sl);display:flex;align-items:center;justify-content:center;position:relative;z-index:2;transition:transform .6s cubic-bezier(.2,1.3,.3,1),background .4s,box-shadow .4s}
.lg2-badge img{width:46px;height:46px;display:block}
.lg2-badge.busy{transform:translateY(170px) scale(1.35);animation:lg2ring 1.3s ease-out infinite}
.lg2-badge.ok{transform:translateY(170px) scale(1.35);background:linear-gradient(145deg,#22c55e,#15803d);box-shadow:0 12px 30px rgba(21,128,61,.35)}
.lg2-content{transition:opacity .25s ease,transform .45s cubic-bezier(.2,.8,.2,1),filter .3s}
.lg2-content.gone{opacity:0;transform:scale(.95) translateY(10px);filter:blur(5px);pointer-events:none}
.lg2-status{position:absolute;left:0;right:0;top:330px;text-align:center;font-size:16px;font-weight:700;color:var(--deep);opacity:0;transition:opacity .3s;pointer-events:none}
.lg2-status.on{opacity:1}.lg2-status.ok{color:#166534}
.lg2-h1{margin:0;font-size:28px;font-weight:800;letter-spacing:-.4px;line-height:1.2;text-wrap:balance;color:var(--ink)}
.lg2-h1 em{font-style:normal;color:var(--deep)}
.lg2-sub{margin:4px 0 0;font-size:14px;line-height:1.5;color:var(--muted)}
.lg2-field{position:relative}
.lg2-in{width:100%;height:56px;border:0;border-radius:16px;background:var(--soft);box-shadow:inset 6px 6px 12px #c7d1df,inset -6px -6px 12px var(--sl);padding:20px 48px 6px 48px;font-size:16px;color:var(--ink);outline:none;transition:box-shadow .25s}
.lg2-in:focus{box-shadow:inset 6px 6px 12px #c7d1df,inset -6px -6px 12px var(--sl),0 0 0 2px rgba(10,128,245,.6)}
.lg2-lb{position:absolute;left:48px;top:18px;font-size:15px;color:var(--muted);pointer-events:none;transform-origin:left top;transition:transform .2s,color .2s}
.lg2-in:focus + .lg2-lb,.lg2-in:not(:placeholder-shown) + .lg2-lb{transform:translateY(-10px) scale(.78);color:var(--deep);font-weight:700}
.lg2-ic{position:absolute;left:16px;top:19px;color:#5b6f8c;pointer-events:none}
.lg2-in:focus ~ .lg2-ic{color:var(--blue)}
.lg2-eye{position:absolute;right:6px;top:6px;width:44px;height:44px;border:0;border-radius:12px;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center}
.lg2-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.lg2-chk{display:flex;align-items:center;gap:10px;min-height:44px;font-size:14px;color:var(--ink2);cursor:pointer;user-select:none}
.lg2-box{appearance:none;-webkit-appearance:none;width:22px;height:22px;margin:0;border-radius:7px;background:var(--soft);box-shadow:inset 3px 3px 6px #c7d1df,inset -3px -3px 6px var(--sl);cursor:pointer;display:inline-grid;place-content:center;flex-shrink:0}
.lg2-box:checked{background:var(--deep);box-shadow:0 4px 10px rgba(10,111,216,.35)}
.lg2-box:checked::after{content:'';width:10px;height:6px;border-left:2.5px solid #ffffff;border-bottom:2.5px solid #ffffff;transform:translateY(-1px) rotate(-45deg)}
.lg2-link{background:none;border:0;padding:0;font-size:14px;font-weight:700;color:var(--deep);cursor:pointer;min-height:44px}
.lg2-link:hover{text-decoration:underline}
.lg2-note{font-size:13px;line-height:1.5;color:var(--ink2);background:rgba(10,128,245,.08);border-radius:12px;padding:10px 12px;margin-top:-6px}
.lg2-err{font-size:13.5px;font-weight:600;line-height:1.45;color:#b42318;margin-top:-6px}
.lg2-btn{position:relative;width:100%;height:56px;border:0;border-radius:16px;background:var(--soft);box-shadow:8px 8px 16px var(--sd),-8px -8px 16px var(--sl);font-size:16px;font-weight:800;letter-spacing:.3px;color:var(--deep);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:color .25s,box-shadow .25s,background .35s}
.lg2-btn:hover:not(:disabled){color:#ffffff;background:linear-gradient(135deg,#1a8cff,#0a6fd8 55%,#0659b8);box-shadow:0 12px 26px rgba(10,111,216,.38)}
.lg2-btn:active:not(:disabled){box-shadow:inset 6px 6px 12px rgba(4,40,90,.35)}
.lg2-btn:disabled{opacity:.6;cursor:not-allowed}
.lg2-fb{width:100%;height:48px;border:0;border-radius:14px;background:#1877f2;color:#ffffff;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px}
.lg2-fb:disabled{opacity:.6;cursor:not-allowed}
.lg2-or{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--muted);margin:-4px 0}
.lg2-or::before,.lg2-or::after{content:"";flex:1;height:1px;background:var(--sd)}
.lg2-btn i{position:absolute;left:12%;right:12%;bottom:-10px;height:4px;border-radius:4px;background:linear-gradient(90deg,transparent,var(--blue),transparent);filter:blur(2px);animation:lg2glow 2.4s ease-in-out infinite}
.lg2-round{width:48px;height:48px;border:0;border-radius:50%;background:var(--soft);box-shadow:6px 6px 12px var(--sd),-6px -6px 12px var(--sl);color:var(--deep);font-size:24px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:transform .25s,background .2s,color .2s}
.lg2-round:hover{background:var(--deep);color:#ffffff;transform:rotate(90deg)}
.lg2-round.bk:hover{transform:translateX(-3px)}
.lg2-center{display:flex;align-items:center;justify-content:center;gap:12px;font-size:14px;color:var(--muted);flex-wrap:wrap}
.lg2-cust{align-self:center;font-size:13.5px;font-weight:600;color:var(--deep);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.lg2-cust:hover{text-decoration:underline}
.lg2-foot{position:absolute;bottom:calc(16px + env(safe-area-inset-bottom,0px));left:0;right:0;text-align:center;font-size:12.5px;color:var(--muted);margin:0}
.lg2-rise{animation:lg2rise .7s cubic-bezier(.2,.8,.2,1) both}
.lg2-shake{animation:lg2shake .45s ease both}
@keyframes lg2rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes lg2shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(9px)}60%{transform:translateX(-6px)}80%{transform:translateX(4px)}}
@keyframes lg2ring{0%{box-shadow:0 0 0 0 rgba(10,128,245,.5)}100%{box-shadow:0 0 0 24px rgba(10,128,245,0)}}
@keyframes lg2glow{0%,100%{opacity:.5;transform:scaleX(.8)}50%{opacity:1;transform:scaleX(1)}}
@keyframes lg2float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
@media (max-width:480px){.lg2-blob.a{width:220px!important;height:220px!important}.lg2-side{padding:26px 22px}}
@media (prefers-reduced-motion:reduce){.lg2 *{animation:none!important;transition:none!important}}
`;

const Ico = {
  mail: <svg className="lg2-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>,
  lock: <svg className="lg2-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  shop: <svg className="lg2-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /></svg>,
  arrow: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  tick: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
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
  // rt200: "Đăng nhập với Facebook" for team members who joined by an invite link.
  const [fbBusy, setFbBusy] = useState(false);
  useEffect(() => {
    const fb = new URLSearchParams(window.location.search).get('fb');
    if (!fb) return;
    const vi = (localStorage.getItem('lumio_lang') ?? 'vi') !== 'en';
    const M: Record<string, [string, string]> = {
      none: ['Facebook này chưa vào tiệm nào. Nhờ chủ tiệm gửi link mời, mở link rồi bấm “Đăng nhập với Facebook”.', 'This Facebook account has not joined a salon yet. Ask the owner for an invite link.'],
      cancel: ['Bạn đã huỷ đăng nhập Facebook.', 'Facebook sign-in was cancelled.'],
      expired: ['Phiên đăng nhập đã hết hạn — bấm lại “Đăng nhập với Facebook”.', 'The sign-in expired — press the Facebook button again.'],
      failed: ['Facebook chưa xác nhận được — thử lại sau ít phút.', 'Facebook could not confirm — try again in a minute.'],
      'invite-used': ['Link mời đã dùng hết lượt. Nhờ chủ tiệm tạo link mới.', 'This invite link is used up. Ask the owner for a new one.'],
      'invite-expired': ['Link mời đã hết hạn. Nhờ chủ tiệm tạo link mới.', 'This invite link has expired. Ask the owner for a new one.'],
      'invite-revoked': ['Link mời đã bị huỷ hoặc tài khoản đã bị khoá. Liên hệ chủ tiệm.', 'This invite was cancelled or the login is turned off. Ask the owner.'],
      'invite-missing': ['Link mời không đúng. Nhờ chủ tiệm gửi lại.', 'This invite link is not valid. Ask the owner to send it again.'],
    };
    const m = M[fb];
    if (m) setError(vi ? m[0] : m[1]);
  }, []);
  async function facebookLogin() {
    setFbBusy(true); setError(null);
    try {
      const r = await apiFetch<{ url: string }>('/auth/facebook/start', { method: 'POST', body: { mode: 'login' } });
      window.location.assign(r.url);
    } catch (e) { setError(String((e as Error)?.message ?? e)); setFbBusy(false); }
  }
  const [phase, setPhase] = useState<'idle' | 'busy' | 'ok'>('idle');
  const [shake, setShake] = useState(false);
  const [intro, setIntro] = useState(true);
  useEffect(() => { const t = window.setTimeout(() => setIntro(false), 800); return () => window.clearTimeout(t); }, []);
  const [flipped, setFlipped] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [salon, setSalon] = useState('');
  const [newEmail, setNewEmail] = useState('');

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
  const busy = phase !== 'idle';

  function wobble(msg: string) {
    setError(msg);
    setShake(false);
    requestAnimationFrame(() => setShake(true));
    window.setTimeout(() => setShake(false), 480);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) { wobble(L('Nhập email (hoặc số điện thoại) và mật khẩu để đăng nhập.', 'Enter your email (or phone) and password.')); return; }
    if (!passed) { wobble(L('Vui lòng xác nhận bạn không phải là robot.', 'Please confirm you are not a robot.')); return; }
    setPhase('busy');
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
      let to = '/';
      if (resume) to = resume;
      else if (user.role === 'SUPER_ADMIN') to = '/super-admin/tenants';
      else if (user.role === 'SALON_ADMIN') to = '/salon';
      // Where a staff member starts is decided by what they may open, not by
      // the word "staff": a receptionist lands on the front desk, a manager
      // on the dashboard, a technician in the technicians' app.
      else if (user.role === 'STAFF') to = homeFor(user);
      else if (user.role === 'SUPPORT') to = '/agency';
      // The green tick for a moment, then in.
      setPhase('ok');
      window.setTimeout(() => router.push(to), 650);
    } catch (err) {
      setPhase('idle');
      const msg = err instanceof Error ? err.message : 'Login failed';
      wobble(/invalid credentials/i.test(msg) ? L('Email / số điện thoại hoặc mật khẩu chưa đúng. Bấm 👁 để xem lại mật khẩu đã gõ.', 'Wrong email / phone or password. Tap 👁 to check the password you typed.') : msg);
      // A Turnstile answer is good for one try only.
      if (SITE_KEY) resetCaptcha();
    }
  }

  function startSignup(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (salon.trim()) q.set('salon', salon.trim());
    if (newEmail.trim()) q.set('email', newEmail.trim());
    router.push(`/signup${q.toString() ? `?${q.toString()}` : ''}`);
  }

  return (
    <main className="lg2">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="lg2-blob a" style={{ width: 340, height: 340, left: '6%', top: '12%' }} aria-hidden="true" />
      <div className="lg2-blob" style={{ width: 220, height: 220, right: '8%', bottom: '8%' }} aria-hidden="true" />
      <div className="lg2-orb" style={{ width: 120, height: 120, right: '18%', top: '14%' }} aria-hidden="true" />

      <div className="lg2-top">
        <span className="lg2-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK} alt="" width={32} height={32} style={{ width: 32, height: 32, display: 'block' }} />
          Lumio <b>Booking</b>
        </span>
        <span className="lg2-lang" role="group" aria-label={L('Ngôn ngữ', 'Language')}>
          {(['vi', 'en'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}>{l.toUpperCase()}</button>
          ))}
        </span>
      </div>

      <div className={`lg2-card${shake ? ' lg2-shake' : intro ? ' lg2-rise' : ''}`}>
        <div className={`lg2-flip${flipped ? ' back' : ''}`}>
          {/* ---- sign in ---- */}
          <section className="lg2-side" aria-hidden={flipped}>
            <div className={`lg2-badge${phase === 'busy' ? ' busy' : phase === 'ok' ? ' ok' : ''}`}>
              {phase === 'ok' ? Ico.tick : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={MARK} alt="Lumio" width={46} height={46} />
              )}
            </div>
            <div className={`lg2-content${busy ? ' gone' : ''}`}>
              <form className="lg2-face" onSubmit={onSubmit} noValidate style={{ marginTop: 16 }}>
                <div style={{ textAlign: 'center' }}>
                  <h1 className="lg2-h1">{L('Chào mừng ', 'Welcome ')}<em>{L('trở lại', 'back')}</em></h1>
                  <p className="lg2-sub">{L('Đăng nhập để quản lý tiệm của bạn', 'Sign in to run your salon')}</p>
                </div>

                <div className="lg2-field">
                  <input id="login-email" className="lg2-in" type="text" inputMode="email" placeholder=" " autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    value={email} onChange={(e) => setEmail(e.target.value)} tabIndex={flipped ? -1 : 0} />
                  <label htmlFor="login-email" className="lg2-lb">{L('Email hoặc số điện thoại', 'Email or phone')}</label>
                  {Ico.mail}
                </div>

                <div className="lg2-field">
                  <input id="login-password" className="lg2-in" type={show ? 'text' : 'password'} placeholder=" " autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} tabIndex={flipped ? -1 : 0} />
                  <label htmlFor="login-password" className="lg2-lb">{L('Mật khẩu', 'Password')}</label>
                  {Ico.lock}
                  <button type="button" className="lg2-eye" onClick={() => setShow((v) => !v)} aria-pressed={show} tabIndex={flipped ? -1 : 0}
                    aria-label={show ? L('Ẩn mật khẩu', 'Hide password') : L('Hiện mật khẩu', 'Show password')}
                    title={show ? L('Ẩn mật khẩu', 'Hide password') : L('Hiện mật khẩu', 'Show password')}>
                    {show ? (
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><path d="M1 1l22 22" /></svg>
                    ) : (
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </div>

                <div className="lg2-row">
                  {SITE_KEY ? (
                    <div ref={boxRef} style={{ minHeight: 65 }} />
                  ) : (
                    <label className="lg2-chk">
                      <input type="checkbox" className="lg2-box" checked={human} onChange={(e) => setHuman(e.target.checked)} tabIndex={flipped ? -1 : 0} />
                      {L('Tôi không phải robot', 'I’m not a robot')}
                    </label>
                  )}
                  <button type="button" className="lg2-link" onClick={() => setForgot((v) => !v)} aria-expanded={forgot} tabIndex={flipped ? -1 : 0}>{L('Quên mật khẩu?', 'Forgot password?')}</button>
                </div>
                {forgot && (
                  <div className="lg2-note">
                    {L('Nhân viên: nhờ chủ tiệm đặt lại mật khẩu ở mục Nhân viên. Chủ tiệm: gửi email tới support@lumiobooking.com, Lumio sẽ đặt lại giúp bạn.',
                      'Staff: ask the owner to reset your password under Staff. Owners: email support@lumiobooking.com and Lumio will reset it for you.')}
                  </div>
                )}

                {error && <div className="lg2-err" role="alert">{error}</div>}

                <button type="submit" className="lg2-btn" disabled={busy} tabIndex={flipped ? -1 : 0}>
                  {L('ĐĂNG NHẬP', 'SIGN IN')} {Ico.arrow}<i aria-hidden="true" />
                </button>

                <div className="lg2-or">{L('nhân viên', 'team members')}</div>
                <button type="button" className="lg2-fb" onClick={() => void facebookLogin()} disabled={fbBusy} tabIndex={flipped ? -1 : 0}>
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#ffffff" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.27h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z" /></svg>
                  {fbBusy ? L('Đang mở Facebook…', 'Opening Facebook…') : L('Đăng nhập với Facebook', 'Continue with Facebook')}
                </button>

                <div className="lg2-center" style={{ marginTop: 6 }}>
                  {L('Chưa có tài khoản?', 'New to Lumio?')}
                  <button type="button" className="lg2-round" onClick={() => setFlipped(true)} aria-label={L('Đăng ký tiệm', 'Sign up a salon')} tabIndex={flipped ? -1 : 0}>+</button>
                </div>
                {/* Shortcut so a customer-facing tablet can reach the display screen
                    without signing in (it pairs with a code from the register). */}
                <a href="/display" className="lg2-cust" tabIndex={flipped ? -1 : 0}>{L('Mở màn hình cho khách', 'Open customer display')}</a>
              </form>
            </div>
            <div className={`lg2-status${busy ? ' on' : ''}${phase === 'ok' ? ' ok' : ''}`} aria-live="polite">
              {phase === 'busy' ? L('Đang đăng nhập…', 'Signing in…') : phase === 'ok' ? L('Chào mừng trở lại!', 'Welcome back!') : ''}
            </div>
          </section>

          {/* ---- new salon ---- */}
          <section className="lg2-side b" aria-hidden={!flipped}>
            <form className="lg2-face" onSubmit={startSignup} noValidate>
              <div className="lg2-badge">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#0659b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /></svg>
              </div>
              <div style={{ textAlign: 'center' }}>
                <h2 className="lg2-h1">{L('Tạo tài khoản ', 'Start ')}<em>{L('cho tiệm', 'your salon')}</em></h2>
                <p className="lg2-sub">{L('Bước sau chọn gói và thanh toán', 'Pick a plan on the next step')}</p>
              </div>
              <div className="lg2-field">
                <input id="signup-salon" className="lg2-in" type="text" placeholder=" " value={salon} onChange={(e) => setSalon(e.target.value)} tabIndex={flipped ? 0 : -1} />
                <label htmlFor="signup-salon" className="lg2-lb">{L('Tên tiệm', 'Salon name')}</label>
                {Ico.shop}
              </div>
              <div className="lg2-field">
                <input id="signup-email" className="lg2-in" type="email" placeholder=" " autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} tabIndex={flipped ? 0 : -1} />
                <label htmlFor="signup-email" className="lg2-lb">Email</label>
                {Ico.mail}
              </div>
              <button type="submit" className="lg2-btn" style={{ marginTop: 4 }} tabIndex={flipped ? 0 : -1}>
                {L('TIẾP TỤC', 'CONTINUE')} {Ico.arrow}<i aria-hidden="true" />
              </button>
              <div className="lg2-center" style={{ marginTop: 6 }}>
                {L('Đã có tài khoản?', 'Have an account?')}
                <button type="button" className="lg2-round bk" onClick={() => setFlipped(false)} aria-label={L('Quay lại đăng nhập', 'Back to sign in')} tabIndex={flipped ? 0 : -1}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <p className="lg2-foot">© {new Date().getFullYear()} Lumio Agency LLC</p>
    </main>
  );
}
