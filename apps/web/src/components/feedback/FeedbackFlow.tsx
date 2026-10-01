'use client';

// ---------------------------------------------------------------------------
// "How was your visit?" — the customer's two-button feedback.
//
// One component, two places: the customer's own phone (/f/<token>, from the
// text or the receipt QR) and the salon's customer iPad right after payment.
// Happy → Google. Not quite → a private note to the owner, then ONE quiet line
// that still offers Google: Google forbids inviting only happy customers, so the
// link is always there, just not shouted.
//
// LIGHT, ON PURPOSE, like the check-in kiosk: this is a customer page, it never
// follows the owner's dark theme. No var(--c…) tokens.
// ---------------------------------------------------------------------------

import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

export interface FeedbackCtx {
  salonName: string;
  logoUrl: string | null;
  accentColor: string;
  lang: 'en' | 'vi';
  customerFirstName: string | null;
  staffName: string | null;
  staffInitials: string | null;
  staffAvatar: string | null;
  services: string[];
  visitAt: string;
  reasons: string[];
  askPhoto: boolean;
  replyHours: number;
  maskedPhone: string | null;
  hasPhone: boolean;
  /** A photo already arrived for this visit (sent from the customer's phone). */
  hasPhoto?: boolean;
  googleUrl: string | null;
  answered: 'HAPPY' | 'UNHAPPY' | null;
  expired: boolean;
}

type Step = 'ask' | 'happy' | 'form' | 'sent' | 'later';

const C = {
  page: '#faf9f7', card: '#ffffff', line: '#e7e3dd', ink: '#1c1917', ink2: '#44403c',
  muted: '#6f6a64', faint: '#a39d96', good: '#ecfdf3', warm: '#fff4ed', star: '#f5b301', bad: '#b91c1c',
};
const SERIF = 'Baskerville, "Libre Baskerville", "Iowan Old Style", Georgia, serif';

const REASON_VI: Record<string, string> = {
  'Waited too long': 'Chờ quá lâu', 'Service quality': 'Chất lượng dịch vụ', 'Polish chipped': 'Sơn bị bong',
  'Staff attitude': 'Thái độ nhân viên', Cleanliness: 'Vệ sinh', Price: 'Giá cả', Other: 'Khác',
};
const REASON_ICON: Record<string, string> = {
  'Waited too long': '⏱', 'Service quality': '💅', 'Polish chipped': '💔', 'Staff attitude': '🙂', Cleanliness: '🧼', Price: '💲', Other: '…',
};

