/**
 * The website chat widget, served as one JavaScript file.
 *
 * Dependency-free and framework-free on purpose: it runs inside a customer's
 * WordPress, Wix or hand-made site, next to whatever else is there, and must
 * not collide with any of it. So: a Shadow DOM for the styles, a single
 * global, and nothing assumed about the host page beyond `fetch`.
 *
 * It talks only to /public/chat/* on the API that served it. The API base is
 * read from the script's own src, so one file works for every deployment.
 *
 * Kept as a template literal WITHOUT backticks or "${" inside the JavaScript
 * — the widget is a string, and the string must stay one.
 */
export function widgetSource(): string {
  return WIDGET;
}

const WIDGET = `(function () {
  'use strict';
  if (window.__lumioChatLoaded) return;
  window.__lumioChatLoaded = true;

  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) { if ((all[i].src || '').indexOf('/public/chat/widget.js') >= 0) { script = all[i]; break; } }
  }
  if (!script) return;
  var slug = script.getAttribute('data-salon') || '';
  var src = script.src || '';
  if (!slug) { try { slug = new URL(src).searchParams.get('salon') || ''; } catch (e) {} }
  if (!slug) return;
  var API = src.replace(/\\/public\\/chat\\/widget\\.js.*$/, '') + '/public/chat/' + encodeURIComponent(slug);

  var visitor = '';
  try { visitor = localStorage.getItem('lumio_chat_v') || ''; } catch (e) {}
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(visitor)) {
    visitor = '';
    var alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var buf = new Uint8Array(24);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
    else for (var k = 0; k < buf.length; k++) buf[k] = Math.floor(Math.random() * 256);
    for (var j = 0; j < buf.length; j++) visitor += alphabet[buf[j] % alphabet.length];
    try { localStorage.setItem('lumio_chat_v', visitor); } catch (e) {}
  }

  var cfg = null, open = false, turns = [], lastAt = '', waitingSince = 0, timer = null, unread = 0, failed = false;

  function get(path) {
    return fetch(API + path, { method: 'GET', headers: { 'accept': 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; });
  }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.ok ? r.json() : null; });
  }

  var T = {
    vi: { title: 'Nhắn tin cho tiệm', sub: 'Trả lời trong vài giây', ph: 'Nhập tin nhắn…', send: 'Gửi', hello: 'Xin chào! Em có thể giúp gì cho anh/chị hôm nay?', staff: 'Nhân viên', bot: 'Trợ lý', fail: 'Không gửi được — thử lại nhé.', open: 'Chat với tiệm' },
    en: { title: 'Message us', sub: 'Replies in seconds', ph: 'Type a message…', send: 'Send', hello: 'Hi! How can we help you today?', staff: 'Staff', bot: 'Assistant', fail: 'Could not send — please try again.', open: 'Chat with us' }
  };
  function t(k) { var L = (cfg && cfg.lang === 'vi') ? T.vi : T.en; return L[k]; }

  var host = document.createElement('div');
  host.setAttribute('data-lumio-chat', '');
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  function css(color, side) {
    return '' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      '.b{position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:' + color + ';color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s}' +
      '.b:hover{transform:scale(1.06)}' +
      '.b svg{width:28px;height:28px}' +
      '.n{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 6px}' +
      '.p{position:fixed;bottom:90px;' + side + ':20px;z-index:2147483000;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}' +
      '.p.o{display:flex}' +
      '.h{background:' + color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px}' +
      '.h b{display:block;font-size:15px}' +
      '.h small{display:block;font-size:12px;opacity:.85;margin-top:2px}' +
      '.x{margin-left:auto;background:rgba(255,255,255,.18);border:0;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px}' +
      '.m{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:8px;background:#f5f6fa}' +
      '.r{max-width:82%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}' +
      '.r.u{align-self:flex-end;background:' + color + ';color:#fff;border-bottom-right-radius:4px}' +
      '.r.a{align-self:flex-start;background:#fff;color:#111827;border:1px solid #e5e7eb;border-bottom-left-radius:4px}' +
      '.l{font-size:11px;color:#6b7280;margin:-4px 0 0 4px;align-self:flex-start}' +
      '.ty{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:10px 14px;display:flex;gap:4px}' +
      '.ty i{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:lb 1s infinite}' +
      '.ty i:nth-child(2){animation-delay:.15s}.ty i:nth-child(3){animation-delay:.3s}' +
      '@keyframes lb{0%,80%,100%{opacity:.3}40%{opacity:1}}' +
      '.f{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}' +
      '.f textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 11px;font-size:14px;height:42px;max-height:90px;outline:none}' +
      '.f textarea:focus{border-color:' + color + '}' +
      '.f button{border:0;background:' + color + ';color:#fff;border-radius:10px;padding:0 14px;font-weight:700;cursor:pointer}' +
      '.f button:disabled{opacity:.5;cursor:default}' +
      '.e{font-size:12px;color:#b91c1c;padding:0 12px 8px;background:#fff}' +
      '.pw{font-size:10.5px;color:#9ca3af;text-align:center;padding:4px 0 6px;background:#fff}' +
      '@media (max-width:480px){.p{bottom:0;' + side + ':0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}}';
  }

  var styleEl = document.createElement('style');
  var bubble = document.createElement('button');
  bubble.className = 'b';
  bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.2-4.2A8 8 0 1 1 21 12z"/></svg>';
  var badge = document.createElement('span'); badge.className = 'n'; badge.style.display = 'none'; bubble.appendChild(badge);
  var panel = document.createElement('div'); panel.className = 'p';
  var header = document.createElement('div'); header.className = 'h';
  var list = document.createElement('div'); list.className = 'm';
  var err = document.createElement('div'); err.className = 'e'; err.style.display = 'none';
  var form = document.createElement('div'); form.className = 'f';
  var input = document.createElement('textarea'); input.rows = 1;
  var sendBtn = document.createElement('button');
  var powered = document.createElement('div'); powered.className = 'pw'; powered.textContent = 'Lumio Booking';
  form.appendChild(input); form.appendChild(sendBtn);
  panel.appendChild(header); panel.appendChild(list); panel.appendChild(err); panel.appendChild(form); panel.appendChild(powered);
  root.appendChild(styleEl); root.appendChild(panel); root.appendChild(bubble);

  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function render() {
    var html = '';
    var name = cfg && cfg.agentName ? cfg.agentName : t('bot');
    if (!turns.length) html += '<div class="r a">' + esc(cfg && cfg.greeting ? cfg.greeting : t('hello')) + '</div>';
    for (var i = 0; i < turns.length; i++) {
      var x = turns[i];
      if (x.role === 'user') html += '<div class="r u">' + esc(x.text) + '</div>';
      else html += '<div class="r a">' + esc(x.text) + '</div><div class="l">' + esc(x.human ? t('staff') : name) + '</div>';
    }
    if (waitingSince) html += '<div class="ty"><i></i><i></i><i></i></div>';
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
  }

  function merge(rows) {
    if (!rows || !rows.length) return;
    var gotReply = false;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      // The line we drew optimistically comes back with its server timestamp: replace, do not duplicate.
      var dup = false;
      for (var j = turns.length - 1; j >= 0 && j >= turns.length - 6; j--) {
        if (turns[j].role === r.role && turns[j].text === r.text && !turns[j].at) { turns[j] = r; dup = true; break; }
      }
      if (!dup) turns.push(r);
      if (r.at && r.at > lastAt) lastAt = r.at;
      if (r.role === 'assistant') gotReply = true;
    }
    if (gotReply) { waitingSince = 0; if (!open) { unread += 1; badge.textContent = String(unread); badge.style.display = 'flex'; } }
    render();
  }

  function poll() {
    get('/messages?visitor=' + encodeURIComponent(visitor) + (lastAt ? '&since=' + encodeURIComponent(lastAt) : '')).then(function (d) {
      if (d && d.turns) merge(d.turns);
      // A reply that never comes: stop the dots after a minute rather than for ever.
      if (waitingSince && Date.now() - waitingSince > 60000) { waitingSince = 0; render(); }
    }).catch(function () {});
  }

  function schedule() {
    if (timer) clearInterval(timer);
    // Quick while the visitor waits for an answer, relaxed otherwise, off when closed and quiet.
    var ms = waitingSince ? 1500 : (open ? 4000 : (turns.length ? 20000 : 0));
    if (ms) timer = setInterval(function () { poll(); if ((waitingSince ? 1500 : (open ? 4000 : 20000)) !== ms) schedule(); }, ms);
  }

  function send() {
    var text = input.value.replace(/\\s+/g, ' ').trim();
    if (!text || failed) return;
    input.value = '';
    err.style.display = 'none';
    turns.push({ role: 'user', text: text, at: '', human: false });
    waitingSince = Date.now();
    render(); schedule();
    post('/messages', { visitor: visitor, text: text }).then(function (d) {
      if (!d || !d.ok) { err.textContent = t('fail'); err.style.display = 'block'; waitingSince = 0; render(); }
      else setTimeout(poll, 1200);
    }).catch(function () { err.textContent = t('fail'); err.style.display = 'block'; waitingSince = 0; render(); });
  }

  function toggle(force) {
    open = typeof force === 'boolean' ? force : !open;
    panel.className = 'p' + (open ? ' o' : '');
    if (open) { unread = 0; badge.style.display = 'none'; poll(); setTimeout(function () { input.focus(); }, 50); }
    schedule();
  }

  bubble.addEventListener('click', function () { toggle(); });
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  get('').then(function (c) {
    if (!c || !c.ok) return;
    cfg = c;
    styleEl.textContent = css(c.color || '#6366f1', c.position === 'left' ? 'left' : 'right');
    header.innerHTML = '<div><b>' + esc(c.name || t('title')) + '</b><small>' + esc(t('sub')) + '</small></div>';
    var closeBtn = document.createElement('button'); closeBtn.className = 'x'; closeBtn.innerHTML = '&#x2715;'; closeBtn.setAttribute('aria-label', 'close');
    closeBtn.addEventListener('click', function () { toggle(false); });
    header.appendChild(closeBtn);
    input.placeholder = t('ph'); sendBtn.textContent = t('send');
    bubble.setAttribute('aria-label', t('open')); bubble.title = t('open');
    document.body.appendChild(host);
    // What the visitor said last time, if anything — and an unread badge if the salon answered since.
    poll(); schedule();
  }).catch(function () {});
})();
`;
