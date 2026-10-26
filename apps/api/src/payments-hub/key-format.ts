/**
 * WHAT THE OWNER PASTED IS THE KEY THE PROVIDER ASKS FOR.
 *
 * A browser's password manager happily fills the salon owner's login email and
 * password into a "key" field, and Stripe's publishable key (pk_…) looks like
 * the right thing to paste. Both used to reach Stripe and come back as a vague
 * "invalid API key". Caught here, before anything is sent, with what to paste
 * instead. Pure.
 */
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function keyFormatProblem(provider: string, secret: string, webhookSecret?: string | null): string | null {
  const k = (secret ?? '').trim();
  if (looksLikeEmail(k)) {
    return 'Ô key đang chứa một email — có thể trình duyệt tự điền. Xoá đi rồi dán key của nhà cung cấp. · That field holds an email (your browser may have filled it in) — clear it and paste the provider key.';
  }
  if (provider === 'stripe') {
    if (/^pk_(live|test)_/.test(k)) {
      return 'Đây là Publishable key (pk_…), Lumio không cần. Dán Secret key (sk_…) hoặc Restricted key (rk_…). · That is the publishable key (pk_…) — paste the secret key (sk_…) or a restricted key (rk_…).';
    }
    if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(k)) {
      return 'Key Stripe phải bắt đầu bằng rk_live_, sk_live_ (hoặc rk_test_ / sk_test_ để thử). · A Stripe key starts with rk_live_ or sk_live_ (rk_test_ / sk_test_ for testing).';
    }
    const w = (webhookSecret ?? '').trim();
    if (w && !/^whsec_[A-Za-z0-9]+$/.test(w)) {
      return 'Webhook secret của Stripe bắt đầu bằng whsec_ (Developers → Webhooks → chọn endpoint → Signing secret). · A Stripe webhook secret starts with whsec_.';
    }
  }
  return null;
}
