'use client';

/**
 * Settings › Payments for a Vietnamese shop: enter the bank and the account
 * number ONCE. Every bill then gets its own VietQR with the exact amount and
 * the bill code — on the till screen and printed on the guest check — and
 * MoMo / ZaloPay scan the same code. The preview on the right is the real QR:
 * the owner can scan it to see their name come up before a guest ever does.
 */
import { useMemo, useState } from 'react';
import { ui } from '../../lib/ui';
import { useIsMobile } from '../../lib/responsive';
import { bankLabel, cleanAccount, plainUpper, qrDataUrl, vietQrPayload, VN_BANK_LIST } from '../../lib/vietqr';
import { shrinkQrImage } from '../../lib/pay-qr-image';

type Account = { bin: string; accountNo: string; accountName: string };
type Details = Record<string, { instructions?: string; qrUrl?: string }>;

const POPULAR = ['970436', '970415', '970418', '970405', '970407', '970422', '970416', '970432'];
const SAMPLE = 250_000;
const ACCENT = '#6366f1';

export function VietQrSetup({ shopName, pos, methods, vi, onSave }: {
  shopName: string;
  pos: { bankAccount?: Account | null; printPayQr?: boolean; paymentDetails?: Details } | undefined;
  methods: string[];
  vi: boolean;
  onSave: (path: string, body: unknown, label: string) => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const narrow = useIsMobile(860);
  const start = pos?.bankAccount ?? null;
  const [bin, setBin] = useState(start?.bin ?? '');
  const [other, setOther] = useState(() => !!start && !VN_BANK_LIST.some((b) => b.bin === start.bin));
  const [acct, setAcct] = useState(start?.accountNo ?? '');
  const [name, setName] = useState(start?.accountName ?? '');
  const [printQr, setPrintQr] = useState(pos?.printPayQr !== false);
  const [err, setErr] = useState('');

  const account = cleanAccount({ bin, accountNo: acct, accountName: name });
  const payload = useMemo(() => (account ? vietQrPayload(account, SAMPLE, 'LM123') : null), [account?.bin, account?.accountNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const qr = payload ? qrDataUrl(payload, 200) : null;
  const dirty = (start?.bin ?? '') !== bin || (start?.accountNo ?? '') !== acct.replace(/[^0-9A-Za-z]/g, '') || (start?.accountName ?? '') !== plainUpper(name) || (pos?.printPayQr !== false) !== printQr;
  const wallets = methods.filter((m) => m === 'MOMO' || m === 'ZALOPAY');

  function save() {
    setErr('');
    if ((bin || acct.trim()) && !account) {
      setErr(L('Chọn ngân hàng và nhập đúng số tài khoản (ít nhất 4 số).', 'Pick the bank and type the account number (at least 4 digits).'));
      return;
    }
    const text = account ? `${bankLabel(account.bin)} — ${account.accountName || ''}\n${L('Số TK', 'Account')}: ${account.accountNo}`.replace(' — \n', '\n') : '';
    onSave('pos', {
      bankAccount: account ? { bin: account.bin, accountNo: account.accountNo, accountName: account.accountName } : null,
      printPayQr: printQr,
      // Anything still reading the old single field sees the same account.
      transferInstructions: text,
    }, L('Tài khoản nhận tiền', 'Bank account'));
  }

  const chip = (on: boolean): React.CSSProperties => ({
    padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: `1.5px solid ${on ? ACCENT : 'var(--c334155)'}`, background: on ? 'rgba(99,102,241,.12)' : 'var(--c1e293b)', color: on ? ACCENT : 'var(--ccbd5e1)',
  });
  const step = (n: number, title: string, hint?: string) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
      <span style={{ width: 24, height: 24, borderRadius: 999, background: ACCENT, color: '#fff', fontSize: 12.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 14, color: 'var(--ce2e8f0)' }}>{title}</b>
        {hint && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{hint}</span>}
      </span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.25fr) minmax(260px, 0.75fr)', gap: 18, alignItems: 'start' }}>
        {/* The form: three things, once. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            {step(1, L('Ngân hàng nhận tiền', 'Bank'))}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {POPULAR.map((b) => (
                <button key={b} type="button" onClick={() => { setBin(b); setOther(false); }} style={chip(bin === b && !other)}>{bankLabel(b)}</button>
              ))}
              <select
                value={other || (bin && !POPULAR.includes(bin)) ? (VN_BANK_LIST.some((b) => b.bin === bin) ? bin : '_bin') : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '_bin') { setOther(true); setBin(''); } else if (v) { setOther(false); setBin(v); }
                }}
                aria-label={L('Ngân hàng khác', 'Other bank')}
                style={{ ...chip(!!bin && !POPULAR.includes(bin)), paddingRight: 8 }}
              >
                <option value="">{L('Ngân hàng khác…', 'Other bank…')}</option>
                {VN_BANK_LIST.filter((b) => !POPULAR.includes(b.bin)).map((b) => <option key={b.bin} value={b.bin}>{b.name}</option>)}
                <option value="_bin">{L('Không có trong danh sách (nhập mã BIN)', 'Not listed (type the BIN)')}</option>
              </select>
            </div>
            {other && (
              <input value={bin} inputMode="numeric" maxLength={6} onChange={(e) => setBin(e.target.value.replace(/\D/g, ''))}
                placeholder={L('Mã BIN 6 số của ngân hàng (VD: 970436)', '6-digit bank BIN (e.g. 970436)')} aria-label="BIN" style={{ ...ui.input, marginTop: 8, maxWidth: 280 }} />
            )}
          </div>

          <div>
            {step(2, L('Số tài khoản', 'Account number'))}
            <input value={acct} inputMode="numeric" maxLength={24} onChange={(e) => setAcct(e.target.value.replace(/[^0-9A-Za-z ]/g, ''))}
              placeholder="0123456789" aria-label={L('Số tài khoản', 'Account number')}
              style={{ ...ui.input, fontSize: 18, fontWeight: 700, letterSpacing: '.06em', padding: '11px 12px' }} />
          </div>

          <div>
            {step(3, L('Tên chủ tài khoản', 'Account holder'), L('Gõ có dấu cũng được — hệ thống tự đổi thành chữ in hoa không dấu như ngân hàng.', 'Type it any way — it becomes capitals without accents, as banks show it.'))}
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => setName(plainUpper(name))}
              placeholder={L('Nguyễn Văn A', 'NGUYEN VAN A')} aria-label={L('Tên chủ tài khoản', 'Account holder')} style={ui.input} />
            {name && plainUpper(name) !== name && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Sẽ hiện', 'Shown as')}: <b>{plainUpper(name)}</b></span>}
          </div>

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={printQr} onChange={(e) => setPrintQr(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: ACCENT }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontSize: 14, color: 'var(--ce2e8f0)' }}>{L('In mã QR lên phiếu tạm tính', 'Print the QR on the guest check')}</b>
              <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Mỗi bill in ra có mã QR riêng: đúng số tiền, nội dung là mã bill (VD: LM57) để đối soát. Màn hình thu ngân luôn hiện mã.', 'Each printed bill has its own QR: the exact amount, with the bill code (e.g. LM57) as the note. The till screen always shows it.')}</span>
            </span>
          </label>

          {err && <div style={{ ...ui.banner, margin: 0 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={save} disabled={!dirty} style={{ ...ui.primaryBtn, padding: '11px 18px', fontSize: 14, opacity: dirty ? 1 : 0.55 }}>
              {start ? L('Lưu thay đổi', 'Save changes') : L('Lưu tài khoản', 'Save account')}
            </button>
            {start && (
              <button type="button" onClick={() => { setBin(''); setAcct(''); setName(''); setOther(false); }} style={ui.dangerBtn}>
                {L('Bỏ tài khoản', 'Remove account')}
              </button>
            )}
            {!dirty && start && <span style={{ fontSize: 12.5, color: 'var(--ink-good)' }}>✓ {L('Đang dùng tài khoản này', 'This account is in use')}</span>}
          </div>
        </div>

        {/* What the guest gets: a real, scannable QR on the bill. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <div style={{ width: '100%', maxWidth: 290, background: '#fff', color: '#111827', borderRadius: 6, padding: '16px 16px 18px', boxShadow: '0 8px 24px rgba(15,23,42,.12)', border: '1px solid #e5e7eb', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, fontFamily: 'inherit' }}>{(shopName || L('Tên quán', 'Your shop')).toUpperCase()}</div>
            <div style={{ textAlign: 'center', fontWeight: 700, margin: '4px 0 6px' }}>{L('PHIẾU TẠM TÍNH', 'GUEST CHECK')}</div>
            <div style={{ textAlign: 'center', color: '#6b7280' }}>{L('Bàn A7 · Bill #123', 'Table A7 · Check #123')}</div>
            <div style={{ borderTop: '1px dashed #9ca3af', margin: '8px 0' }} />
            {[[L('2 Phở bò tái', '2 Beef pho'), '130.000'], [L('1 Gỏi cuốn', '1 Spring rolls'), '65.000'], [L('2 Trà đá', '2 Iced tea'), '55.000']].map(([a, b]) => (
              <div key={a} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{a}</span><span>{b}</span></div>
            ))}
            <div style={{ borderTop: '1px dashed #9ca3af', margin: '8px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 13 }}><span>{L('TỔNG CỘNG', 'TOTAL')}</span><span>250.000 đ</span></div>
            {printQr && (
              <>
                <div style={{ borderTop: '1px dashed #9ca3af', margin: '8px 0' }} />
                <div style={{ textAlign: 'center', fontWeight: 700 }}>{L('QUÉT MÃ ĐỂ CHUYỂN KHOẢN', 'SCAN TO PAY BY TRANSFER')}</div>
                <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
                  {qr
                    ? <img src={qr} alt={L('Mã VietQR mẫu', 'Sample VietQR')} style={{ width: 168, height: 168 }} />
                    : <div style={{ width: 168, height: 168, borderRadius: 8, background: '#f3f4f6', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 14, fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>{L('Chọn ngân hàng và nhập số tài khoản để thấy mã QR', 'Pick the bank and type the account number to see the QR')}</div>}
                </div>
                {account && (
                  <div style={{ textAlign: 'center' }}>
                    <div>{bankLabel(account.bin)} · {account.accountNo}</div>
                    {account.accountName && <div>{account.accountName}</div>}
                    <div>{L('Nội dung', 'Reference')}: LM123</div>
                  </div>
                )}
              </>
            )}
            <div style={{ textAlign: 'center', color: '#6b7280', marginTop: 8 }}>{L('Chưa phải hoá đơn', 'Not a receipt')}</div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)', textAlign: 'center', maxWidth: 290 }}>
            {qr
              ? L('Quét thử bằng app ngân hàng để chắc tên chủ tài khoản hiện đúng (không cần chuyển tiền).', 'Scan it with a banking app to check the holder’s name comes up (no need to send money).')
              : L('Bản xem trước phiếu in', 'Printed check preview')}
          </span>
        </div>
      </div>

      {wallets.length > 0 && <WalletQrs wallets={wallets} details={pos?.paymentDetails ?? {}} vi={vi} onSave={onSave} />}
    </div>
  );
}

/**
 * MoMo / ZaloPay: nothing to set up — both scan the VietQR above. A shop that
 * wants its own wallet QR uploads the picture (shrunk here) instead of
 * pasting a link it has to host somewhere.
 */
function WalletQrs({ wallets, details, vi, onSave }: { wallets: string[]; details: Details; vi: boolean; onSave: (path: string, body: unknown, label: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const anyOwn = wallets.some((w) => details[w]?.qrUrl);
  const [open, setOpen] = useState(anyOwn);
  return (
    <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, padding: 14, background: 'var(--c1e293b)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 260px' }}>
          <b style={{ fontSize: 14, color: 'var(--ce2e8f0)' }}>{L('Ví MoMo · ZaloPay', 'MoMo · ZaloPay')}</b>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Không cần cài riêng: app MoMo, ZaloPay và mọi app ngân hàng đều quét được mã VietQR ở trên.', 'Nothing to set up: MoMo, ZaloPay and every banking app scan the VietQR above.')}</span>
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ background: 'transparent', border: 'none', color: ACCENT, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          {open ? L('Ẩn', 'Hide') : L('Dùng mã QR riêng của ví', 'Use the wallet’s own QR')}
        </button>
      </div>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 12 }}>
          {wallets.map((w) => <WalletQr key={w} method={w} detail={details[w] ?? {}} vi={vi} onSave={onSave} />)}
        </div>
      )}
    </div>
  );
}

