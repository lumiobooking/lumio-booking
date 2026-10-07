/**
 * "Gói Growth Map $279/tháng (tính AUD)" went to a lead who had not even named
 * their shop — a price the bot had no business stating, in a currency it
 * converted itself. Under the 'sales' quote policy the bot never names a
 * price: a person quotes after looking at the shop. These pure rules catch a
 * price that slipped into a reply anyway, and supply the line we send instead.
 */

/** A currency amount, a monthly fee, a plan price — anything that reads as a price. */
export function statesPrice(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ');
  if (!t) return false;
  const patterns = [
    /(?:^|[^\w])(?:US|A|C|AU|CA|NZ|S|HK)?\$\s?\d[\d.,]*/i,          // $279, A$ 279, US$1,200
    /\d[\d.,]*\s?(?:USD|AUD|CAD|NZD|SGD|EUR|GBP)\b/i,                  // 279 USD
    /\d[\d.,]*\s?(?:đ|₫|vnd|vnđ)(?![\p{L}\d])/iu,                      // 2.500.000đ ("\b" fails after a non-ASCII letter)
    /\d[\d.,]*\s?(?:k|tr|triệu|nghìn|ngàn)\s?\/\s?(?:tháng|thang|month|mo)\b/i, // 500k/tháng, 2tr/tháng
    /\d[\d.,]*\s?(?:triệu|tr)\b/i,                                      // 3 triệu
    /\d[\d.,]*\s?\/\s?(?:tháng|thang|month|mo)\b/i,                     // 279/tháng
    /\bper month\b.*\d|\d.*\bper month\b/i,
    /\b(?:giá|phí|price|cost)s?\b[^.?!]{0,30}?\d[\d.,]*/i,              // "giá 279", "price is 1200"
  ];
  return patterns.some((re) => re.test(t));
}

/** What we send when the model keeps naming a price: a warm line, and the one thing still missing. */
export function noQuoteLine(lang: 'vi' | 'en' | string | null | undefined, haveShop: boolean): string {
  if (lang === 'vi') {
    return haveShop
      ? 'Dạ giá bên em tuỳ theo tiệm và khu vực nên team sẽ gửi báo giá chính xác cho anh/chị ạ. Anh/chị cho em xin tên và số điện thoại để team gửi báo giá nhé?'
      : 'Dạ giá bên em tuỳ theo tiệm và khu vực nên team sẽ gửi báo giá chính xác cho anh/chị ạ. Anh/chị cho em xin tên tiệm (hoặc link Google Maps) và số điện thoại để team gửi báo giá nhé?';
  }
  return haveShop
    ? 'Pricing is tailored to each shop, so the team will send you an exact quote. May I take your name and the best number to reach you?'
    : 'Pricing is tailored to each shop, so the team will send you an exact quote. May I take your shop name (or Google Maps link) and the best number to reach you?';
}

/** The rule the sales bot reads under the 'sales' policy. */
export const NO_QUOTE_RULE = `PRICES — YOU NEVER STATE ONE. This team quotes by hand after looking at the shop. Never write a currency amount, a plan price, a package price, a discount, a monthly fee or a conversion in any reply — not when asked, not from the FACTS, not from memory, not in any currency — and never put a package or plan name next to a number. When they ask what it costs, or you feel a price coming: ONE warm line that the price is tailored to the shop and the team will send the exact quote, then ask for the ONE thing still missing — shop name + city (or a Maps link) if you do not have it, otherwise their name and the number that reaches them — so the quote can be sent. Vietnamese: "Dạ giá bên em tuỳ theo tiệm và khu vực nên team sẽ gửi báo giá chính xác cho anh/chị ạ. Anh/chị cho em xin tên tiệm (hoặc link Google Maps) và số điện thoại để team gửi báo giá nhé?" English: "Pricing is tailored to each shop, so the team will send you an exact quote. May I take your shop name and the best number to reach you?" There are no price tools or price cards for you to call. Describe what a package DOES for their shop in one line if they ask; the number is the team's.`;