function strings(lang: 'en' | 'vi') {
  const vi = lang === 'vi';
  return {
    how: (n: string | null) => (vi ? `Hôm nay bạn thấy thế nào${n ? `, ${n}` : ''}?` : `How was your visit today${n ? `, ${n}` : ''}?`),
    howShort: vi ? 'Hôm nay bạn thấy thế nào?' : 'How was your visit today?',
    did: (t: string, s: string | null) => (vi ? `${t} đã làm ${s ?? 'cho bạn'}` : `${t} did your ${s ?? 'visit'}`),
    happy: vi ? 'Hài lòng' : 'I’m happy', happySub: vi ? 'Mọi thứ đều tốt' : 'Everything was great',
    notQuite: vi ? 'Chưa hài lòng' : 'Not quite', notQuiteSub: vi ? 'Có điều chưa ổn' : 'Something could be better',
    oneTap: vi ? 'Một chạm · gửi thẳng tới chủ tiệm' : 'One tap · goes straight to the salon owner',
    thanks: (n: string | null) => (vi ? `Cảm ơn bạn${n ? `, ${n}` : ''}` : `Thank you${n ? `, ${n}` : ''}`),
    glad: vi ? 'Thật vui vì bạn hài lòng!' : 'So glad you loved it!',
    ask: (t: string | null) => (vi ? `Bạn có thể chia sẻ trên Google không? Chỉ 30 giây và giúp ${t ? `${t} và ` : ''}tiệm rất nhiều.` : `Would you tell others on Google? It takes 30 seconds and helps ${t ? `${t} and ` : ''}the salon a lot.`),
    askIpad: vi ? 'Quét bằng điện thoại của bạn để chia sẻ trên Google — chỉ 30 giây và rất ý nghĩa với một tiệm nhỏ.' : 'Scan with your phone to share it on Google — it takes 30 seconds and means the world to a small salon.',
    write: vi ? 'Viết đánh giá Google' : 'Write a Google review',
    mention: vi ? 'Chưa biết viết gì? Có thể nhắc tới…' : 'Not sure what to say? Maybe mention…',
    hints: (t: string | null, s: string | null) => [t ? (vi ? `💅 Tay nghề của ${t}` : `💅 ${t}’s work`) : (vi ? '💅 Tay nghề thợ' : '💅 The work'), s ? `✨ ${s}` : (vi ? '✨ Dịch vụ' : '✨ The service'), vi ? '🧼 Sạch sẽ' : '🧼 Cleanliness', vi ? '☕ Cảm giác thư giãn' : '☕ How it felt'],
    later: vi ? 'Để sau' : 'Maybe later',
    camera: vi ? 'Đưa camera vào đây' : 'Point your camera here',
    textMe: vi ? '📱 Nhắn link cho tôi' : '📱 Text me the link',
    texted: vi ? '✓ Đã nhắn link' : '✓ Link sent',
    done: vi ? 'Xong' : 'Done',
    sorry: (n: string | null) => (vi ? `Rất tiếc${n ? `, ${n}` : ''}` : `We’re sorry${n ? `, ${n}` : ''}`),
    better: vi ? 'Tiệm có thể làm tốt hơn điều gì?' : 'What could we do better?',
    lock: vi ? '🔒 Gửi tới chủ tiệm. Tên bạn không bao giờ hiện cho thợ.' : '🔒 Goes to the owner. Your name is never shown to the technician.',
    tapAll: vi ? 'Chọn tất cả ý đúng' : 'Tap all that apply',
    more: vi ? 'Kể thêm' : 'Tell us more', optional: vi ? 'không bắt buộc' : 'optional',
    placeholder: vi ? 'Chạm để nhập…' : 'Tap to type…',
    photo: vi ? 'Thêm ảnh' : 'Add a photo', photoOk: vi ? 'Đã thêm ảnh' : 'Photo added', photoBusy: vi ? 'Đang tải ảnh…' : 'Uploading…',
    photoSub: vi ? 'Giúp chủ tiệm thấy rõ chuyện gì đã xảy ra' : 'Helps the owner see exactly what happened',
    photoChange: vi ? 'Đổi ảnh' : 'Change', photoRemove: vi ? 'Bỏ' : 'Remove',
    photoPhone: vi ? 'Gửi ảnh bằng điện thoại của bạn' : 'Add a photo from your phone',
    photoPhoneSub: vi ? 'Quét mã · chụp · xong. Ảnh sẽ đi kèm góp ý của bạn.' : 'Scan, snap, done — it goes with your note.',
    photoHere: vi ? '📷 Chụp bằng iPad này' : '📷 Use this iPad’s camera',
    photoGot: vi ? 'Đã nhận ảnh của bạn' : 'Photo received',
    photoGotSub: vi ? 'Ảnh sẽ đi kèm góp ý gửi chủ tiệm.' : 'It goes to the owner with your note.',
    photoAfter: vi ? 'Muốn gửi thêm ảnh?' : 'Want to add a photo?',
    photoAfterOk: vi ? '✓ Đã gửi ảnh cho chủ tiệm' : '✓ Photo sent to the owner',
    contact: vi ? 'Chủ tiệm gọi hoặc nhắn cho bạn được không?' : 'Can the owner call or text you?',
    send: vi ? 'Gửi tới chủ tiệm' : 'Send to the owner', sending: vi ? 'Đang gửi…' : 'Sending…',
    back: vi ? 'Quay lại' : 'Back',
    received: vi ? 'Đã nhận' : 'Message received',
    thanksTelling: vi ? 'Cảm ơn bạn đã chia sẻ' : 'Thank you for telling us',
    willReach: (h: number) => (vi ? (h <= 24 ? 'Chủ tiệm đã nhận và sẽ liên hệ với bạn trong hôm nay để khắc phục.' : `Chủ tiệm đã nhận và sẽ liên hệ với bạn trong ${h} giờ tới.`) : (h <= 24 ? 'The owner has your note and will reach out today to make it right.' : `The owner has your note and will reach out within ${h} hours.`)),
    willReachPlain: vi ? 'Chủ tiệm đã nhận và sẽ đọc kỹ. Cảm ơn bạn.' : 'The owner has your note and will read it carefully. Thank you.',
    expect: (p: string, salon: string) => (vi ? `Bạn sẽ nhận tin nhắn từ ${salon} tới ${p}.` : `Expect a text from ${salon} at ${p}.`),
    googleLine: vi ? 'Bạn cũng có thể chia sẻ công khai' : 'You can also share your experience publicly',
    onGoogle: vi ? 'trên Google' : 'on Google',
    expired: vi ? 'Link này đã hết hạn. Cảm ơn bạn đã ghé tiệm!' : 'This link has expired. Thank you for visiting!',
    seeYou: vi ? 'Hẹn gặp lại bạn!' : 'See you next time!',
    error: vi ? 'Chưa gửi được — thử lại nhé.' : 'Could not send — please try again.',
    returns: (n: number) => (vi ? `Tự về màn hình chào sau ${n} giây` : `Returns to the welcome screen in ${n} s`),
  };
}