function WalletQr({ method, detail, vi, onSave }: { method: string; detail: { instructions?: string; qrUrl?: string }; vi: boolean; onSave: (path: string, body: unknown, label: string) => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const label = method === 'MOMO' ? 'MoMo' : 'ZaloPay';
  const [img, setImg] = useState(detail.qrUrl ?? '');
  const [text, setText] = useState(detail.instructions ?? '');
  const [err, setErr] = useState('');
  async function pick(f: File | undefined) {
    if (!f) return;
    setErr('');
    try { setImg(await shrinkQrImage(f)); } catch { setErr(L('Không đọc được ảnh. Chọn ảnh PNG hoặc JPG.', 'Could not read that picture. Use a PNG or JPG.')); }
  }
  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)' }}>
      <label style={{ width: 96, height: 96, flexShrink: 0, borderRadius: 10, border: '1.5px dashed var(--c475569)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', textAlign: 'center', fontSize: 11.5, color: '#64748b', padding: img ? 0 : 6 }}>
        <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => void pick(e.target.files?.[0])} />
        {img ? <img src={img} alt={`${label} QR`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : L('Bấm để chọn ảnh mã QR', 'Tap to add the QR picture')}
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 13.5, color: 'var(--ce2e8f0)' }}>{label}</b>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={120} placeholder={L('SĐT ví · tên chủ ví (tuỳ chọn)', 'Wallet phone · name (optional)')} style={{ ...ui.input, padding: '7px 9px', fontSize: 13 }} />
        {err && <span style={{ fontSize: 12, color: 'var(--ink-bad)' }}>{err}</span>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...ui.primaryBtn, padding: '7px 12px' }} onClick={() => onSave('pos', { paymentDetails: { [method]: { instructions: text.trim(), qrUrl: img } } }, label)}>{L('Lưu', 'Save')}</button>
          {img && <button type="button" style={ui.dangerBtn} onClick={() => { setImg(''); onSave('pos', { paymentDetails: { [method]: { instructions: text.trim(), qrUrl: '' } } }, label); }}>{L('Bỏ ảnh, dùng VietQR', 'Remove, use VietQR')}</button>}
        </div>
      </div>
    </div>
  );
}
