/* ===========================================================================
   IMPORT LUX NAIL SPA SERVICES — run in the BROWSER CONSOLE.

   HOW TO USE:
   1. Log in to the Lux Nail Spa admin (Salon dashboard) in your browser.
   2. Press F12 → open the "Console" tab.
   3. Copy EVERYTHING in this file, paste into the console, press Enter.
   4. Watch the log. Safe to re-run (existing items are skipped).
   =========================================================================== */
(async () => {
  const auth = JSON.parse(localStorage.getItem('lumio_auth') || '{}');
  const token = auth.accessToken;
  if (!token) { console.error('Not logged in — sign in to the salon admin first, then re-run.'); return; }

  // Discover the API base URL from requests the app already made.
  const names = performance.getEntriesByType('resource').map((e) => e.name);
  let base = (names.find((u) => /\/api\//.test(u)) || '').split('/api')[0];
  base = base ? base + '/api' : prompt('Paste your API URL (ends with /api):');
  if (!base) { console.error('No API URL found.'); return; }
  console.log('Using API:', base);

  const api = async (path, opts = {}) => {
    const r = await fetch(base + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const t = await r.text();
    const d = t ? JSON.parse(t) : null;
    if (!r.ok) throw new Error((opts.method || 'GET') + ' ' + path + ' → ' + r.status + ': ' + (d?.message || t));
    return d;
  };

  const c = (d) => Math.round(d * 100);
  const ART = [
    ['Acrylic Crystal', 45, 35], ['Acrylic Gel Polish', 55, 45], ['Acrylic French White Tip', 45, 40],
    ['Solar Set', 50, 40], ['Pink & White Solar', 60, 55], ['Pink & Glitter', 60, 55], ['Color Ombre', 60, 50],
  ];
  const categories = [
    { name: 'Artificial Nails', services: [
      ...ART.flatMap(([n, f, fi]) => [
        { name: n + ' — Full set', price: f, dur: 60, from: true },
        { name: n + ' — Fill-in', price: fi, dur: 45, from: true },
      ]),
      { name: 'Gel-X (With Gel Polish) — Full set', price: 60, dur: 60, from: false, desc: 'Pre-shaped soft extensions. Strong but flexible, natural finish.' },
    ]},
    { name: 'Builder Gel (With Gel Polish)', services: [
      { name: 'Builder Gel — Full set', price: 60, dur: 60, from: true },
      { name: 'Builder Gel — Refill', price: 50, dur: 45, from: true },
    ]},
    { name: 'T.A.P Gel', services: [
      { name: 'T.A.P Gel — Full set', price: 60, dur: 60, from: true },
      { name: 'T.A.P Gel — Refill', price: 50, dur: 45, from: true },
    ]},
    { name: 'Dipping', services: [
      { name: 'Dipping Powder', price: 45, dur: 45, from: false },
      { name: 'Ombre Dipping Powder', price: 55, dur: 50, from: true },
      { name: 'French Dipping Powder', price: 50, dur: 50, from: true },
      { name: 'Tip Add-on', price: 5, dur: 10, from: false },
    ]},
    { name: 'Pedicure', services: [
      { name: 'Spa Pedicure', price: 35, dur: 45, desc: 'A classic professional pedicure for clean, smooth, and polished feet.' },
      { name: 'Hot Stone Pedicure', price: 40, dur: 50, desc: 'A classic professional pedicure for clean, smooth, and polished feet.' },
      { name: 'Collagen Spa Pedicure', price: 50, dur: 50, desc: 'Enjoy a collagen-rich pedicure that hydrates and softens the skin.' },
      { name: 'Golden Pedicure System', price: 60, dur: 60, desc: 'A luxurious gold-infused pedicure designed to firm skin, reduce fine lines, and brighten tone.' },
      { name: 'Diamond Pedicure System', price: 65, dur: 60, desc: 'Revitalize your feet with our rejuvenating Diamond Pedicure. Helps brighten, purify, and improve overall skin health.' },
      { name: 'Bomb Spa Pedicure', price: 70, dur: 60, desc: 'A relaxing pedicure using Pedi Bomb to soften skin and relieve stress.' },
      { name: 'Herbal Pedicure', price: 75, dur: 60, desc: 'A calming herbal treatment designed to detoxify, relax, and deeply moisturize your feet.' },
      { name: 'Cleopatra 24K Gold Pedicure', price: 85, dur: 60, desc: 'Enriched with pure 24K gold to rejuvenate the skin, improve elasticity, and restore a radiant, youthful glow.' },
    ]},
    { name: 'Add-On', services: [
      { name: 'Gel Polish Change', price: 25, dur: 20 },
      { name: 'Gel Add-On to Any Pedicure', price: 15, dur: 15 },
      { name: 'Paraffin Treatment', price: 10, dur: 15 },
      { name: 'Collagen Socks', price: 10, dur: 15 },
      { name: 'Professional Callus Treatment Add-On', price: 5, dur: 10 },
    ]},
  ];

  const cats = await api('/services/categories');
  const svcs = await api('/services');
  const have = new Set(svcs.map((s) => s.name.toLowerCase()));
  let nc = 0, ns = 0, sk = 0, sort = cats.length;

  for (const cat of categories) {
    let cur = cats.find((x) => x.name.toLowerCase() === cat.name.toLowerCase());
    if (!cur) { cur = await api('/services/categories', { method: 'POST', body: { name: cat.name, sortOrder: sort++ } }); cats.push(cur); nc++; console.log('+ Category:', cat.name); }
    let order = 0;
    for (const s of cat.services) {
      if (have.has(s.name.toLowerCase())) { sk++; continue; }
      await api('/services', { method: 'POST', body: {
        name: s.name, description: s.desc || undefined, durationMinutes: s.dur,
        priceCents: c(s.price), priceFrom: !!s.from, categoryId: cur.id, sortOrder: order++, isActive: true,
      }});
      have.add(s.name.toLowerCase()); ns++; console.log('    + ' + s.name + ' — $' + s.price + (s.from ? '+' : ''));
    }
  }
  console.log('%cDone. Categories +' + nc + ', services +' + ns + ', skipped ' + sk + '.', 'color:#16a34a;font-weight:bold');
  alert('Import done! Categories +' + nc + ', services +' + ns + ', skipped ' + sk + '. Refresh the Services page.');
})();