/** Android: open the Maps app directly where the link allows it. */
export function appDeepLink(url: string): string {
  if (typeof navigator === 'undefined') return url;
  if (!/Android/i.test(navigator.userAgent || '')) return url;
  if (!/(g\.page\/|google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|search\.google\.com\/local)/i.test(url)) return url;
  const stripped = url.replace(/^https?:\/\//i, '');
  return `intent://${stripped}#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

export const qrImg = (data: string, px: number) => `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=1&data=${encodeURIComponent(data)}`;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { message?: string }).message || 'error');
  return d as T;
}

/** Shrink a picked photo to ≤1280px JPEG before it leaves the phone. */
export function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

export function FeedbackFlow({ token, ctx, variant, onDone, header, footer }: {
  token: string;
  ctx: FeedbackCtx;
  variant: 'phone' | 'ipad';
  /** iPad: the flow is over (or idled out) — give the screen back. */
  onDone?: () => void;
  /** iPad: the "Thank you! Paid $45" line drawn above the question. */
  header?: React.ReactNode;
  /** iPad: what sits under the two buttons on the first screen (the optional tip link). */
  footer?: React.ReactNode;
}) {
  const t = useMemo(() => strings(ctx.lang), [ctx.lang]);
  const accent = ctx.accentColor || '#6366f1';
  const ipad = variant === 'ipad';
  const first = ctx.customerFirstName;
  const service = ctx.services[0] ?? null;
  const [step, setStep] = useState<Step>(ctx.answered === 'HAPPY' ? 'happy' : ctx.answered === 'UNHAPPY' ? 'sent' : 'ask');
  const [picked, setPicked] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [contact, setContact] = useState(ctx.hasPhone);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // Shared screen: a photo sent from the customer's own phone (QR) while they answer here.
  const [phonePhoto, setPhonePhoto] = useState(!!ctx.hasPhoto);
  const [afterPhoto, setAfterPhoto] = useState(false);
  // Only a tablet's own camera — never a file picker on the salon's PC (a touch
  // monitor on Windows would otherwise open the computer's folders to a customer).
  const canCamera = typeof navigator !== 'undefined'
    && (/iPad|iPhone|Android/i.test(navigator.userAgent || '') || (/Macintosh/.test(navigator.userAgent || '') && (navigator.maxTouchPoints ?? 0) > 1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [google, setGoogle] = useState<string | null>(ctx.googleUrl);
  const [texted, setTexted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const source = ipad ? 'ipad' : (typeof window !== 'undefined' && /[?&]src=qr\b/.test(window.location.search) ? 'qr' : (typeof window !== 'undefined' && /[?&]src=sms\b/.test(window.location.search) ? 'sms' : 'link'));

  // iPad: give the screen back on its own — 60 s on the Google QR, 20 s after a
  // note, 90 s if somebody walks away mid-form.
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!ipad || !onDone) return;
    const secs = step === 'happy' ? 60 : step === 'sent' || step === 'later' ? 20 : step === 'form' ? 90 : null;
    if (secs === null) { setLeft(null); return; }
    setLeft(secs);
    const id = window.setInterval(() => setLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [ipad, onDone, step, picked, comment]);
  useEffect(() => { if (left !== null && left <= 0 && onDone) onDone(); }, [left, onDone]);

  async function answer(sentiment: 'HAPPY' | 'UNHAPPY') {
    setBusy(true); setErr(null);
    try {
      const r = await post<{ googleUrl: string | null }>(`/public/feedback/${token}`, sentiment === 'HAPPY'
        ? { sentiment, source }
        : { sentiment, source, reasons: picked, comment: comment.trim() || undefined, wantsContact: contact && ctx.hasPhone, photoUrl: photo === null ? undefined : photo });
      setGoogle(r.googleUrl ?? ctx.googleUrl);
      setStep(sentiment === 'HAPPY' ? 'happy' : 'sent');
    } catch {
      setErr(t.error);
    } finally { setBusy(false); }
  }

  function tapGoogle() {
    // Counted, never blocking: the anchor's own navigation is what opens the Maps app on iOS.
    try { navigator.sendBeacon?.(`${API_URL}/public/feedback/${token}/google`, new Blob(['{}'], { type: 'application/json' })); } catch { /* ignore */ }
  }

  async function pickPhoto(f: File | undefined) {
    if (!f) return;
    setPhotoBusy(true); setErr(null);
    try {
      const dataUrl = await shrink(f);
      const r = await post<{ url: string }>(`/public/feedback/${token}/photo`, { dataUrl });
      setPhoto(r.url); setPhotoPreview(dataUrl);
      if (step === 'sent') setAfterPhoto(true);
    } catch { setErr(t.error); } finally { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  // Shared screen: watch for a photo arriving from the customer's phone.
  useEffect(() => {
    if (!ipad || step !== 'form' || !ctx.askPhoto || phonePhoto || photo !== null) return;
    let alive = true;
    const id = window.setInterval(() => {
      fetch(`${API_URL}/public/feedback/${encodeURIComponent(token)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: FeedbackCtx | null) => { if (alive && d?.hasPhoto) setPhonePhoto(true); })
        .catch(() => undefined);
    }, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, [ipad, step, ctx.askPhoto, phonePhoto, photo, token]);

  async function textLink() {
    try { await post(`/public/feedback/${token}/text-link`); setTexted(true); } catch { /* ignore */ }
  }

  if (ctx.expired) {
    return <Shell ipad={ipad}><div style={{ ...center, paddingTop: 120 }}><div style={{ fontSize: 42 }}>💅</div><p style={{ ...lead, marginTop: 14 }}>{t.expired}</p></div></Shell>;
  }

  const reasonText = (r: string) => `${REASON_ICON[r] ?? '•'} ${ctx.lang === 'vi' ? (REASON_VI[r] ?? r) : r}`;
  const googleQr = `${origin}/f/${token}/google?src=qr`;
  const smallGoogle = google ? (
    <div style={{ textAlign: 'center', fontSize: ipad ? 15 : 13, color: C.faint, lineHeight: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {ipad && <img src={qrImg(googleQr, 120)} alt="" width={52} height={52} style={{ borderRadius: 6, background: '#fff', padding: 3, border: `1px solid ${C.line}`, opacity: 0.85 }} />}
      <span>{t.googleLine} {ipad ? t.onGoogle : <a href={appDeepLink(google)} onClick={tapGoogle} style={{ color: C.faint }}>{t.onGoogle}</a>}.</span>
    </div>
  ) : null;

  // ---------------------------------------------------------------- ask
  if (step === 'ask') {
    const choice = (kind: 'HAPPY' | 'UNHAPPY') => {
      const happy = kind === 'HAPPY';
      const onTap = () => { if (busy) return; if (happy) answer('HAPPY'); else setStep('form'); };
      if (ipad) {
        return (
          <button type="button" onClick={onTap} disabled={busy} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(6px, 1.6vh, 14px)', padding: 'clamp(16px, 3.6vh, 34px) 20px', borderRadius: 28, background: C.card, border: `2px solid ${C.line}`, boxShadow: '0 10px 30px rgba(23,20,18,.07)', cursor: 'pointer', fontFamily: 'inherit', color: C.ink }}>
            <span style={{ width: 'clamp(62px, 12vh, 104px)', height: 'clamp(62px, 12vh, 104px)', borderRadius: '50%', background: happy ? C.good : C.warm, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'clamp(34px, 6.6vh, 58px)' }}>{happy ? '😊' : '😕'}</span>
            <b style={{ fontSize: 'clamp(21px, 3.5vh, 30px)' }}>{happy ? t.happy : t.notQuite}</b>
            <span style={{ fontSize: 'clamp(14px, 2vh, 17px)', color: C.muted }}>{happy ? t.happySub : t.notQuiteSub}</span>
          </button>
        );
      }
      return (
        <button type="button" onClick={onTap} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18, borderRadius: 22, border: `1.5px solid ${C.line}`, background: C.card, boxShadow: '0 6px 18px rgba(23,20,18,.05)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: C.ink, width: '100%' }}>
          <span style={{ width: 56, height: 56, borderRadius: '50%', background: happy ? C.good : C.warm, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 31, flexShrink: 0 }}>{happy ? '😊' : '😕'}</span>
          <span><b style={{ fontSize: 19, display: 'block' }}>{happy ? t.happy : t.notQuite}</b><small style={{ fontSize: 14, color: C.muted }}>{happy ? t.happySub : t.notQuiteSub}</small></span>
          <span style={{ marginLeft: 'auto', color: C.faint, fontSize: 22 }}>›</span>
        </button>
      );
    };

    if (ipad) {
      return (
        <div style={{ width: '100%', maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
          {header}
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 'clamp(28px, 5.4vh, 44px)', letterSpacing: '-.01em', lineHeight: 1.12, color: C.ink, margin: 'clamp(12px, 3.4vh, 30px) 0 clamp(8px, 1.4vh, 12px)' }}>{t.howShort}</div>
          {ctx.staffName && (
            <div style={{ marginBottom: 'clamp(12px, 3vh, 26px)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 16px 8px 8px', borderRadius: 999, background: C.card, border: `1px solid ${C.line}`, color: C.ink }}>
                <Avatar ctx={ctx} accent={accent} size={38} />
                <span style={{ fontSize: 17, fontWeight: 600 }}>{ctx.staffName}{service ? ` · ${service}` : ''}</span>
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'clamp(14px, 2.4vw, 26px)', padding: '0 clamp(12px, 3vw, 0px)' }}>{choice('HAPPY')}{choice('UNHAPPY')}</div>
          {err && <p style={{ color: C.bad, marginTop: 14 }}>{err}</p>}
          {footer && <div style={{ marginTop: 'clamp(12px, 3vh, 26px)' }}>{footer}</div>}
        </div>
      );
    }
    return (
      <Shell ipad={false}>
        <div style={{ background: accent, backgroundImage: `radial-gradient(120% 90% at 10% 0%, rgba(255,255,255,.24), rgba(255,255,255,0) 55%), linear-gradient(165deg, ${accent}, ${accent} 45%, rgba(20,12,24,.3) 140%)`, color: '#fff', padding: '46px 22px 72px', position: 'relative' }}>
          <div style={{ ...eyebrow, color: 'rgba(255,255,255,.78)' }}>✦ {ctx.salonName}</div>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 31, lineHeight: 1.14, marginTop: 10, letterSpacing: '-.01em' }}>{t.how(first)}</div>
          {ctx.staffName && (
            <div style={{ position: 'absolute', left: 22, right: 22, bottom: -44, background: '#fff', borderRadius: 20, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 12px 30px rgba(23,20,18,.12)', color: C.ink }}>
              <Avatar ctx={ctx} accent={accent} size={46} />
              <div><b style={{ fontSize: 15.5 }}>{t.did(ctx.staffName, service)}</b><div style={{ fontSize: 13, color: C.muted }}>{fmtVisit(ctx.visitAt, ctx.lang)}</div></div>
            </div>
          )}
        </div>
        <div style={{ flex: 1, padding: ctx.staffName ? '66px 22px 22px' : '22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {choice('HAPPY')}{choice('UNHAPPY')}
          {err && <p style={{ color: C.bad }}>{err}</p>}
          <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 13, color: C.faint, paddingTop: 24 }}>{t.oneTap}</div>
        </div>
      </Shell>
    );
  }

  // ---------------------------------------------------------------- happy
  if (step === 'happy' || step === 'later') {
    if (step === 'later' || !google) {
      return (
        <Shell ipad={ipad}>
          <div style={{ ...center, paddingTop: ipad ? 'clamp(30px, 10vh, 90px)' : 120, flex: 1 }}>
            <div style={{ fontSize: ipad ? 'clamp(40px, 7vh, 64px)' : 48 }}>💕</div>
            <div style={{ ...eyebrow, color: C.faint, marginTop: 18 }}>{t.thanks(first)}</div>
            <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: ipad ? 44 : 29, marginTop: 8 }}>{t.seeYou}</div>
          </div>
          {ipad && onDone && <Footer ipad><button type="button" onClick={onDone} style={ghost(true)}>{t.done}</button></Footer>}
        </Shell>
      );
    }
    if (ipad) {
      return (
        <Shell ipad>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(24px, 5vw, 70px)', padding: 'clamp(14px, 3.4vh, 30px) clamp(20px, 5vw, 60px)', overflowY: 'auto' }}>
            <div style={{ flex: 1, maxWidth: 520 }}>
              <div style={{ fontSize: 'clamp(38px, 7vh, 64px)' }}>😊</div>
              <div style={{ ...eyebrow, color: C.faint, marginTop: 14 }}>{t.thanks(first)}</div>
              <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 'clamp(30px, 5.6vh, 46px)', marginTop: 10, lineHeight: 1.12 }}>{t.glad}</div>
              <p style={{ fontSize: 'clamp(16px, 2.5vh, 21px)', lineHeight: 1.5, color: C.muted, margin: 'clamp(8px, 1.8vh, 16px) 0 0' }}>{t.askIpad}</p>
              <div style={{ color: C.star, fontSize: 'clamp(22px, 3.6vh, 30px)', letterSpacing: 5, marginTop: 'clamp(10px, 2.4vh, 22px)' }}>★★★★★</div>
              <div style={{ display: 'flex', gap: 14, marginTop: 'clamp(12px, 3vh, 26px)', flexWrap: 'wrap' }}>
                {ctx.hasPhone && <button type="button" onClick={textLink} disabled={texted} style={ghost(true)}>{texted ? t.texted : t.textMe}</button>}
                {onDone && <button type="button" onClick={onDone} style={ghost(true)}>{t.done}</button>}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ background: '#fff', padding: 14, borderRadius: 18, border: `1px solid ${C.line}`, boxShadow: '0 8px 24px rgba(23,20,18,.08)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrImg(googleQr, 460)} alt="Google review QR" style={{ width: 'min(290px, 36vh)', height: 'auto', display: 'block' }} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: C.ink2, marginTop: 14 }}>{t.camera}</div>
            </div>
          </div>
          {left !== null && <div style={timer}>{t.returns(Math.max(0, left))}</div>}
        </Shell>
      );
    }
    return (
      <Shell ipad={false}>
        <div style={{ flex: 1, padding: '58px 22px 22px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: C.good, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42, margin: '0 auto' }}>😊</div>
          <div style={{ ...eyebrow, color: C.faint, textAlign: 'center', marginTop: 20 }}>{t.thanks(first)}</div>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 29, textAlign: 'center', marginTop: 8 }}>{t.glad}</div>
          <p style={{ textAlign: 'center', fontSize: 15.5, lineHeight: 1.55, color: C.muted, margin: '10px 4px 22px' }}>{t.ask(ctx.staffName)}</p>
          <div style={{ borderRadius: 22, background: '#fff', border: `1.5px solid ${C.line}`, padding: 18, boxShadow: '0 10px 26px rgba(23,20,18,.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, color: '#4285f4', boxShadow: '0 1px 3px rgba(0,0,0,.18)' }}>G</span>
              <div><b style={{ fontSize: 15 }}>{ctx.salonName}</b><div style={{ fontSize: 12.5, color: C.muted }}>Google Maps</div></div>
            </div>
            <div style={{ color: C.star, fontSize: 28, letterSpacing: 6, margin: '12px 0 14px', textAlign: 'center' }}>★★★★★</div>
            <a href={appDeepLink(google)} onClick={tapGoogle} style={{ ...primary(accent), textDecoration: 'none' }}>{t.write}</a>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink2, margin: '22px 0 10px' }}>{t.mention}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{t.hints(ctx.staffName, service).map((h) => <span key={h} style={chip(false, accent)}>{h}</span>)}</div>
        </div>
        <Footer><button type="button" onClick={() => setStep('later')} style={ghost(false)}>{t.later}</button></Footer>
      </Shell>
    );
  }

  // ------------------------------------------------------------- photo
  // capture="environment" opens the camera straight away on phones and iPads;
  // they still offer "Photo library" from the same sheet.
  const photoInput = <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => pickPhoto(e.target.files?.[0])} />;
  const photoDone = (big: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderRadius: 16, background: C.good, border: '1.5px solid #bbf7d0' }}>
      {photoPreview
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photoPreview} alt="" style={{ width: big ? 72 : 58, height: big ? 72 : 58, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
        : <span style={{ width: big ? 72 : 58, height: big ? 72 : 58, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>📷</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: big ? 18 : 15.5, color: '#166534' }}>✓ {phonePhoto && !photo ? t.photoGot : t.photoOk}</b>
        <div style={{ fontSize: big ? 15 : 13, color: C.muted, marginTop: 2 }}>{t.photoGotSub}</div>
      </div>
      {photo && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy} style={{ height: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${C.line}`, background: '#fff', font: '600 13px system-ui', color: C.ink2, cursor: 'pointer' }}>{photoBusy ? '…' : t.photoChange}</button>
          <button type="button" onClick={() => { setPhoto(''); setPhotoPreview(null); }} style={{ height: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${C.line}`, background: '#fff', font: '600 13px system-ui', color: C.muted, cursor: 'pointer' }}>{t.photoRemove}</button>
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------- form
  if (step === 'form') {
    const toggle = (r: string) => setPicked((v) => (v.includes(r) ? v.filter((x) => x !== r) : [...v, r]));
    return (
      <Shell ipad={ipad}>
        <div className="fbf-scroll" style={{ flex: 1, minHeight: 0, padding: ipad ? 'clamp(14px, 3.6vh, 36px) clamp(20px, 5vw, 60px) 0' : '46px 22px 16px', display: 'flex', flexDirection: 'column', overflowY: 'auto', maxWidth: ipad ? 1100 : undefined, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          <style>{FORM_CSS}</style>
          {!ipad && <button type="button" onClick={() => setStep('ask')} style={{ background: 'none', border: 'none', padding: 0, color: C.muted, font: '600 14px system-ui', cursor: 'pointer', alignSelf: 'flex-start' }}>‹ {t.back}</button>}
          <div style={{ ...eyebrow, color: C.faint, marginTop: ipad ? 0 : 16 }}>{t.sorry(first)}</div>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: ipad ? 'clamp(26px, 5vh, 44px)' : 27, marginTop: 6, lineHeight: 1.14 }}>{t.better}</div>
          <p style={{ fontSize: ipad ? 'clamp(14px, 2vh, 17px)' : 14.5, lineHeight: 1.5, color: C.muted, margin: ipad ? '6px 0 clamp(10px, 2vh, 16px)' : '8px 0 16px' }}>{t.lock}</p>
          <div className={ipad ? 'fbf-grid' : undefined}>
          <div className="fbf-col">
          <div style={label(ipad)}>{t.tapAll}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: ipad ? 'clamp(8px, 1.3vh, 12px)' : 8 }}>
            {ctx.reasons.map((r) => (
              <button key={r} type="button" onClick={() => toggle(r)} style={{ ...chip(picked.includes(r), accent), fontSize: ipad ? 'clamp(15px, 2.3vh, 19px)' : 14.5, padding: ipad ? 'clamp(9px, 1.7vh, 16px) clamp(14px, 1.8vw, 22px)' : '10px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>{reasonText(r)}</button>
            ))}
          </div>
          <div style={{ ...label(ipad), marginTop: ipad ? 'clamp(12px, 2.2vh, 18px)' : 18 }}>{t.more} <span style={{ fontWeight: 500, color: C.faint }}>· {t.optional}</span></div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t.placeholder} rows={ipad ? 2 : 3} maxLength={1000}
            style={{ width: '100%', boxSizing: 'border-box', border: `1.5px solid ${C.line}`, borderRadius: 16, background: '#fff', padding: '13px 15px', fontSize: ipad ? 'clamp(16px, 2.2vh, 18px)' : 16, lineHeight: 1.45, color: C.ink, fontFamily: 'inherit', resize: 'none', minHeight: ipad ? 'clamp(64px, 11vh, 96px)' : 96, flexShrink: 0 }} />
          </div>
          <div className="fbf-col">
          {ctx.askPhoto && (
            <>
              <div className="fbf-photo-label" style={{ ...label(ipad), marginTop: ipad ? 'clamp(12px, 2.2vh, 18px)' : 18 }}>{t.photo} <span style={{ fontWeight: 500, color: C.faint }}>· {t.optional}</span></div>
              {photoInput}
              {ipad ? (
                (photo || (phonePhoto && photo === null)) ? photoDone(true) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 16px', borderRadius: 16, background: '#fff', border: `1.5px dashed ${C.line}` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrImg(`${origin}/f/${token}/photo`, 260)} alt="" style={{ width: 'clamp(76px, 12vh, 104px)', height: 'clamp(76px, 12vh, 104px)', borderRadius: 10, border: `1px solid ${C.line}`, padding: 4, background: '#fff', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 18 }}>📷 {t.photoPhone}</b>
                      <div style={{ fontSize: 15.5, color: C.muted, marginTop: 3, lineHeight: 1.45 }}>{t.photoPhoneSub}</div>
                      {canCamera && (
                        <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
                          style={{ marginTop: 10, height: 44, padding: '0 18px', borderRadius: 999, border: `1.5px solid ${accent}55`, background: '#fff', color: accent, font: '600 15px system-ui', cursor: 'pointer' }}>
                          {photoBusy ? t.photoBusy : t.photoHere}
                        </button>
                      )}
                    </div>
                  </div>
                )
              ) : photo ? photoDone(false) : (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '14px 15px', borderRadius: 16, background: '#fff', border: `1.5px dashed ${accent}66`, cursor: 'pointer', fontFamily: 'inherit', color: C.ink }}>
                  <span style={{ width: 46, height: 46, borderRadius: 14, background: `${accent}14`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{photoBusy ? '…' : '📷'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: 15.5 }}>{photoBusy ? t.photoBusy : t.photo}</b>
                    <span style={{ display: 'block', fontSize: 13, color: C.muted, marginTop: 2 }}>{t.photoSub}</span>
                  </span>
                  <span style={{ color: accent, fontSize: 22, fontWeight: 300 }}>+</span>
                </button>
              )}
            </>
          )}
          {ctx.hasPhone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, padding: '13px 15px', borderRadius: 16, background: '#fff', border: `1.5px solid ${C.line}` }}>
              <div style={{ flex: 1 }}><b style={{ fontSize: ipad ? 18 : 15 }}>{t.contact}</b>{ctx.maskedPhone && <div style={{ fontSize: ipad ? 16 : 13, color: C.muted, marginTop: 2 }}>{ctx.maskedPhone}</div>}</div>
              <button type="button" role="switch" aria-checked={contact} onClick={() => setContact((v) => !v)} style={{ width: ipad ? 60 : 50, height: ipad ? 36 : 30, borderRadius: 999, border: 'none', background: contact ? accent : '#d6d3d1', position: 'relative', flexShrink: 0, cursor: 'pointer' }}>
                <span style={{ position: 'absolute', top: 3, [contact ? 'right' : 'left']: 3, width: ipad ? 30 : 24, height: ipad ? 30 : 24, borderRadius: '50%', background: '#fff' }} />
              </button>
            </div>
          )}
          </div>
          </div>
          {err && <p style={{ color: C.bad, margin: '12px 0 0' }}>{err}</p>}
          {ipad && <div style={{ height: 12, flexShrink: 0 }} />}
        </div>
        <Footer ipad={ipad}>
          {ipad && <button type="button" onClick={() => setStep('ask')} style={ghost(true)}>{t.back}</button>}
          <button type="button" onClick={() => answer('UNHAPPY')} disabled={busy || photoBusy} style={{ ...primary(accent), ...(ipad ? { width: 'auto', padding: '0 40px', minHeight: 'clamp(48px, 7vh, 58px)' } : {}), opacity: busy ? 0.6 : 1 }}>{busy ? t.sending : t.send}</button>
        </Footer>
      </Shell>
    );
  }

  // ---------------------------------------------------------------- sent
  const willCall = contact && ctx.hasPhone;
  return (
    <Shell ipad={ipad}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: ipad ? 'clamp(20px, 6vh, 60px) clamp(20px, 5vw, 60px) 20px' : '96px 22px 18px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto' }}>
          <div style={{ width: ipad ? 'clamp(64px, 11vh, 100px)' : 84, height: ipad ? 'clamp(64px, 11vh, 100px)' : 84, borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: ipad ? 'clamp(32px, 5.4vh, 48px)' : 40, margin: '0 auto', boxShadow: `0 14px 30px ${accent}55` }}>✓</div>
          <div style={{ ...eyebrow, color: C.faint, marginTop: 24 }}>{t.received}</div>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: ipad ? 'clamp(30px, 5.6vh, 46px)' : 29, marginTop: 8 }}>{t.thanksTelling}</div>
          <p style={{ fontSize: ipad ? 'clamp(16px, 2.5vh, 21px)' : 16, lineHeight: 1.55, color: C.muted, margin: '12px 6px 0' }}>{willCall ? t.willReach(ctx.replyHours) : t.willReachPlain}</p>
        </div>
        {willCall && ctx.maskedPhone && !ipad && (
          <div style={{ marginTop: 22, display: 'flex', gap: 10, alignItems: 'center', padding: '13px 15px', borderRadius: 16, background: '#fff', border: `1px solid ${C.line}`, fontSize: 14, color: C.ink2 }}>💬 <span>{t.expect(ctx.maskedPhone, ctx.salonName)}</span></div>
        )}
        {!ipad && ctx.askPhoto && !photo && !ctx.hasPhoto && (
          <>
            {photoInput}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
              style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 16, background: '#fff', border: `1.5px dashed ${accent}66`, fontFamily: 'inherit', fontSize: 14.5, color: C.ink2, cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 20 }}>📷</span>
              <span style={{ flex: 1 }}><b>{photoBusy ? t.photoBusy : t.photoAfter}</b> <span style={{ color: C.faint }}>· {t.optional}</span></span>
              <span style={{ color: accent, fontSize: 20 }}>+</span>
            </button>
          </>
        )}
        {!ipad && afterPhoto && <div style={{ marginTop: 14, textAlign: 'center', fontSize: 14.5, fontWeight: 600, color: '#166534' }}>{t.photoAfterOk}</div>}
        {err && step === 'sent' && <p style={{ color: C.bad, margin: '10px 0 0', textAlign: 'center' }}>{err}</p>}
        <div style={{ marginTop: 'auto', paddingTop: 30 }}>{smallGoogle}</div>
      </div>
      {ipad
        ? (left !== null && <div style={timer}>{t.returns(Math.max(0, left))}</div>)
        : <Footer><button type="button" onClick={() => setStep('later')} style={ghost(false)}>{t.done}</button></Footer>}
    </Shell>
  );
}

