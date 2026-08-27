/**
 * The gates a SALES reply must pass before it is sent.
 *
 * Pure string functions, deliberately kept out of the service: they hold the
 * rules that were each written after a real conversation went wrong, and they
 * are the part most worth testing. Nothing here touches the database, so the
 * tests run in milliseconds and cannot rot when the schema moves.
 *
 * Every pattern below exists because a customer received the sentence it
 * matches. The comments say which one.
 */

/**
 * Sentences a SALES bot must never send, and the reason a rule in the prompt
 * was not enough.
 *
 * A prompt is advice. This is a gate. Both failures we saw in production were
 * the model closing a door nobody asked it to close — telling a karaoke-bar
 * owner we "only do nail, spa and restaurants", and telling a buyer that the
 * Messenger AI "has no separate price". Each ended a live conversation
 * politely, which is the kind of loss that never gets reported: the customer
 * simply leaves and the owner never learns why.
 *
 * Matching is on meaning-bearing fragments in both languages the bot speaks.
 * A false positive costs one extra model call; a false negative costs a
 * customer, so the list leans towards catching too much.
 */
const LEAD_KILLING_PATTERNS: RegExp[] = [
  // NOTE ON \b: JavaScript word boundaries are ASCII-only, so \b after "có"
  // or "vụ" never matches — the last letter carries a diacritic and is not a
  // word character. Two real phrases slipped through the first version of this
  // list for exactly that reason. Vietnamese patterns therefore use no
  // boundaries; English ones still can.
  // "we only do / specialise in X only"
  /(chỉ|thôi)\s*(chuyên|làm|phục vụ|nhận)/i,
  /chuyên[^.!?]{0,60}thôi/i,
  // "we have no service for / not yet any service for …"
  /(không|chưa)\s*(có|nhận|phục vụ|làm)[^.!?]{0,40}(dịch vụ|ngành|lĩnh vực|mảng)/i,
  /(không|chưa)\s*có\s*dịch\s*vụ/i,
  /(không|chưa)\s*(hỗ trợ|phục vụ)\s*(cho|ngành|quán|tiệm)/i,
  // "we have no experience with that" — a softer refusal, and just as final.
  /(chưa|không)\s*có\s*kinh\s*nghiệm/i,
  // "not really our strong suit" — self-deprecation used as a refusal.
  /(không|chưa)\s*(phải\s*)?(là\s*)?(diện|thế|điểm)\s*mạnh/i,
  /(không|chưa)\s*(thật sự\s*)?(phù hợp|hợp)\s*(với|lắm)/i,
  /\bnot\s+(really\s+)?our\s+(strong\s+suit|specialit?y|focus)\b/i,
  // Handing the customer to somebody else. Never, under any wording.
  /(đầu mối|đơn vị|bên|chỗ|agency)\s*(marketing\s*)?(khác|nào khác)/i,
  /(giới thiệu|chuyển)\s*(anh|chị|mình)?\s*(sang|qua|cho)\s*(bên|đơn vị|chỗ)\s*khác/i,
  /\b(another|a different)\s+(agency|provider|company)\s+(might|would|may)\b/i,
  /(không|chưa)\s*(phải\s*)?(là\s*)?(lựa chọn|đơn vị|nơi)\s*(tốt nhất|phù hợp)/i,
  /(cứ\s*)?(tìm|liên hệ)\s*(những\s*)?(đơn vị|bên|agency|công ty)\s*(chuyên|khác)/i,
  /chúc\s*(anh|chị|mình|bạn)[^.!?]{0,40}(tìm được|tìm ra)\s*(đối tác|đơn vị|bên)/i,
  /\byou\s+(might|may|should)\s+(want to\s+)?(look|try)\s+(for|at)\s+(a\s+)?(specialis|another|different)/i,
  /(chưa|không)\s*(từng\s*)?làm\s*(cho|với)\s*(ngành|quán|mô hình|loại)/i,
  /(chưa|không)\s*(rành|thạo|chuyên)\s*(về|mảng|ngành)/i,
  /\b(no|little|not much)\s+experience\s+(with|in)\b/i,
  /\bwe\s+(only|just)\s+(serve|do|work with|specialis[sz]e)\b/i,
  /\b(don't|do not|doesn't|does not)\s+(serve|support|work with|cover)\b/i,
  // "no separate price / not sold separately / only bundled"
  // The negation and the verb are not always neighbours: "không ĐƯỢC bán riêng"
  // slipped past a pattern that expected them adjacent, and one word was enough
  // to send the whole refusal through. Allow anything short in between.
  /(không|chưa|chẳng)[^.!?]{0,14}(bán|tính)\s*(riêng|lẻ)/i,
  /(không|chưa|chẳng)[^.!?]{0,14}giá\s*riêng/i,
  /chỉ\s*(có|bán|được)?\s*(bán\s*)?(kèm|theo\s*gói|trong\s*gói)/i,
  // Reproaching the customer for repeating themselves. "Anh hỏi lần thứ 5 rồi"
  // is the bot blaming a person for its own failure to answer, and it is the
  // last thing they read before leaving.
  /(hỏi|nhắn|nói)\s*(lại\s*)?(lần\s*)?(thứ\s*)?\d+\s*(lần\s*)?rồi/i,
  /(như|giống)\s*(em|tôi)\s*(đã\s*)?(nói|trả lời)\s*(ở\s*)?(trên|lúc nãy|rồi)/i,
  /\b(as I|like I)\s+(already\s+)?(said|mentioned|explained)\b/i,
  /\b(not sold|isn't sold|is not sold)\s+separately\b/i,
  /\bno\s+separate\s+price\b/i,
  /\bonly\s+(available|included)\s+(with|as part of)\b/i,

  // ── ASKING THE CUSTOMER TO QUALIFY THEMSELVES ──────────────────────────
  //
  // A moving company answered an ad, gave its name and its phone number, and
  // was asked back: "Lumio chúng em chuyên marketing cho tiệm nail, spa, nhà
  // hàng. Anh/chị có đang chạy một trong những ngành này không, hay anh/chị
  // đang tìm hiểu cho mục đích khác ạ?"
  //
  // Not one pattern above fired, because the sentence never refuses. It states
  // the specialty POSITIVELY and then hands the customer a question only they
  // can answer wrong. That is worse than a refusal: it sounds diligent, it
  // sounds polite, and it makes the customer do the disqualifying — after they
  // had already given us the two things we spend the whole conversation
  // trying to get.
  //
  // The rule the prompt already states — "the trades named are EXAMPLES, not a
  // boundary" — is exactly what the model broke. A gate is needed because a
  // prompt is advice.
  /(có\s*)?(đang\s*)?(phải\s*)?(chạy|làm|kinh doanh|mở|sở hữu|hoạt động)[^.!?]{0,40}(một trong (những|các)|thuộc)\s*(ngành|lĩnh vực|mảng|nhóm|loại hình)/i,
  /(một trong (những|các)|thuộc)\s*(ngành|lĩnh vực|mảng|nhóm|loại hình)[^.!?]{0,30}(không|ko)\s*[?ạa]*/i,
  // Offering "or are you asking for some other reason?" is handing them the
  // exit line and holding the door.
  /(mục đích|nhu cầu|lý do|việc)\s*(gì\s*)?khác\s*(không|ko|ạ|\?)/i,
  // "Let me just double-check you're the right kind of customer."
  /(xác nhận|xác minh|kiểm tra|hỏi)\s*(lại|rõ)?[^.!?]{0,50}(đúng|phải)\s*(là\s*)?(ngành|lĩnh vực|đối tượng|khách hàng|tiệm)/i,
  // No trailing \b: the stems are truncated on purpose ("industr" covers both
  // industry and industries), and a word boundary right after a truncated stem
  // can never match — the next character is always a letter. That is the same
  // \b trap the Vietnamese patterns above carry a warning about; it silently
  // disabled this line the first time it was written.
  /\b(are|is)\s+(you|your business|this)\s+(in|one of)\s+[^.!?]{0,40}(industr|categor|vertical|business)/i,
  /\bjust\s+to\s+(confirm|check|make sure)\b[^.!?]{0,70}\b(we|lumio)\s+(specialis|focus|work|serve|help)/i,
];

/** True when a sales reply disqualifies the customer instead of capturing them. */
export function killsTheLead(reply: string): boolean {
  const t = String(reply || '');
  return LEAD_KILLING_PATTERNS.some((re) => re.test(t));
}

/**
 * Did the customer ask something, and did the reply open with a brochure?
 *
 * Asked "does the AI reply on Instagram?" — a yes-or-no question — the bot
 * opened with "Lumio chuyên hỗ trợ các tiệm Nail & Spa…" and a bulleted list
 * of services, and never answered. A person who asks a direct question and
 * receives a catalogue concludes the answer is no, or that nobody is reading.
 *
 * The two halves are checked separately: the customer's message has to look
 * like a question, and the reply has to open by describing the company instead
 * of answering. Only both together is a miss.
 */
const QUESTION_SHAPE = /\?|\b(có|được|chưa)\b[^?]{0,60}\b(không|ko|k)\s*[?.]?\s*$|^(do|does|can|is|are|will|have|has)\b/i;
const BROCHURE_OPENER = /^(dạ[,\s]*)?(lumio|bên em|công ty em|chúng em|shop em|we|our team)\s*(là|chuyên|hỗ trợ|cung cấp|đang cung cấp|có các|hiện có|is|are|offers?|provides?|specialis|helps?)/i;

export function dodgesTheQuestion(userText: string, reply: string): boolean {
  const asked = QUESTION_SHAPE.test(String(userText || '').trim());
  if (!asked) return false;
  const first = String(reply || '').trim().split(/[.!?\n]/)[0] ?? '';
  return BROCHURE_OPENER.test(first.trim());
}

/**
 * Did the reply tell a customer mid-conversation that the chat just started?
 *
 * The stage direction that caused this is fixed at the source, but the sentence
 * is costly enough to be worth a second lock: somebody who has already sent
 * their shop, address and email, and is then told "anh/chị vừa mở chat nên em
 * chưa biết tiệm ở đâu", concludes nobody read any of it.
 */
const CLAIMS_FRESH_START = /(vừa|mới)\s*(mở|bắt đầu|vào)\s*(chat|cuộc trò chuyện|tin nhắn)|(chưa|không)\s*biết[^.!?]{0,30}(ở đâu|ngành gì|tên tiệm)|\b(you\s+)?just\s+(opened|started)\s+(the\s+)?(chat|conversation)\b/i;

export function claimsFreshStart(hasPriorContext: boolean, reply: string): boolean {
  if (!hasPriorContext) return false;
  return CLAIMS_FRESH_START.test(String(reply || ''));
}

/**
 * Has the customer said enough for us to know WHICH shop we are talking to?
 *
 * A link, a phone number, or a place named alongside a shop word. Deliberately
 * narrow: the cost of reading "not yet" is one extra question, and the cost of
 * reading "yes" too early is a price list handed to someone who has not said
 * who they are.
 */
const IDENTITY_SIGNAL = /(https?:\/\/|maps\.app|goo\.gl|facebook\.com|instagram\.com|\.com|\.vn)|(\+?\d[\d\s().-]{7,})|((tiệm|salon|spa|shop|quán|store|studio|nail)\s+\p{Lu}[\p{L}]+)|(\d+\s+\p{Lu}[\p{L}]+\s+(st|street|ave|avenue|rd|road|blvd|dr|drive|way|ln))/iu;

/** Money in any of the shapes the bot writes it. */
const STATES_A_PRICE = /([$₫€£]\s?\d|\d+\s?(usd|cad|aud|vnd|đ|k\/tháng)|\d{2,3}\s?\/\s?(tháng|month))/i;

/**
 * Did the reply hand over prices before finding out who is asking?
 *
 * The owner's concern is concrete and not paranoia: people ask to find out
 * whether Lumio already works with the salon down the road, competitors ask to
 * collect something to attack them with, and a free audit spent on the shop
 * next door to an existing client is worse than wasted. None of that is
 * prevented by refusing anybody — it is prevented by asking who they are
 * first, which a real buyer answers without hesitating.
 */
export function disclosesBeforeQualifying(customerWords: string, reply: string): boolean {
  if (IDENTITY_SIGNAL.test(String(customerWords || ''))) return false;
  return STATES_A_PRICE.test(String(reply || ''));
}

/**
 * Did the reply decide the customer's gender without being told?
 *
 * Vietnamese cannot address someone without choosing "anh" or "chị", and the
 * bot picked one: "Tiệm chị ở đâu vậy ạ?" to a person it had never been told
 * anything about. Guess wrong and you have called a man "chị" in the sentence
 * where you ask for his phone number — small, and exactly the kind of small
 * that makes someone decide this is a machine and stop typing.
 *
 * "anh/chị" is the form that is never wrong, so it is the default until the
 * customer's own words settle it. Fires only when the reply commits to one AND
 * nothing the customer wrote points either way; a false positive costs one
 * rewrite into a phrase that was always acceptable.
 */
// \b is ASCII-only, so \bchị\b never matches — the last letter carries a tone
// mark and is not a "word character". That bug ate a whole pattern list once
// already; here the boundaries are written with a Unicode letter class instead.
const BARE_GENDER = /(^|[^\p{L}])(anh|chị|ông|bà)(?![\p{L}])/iu;
const GENDER_STATED = /(^|[^\p{L}])(anh|chị|ông|bà|nam|nữ|mr|mrs|ms)(?![\p{L}])/iu;
/** "anh/chị" is the safe form — remove it before looking for a bare one. */
const SAFE_PAIR = /anh\s*\/\s*chị|chị\s*\/\s*anh/giu;

export function guessesGender(customerWords: string, reply: string): boolean {
  if (GENDER_STATED.test(String(customerWords || ''))) return false;
  return BARE_GENDER.test(String(reply || '').replace(SAFE_PAIR, ' '));
}

/** Vietnamese has tone marks no other language here uses; one is enough. */
export function looksVietnamese(text: string): boolean {
  return /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(String(text || ''));
}

/**
 * What we say when the model will not stop refusing.
 *
 * The gate rewrites once. If the rewrite is also a refusal, we stop asking and
 * send this instead: it is the same move the prompt describes, and it is the
 * only reply the owner ever wants when the bot has no answer — hand the person
 * to a human rather than tell them no.
 */
export function safeHandoffReply(conversation: string): string {
  return looksVietnamese(conversation)
    ? 'Dạ phần này để team em tư vấn trực tiếp cho đúng với tiệm mình ạ. Anh/chị cho em xin tên tiệm và số điện thoại, team gọi lại tư vấn ngay ạ.'
    : 'The team will advise you on that directly. May I take your shop name and the best number to reach you?';
}