function Avatar({ ctx, accent, size }: { ctx: FeedbackCtx; accent: string; size: number }) {
  if (ctx.staffAvatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={ctx.staffAvatar} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return <span style={{ width: size, height: size, borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 ${Math.round(size * 0.36)}px system-ui`, flexShrink: 0 }}>{ctx.staffInitials || '✦'}</span>;
}

function fmtVisit(at: string, lang: 'en' | 'vi'): string {
  try { return new Date(at).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
}

function Shell({ ipad, children }: { ipad: boolean; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: ipad ? 0 : '100dvh', flex: ipad ? 1 : undefined, width: '100%', background: C.page, color: C.ink, display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', colorScheme: 'light', WebkitTapHighlightColor: 'transparent', boxSizing: 'border-box' }}>
      {children}
    </div>
  );
}

function Footer({ children, ipad }: { children: React.ReactNode; ipad?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 14, justifyContent: ipad ? 'flex-end' : 'stretch', padding: ipad ? 'clamp(8px, 1.8vh, 18px) clamp(20px, 5vw, 60px) clamp(10px, 2.6vh, 26px)' : '14px 22px', paddingBottom: ipad ? 'clamp(10px, 2.6vh, 26px)' : 'max(26px, env(safe-area-inset-bottom))', borderTop: ipad ? 'none' : `1px solid ${C.line}`, background: 'rgba(250,249,247,.96)', position: ipad ? 'static' : 'sticky', bottom: 0 }}>
      {children}
    </div>
  );
}

/** The "not quite" form on a shared screen: two columns when the glass is wide
 *  (reasons + note | photo + call-back), one when it is narrow, and no field
 *  is ever squeezed to nothing — the form scrolls instead. */
const FORM_CSS = `
.fbf-scroll > *{flex-shrink:0}
.fbf-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);column-gap:clamp(20px,3vw,40px);align-items:start}
.fbf-col{min-width:0;display:flex;flex-direction:column}
.fbf-grid .fbf-col + .fbf-col > .fbf-photo-label{margin-top:0 !important}
@media (max-width:860px){.fbf-grid{grid-template-columns:minmax(0,1fr)}.fbf-grid .fbf-col + .fbf-col > .fbf-photo-label{margin-top:clamp(12px,2.2vh,18px) !important}}
`;

const eyebrow: CSSProperties = { font: '700 11.5px system-ui', letterSpacing: '.14em', textTransform: 'uppercase' };
const center: CSSProperties = { textAlign: 'center', padding: '0 24px' };
const lead: CSSProperties = { fontSize: 16, lineHeight: 1.55, color: C.muted };
const timer: CSSProperties = { textAlign: 'center', fontSize: 14, color: C.faint, padding: '0 0 18px' };
const label = (ipad: boolean): CSSProperties => ({ fontFamily: 'system-ui', fontWeight: 600, fontSize: ipad ? 'clamp(15px, 2.2vh, 18px)' : 14, color: C.ink2, margin: ipad ? '0 0 clamp(6px, 1.2vh, 10px)' : '0 0 10px' });
const primary = (accent: string): CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', minHeight: 58, borderRadius: 999, border: 'none', background: accent, color: '#fff', font: '700 17.5px system-ui', boxShadow: `0 10px 24px ${accent}59`, cursor: 'pointer' });
const ghost = (ipad: boolean): CSSProperties => ({ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: ipad ? 'clamp(48px, 7vh, 60px)' : 50, padding: ipad ? '0 30px' : 0, width: ipad ? 'auto' : '100%', borderRadius: 999, border: `1.5px solid ${C.line}`, background: '#fff', color: C.ink, font: `600 ${ipad ? 18 : 15.5}px system-ui`, cursor: 'pointer' });
const chip = (on: boolean, accent: string): CSSProperties => ({ padding: '10px 14px', borderRadius: 999, border: `1.5px solid ${on ? accent : C.line}`, background: on ? accent : '#fff', font: '600 14.5px system-ui', color: on ? '#fff' : C.ink2, display: 'inline-flex', alignItems: 'center', gap: 6 });
