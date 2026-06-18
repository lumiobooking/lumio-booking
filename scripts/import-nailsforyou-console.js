/* ===========================================================================
   IMPORT "NAILS FOR YOU" SERVICES — run in the BROWSER CONSOLE.

   HOW TO USE:
   1. Log in to the *Nails For You* salon admin (chamnguyen881980@gmail.com).
   2. Open the Services page (so the app has called the API at least once).
   3. Press F12 → open the "Console" tab.
   4. Copy EVERYTHING in this file, paste into the console, press Enter.
   5. Watch the log. Safe to re-run (existing items are skipped by name).

   NOTE — please double-check these after import (menu was unclear):
     • Waxing → "Upper Lip" (menu price unreadable; set to $12 — verify)
     • Shellac → "Shellac Manicure & Regular Pedicure" (set to $65 — verify)
   NOT imported (no price on the menu) — add manually if offered:
     • Facial → "Nu Skin Facial", "Nu Skin Galvanic Facial"
   =========================================================================== */
(async () => { try {
  console.log('%cLumio import starting…', 'color:#6366f1;font-weight:bold');
  const auth = JSON.parse(localStorage.getItem('lumio_auth') || '{}');
  const token = auth.accessToken;
  if (!token) { alert('NOT logged in in this tab. Open lumiobooking.com, sign in to the Nails For You admin, go to the Services page, then re-run.'); return; }

  // Discover the API base URL from requests the app already made; fall back to a prompt (pre-filled).
  const names = performance.getEntriesByType('resource').map((e) => e.name);
  let base = (names.find((u) => /\/api\//.test(u)) || '').split('/api')[0];
  base = base ? base + '/api' : (prompt('Paste your API URL (ends with /api):', 'https://lumio-api-uqm6.onrender.com/api') || '');
  if (!base) { alert('No API URL provided — cancelled.'); return; }
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

  // name, price ($), duration (min), from = "+" pricing, desc (optional)
  const categories = [
    { name: 'Acrylic', services: [
      { name: 'Acrylic New Set', price: 62, dur: 60, from: true },
      { name: 'Acrylic Refill', price: 50, dur: 45, from: false },
    ]},
    { name: 'UV Gel', services: [
      { name: 'UV Gel New Set', price: 62, dur: 60, from: true },
      { name: 'UV Gel Refill', price: 50, dur: 45, from: false },
    ]},
    { name: 'Crystal', services: [
      { name: 'Crystal New Set', price: 62, dur: 60, from: true },
      { name: 'Crystal Refill', price: 50, dur: 45, from: false },
    ]},
    { name: 'Bio Gel', services: [
      { name: 'Bio Gel New Set', price: 55, dur: 60, from: true },
      { name: 'Bio Gel Refill', price: 48, dur: 45, from: true },
    ]},
    { name: 'Shellac', services: [
      { name: 'Shellac Color', price: 30, dur: 30, from: false },
      { name: 'Shellac French', price: 37, dur: 40, from: false },
      { name: 'Shellac Manicure', price: 35, dur: 40, from: false },
      { name: 'Shellac Pedicure', price: 46, dur: 50, from: false },
      { name: 'Shellac French Manicure', price: 42, dur: 45, from: false },
      { name: 'Shellac Manicure & Regular Pedicure', price: 65, dur: 75, from: false, desc: 'Please verify price' },
      { name: 'Shellac Manicure & Shellac Pedicure', price: 75, dur: 80, from: false },
      { name: 'Shellac Take Off (with Manicure)', price: 10, dur: 30, from: true },
    ]},
    { name: 'Natural Nails', services: [
      { name: 'Manicure', price: 22, dur: 30, from: false },
      { name: 'Pedicure', price: 35, dur: 45, from: false },
      { name: 'Pedicure & Manicure', price: 55, dur: 75, from: false },
    ]},
    { name: 'Luxury Mani & Pedi', services: [
      { name: 'Luxury Manicure', price: 45, dur: 45, from: false, desc: 'Shellac add-on +$10' },
      { name: 'Luxury Pedicure', price: 65, dur: 60, from: false, desc: 'Shellac add-on +$10' },
      { name: 'Luxury Mani & Pedi', price: 95, dur: 90, from: false, desc: 'Shellac add-on +$20' },
    ]},
    { name: 'Eyelash Extension', services: [
      { name: 'Single Lash', price: 80, dur: 90, from: false },
      { name: 'Triple Lash', price: 95, dur: 120, from: false },
    ]},
    { name: 'Waxing', services: [
      { name: 'Eyebrows Wax', price: 10, dur: 15, from: true },
      { name: 'Upper Lip Wax', price: 12, dur: 10, from: true, desc: 'Please verify price' },
      { name: 'Chin Wax', price: 8, dur: 10, from: true },
      { name: 'Side of Face Wax', price: 15, dur: 15, from: true },
      { name: 'Full Face Wax', price: 40, dur: 30, from: false },
      { name: 'Back Wax', price: 45, dur: 30, from: true },
      { name: 'Full Back Wax', price: 45, dur: 30, from: true },
      { name: 'Chest Wax', price: 35, dur: 30, from: true },
      { name: 'Stomach Wax', price: 20, dur: 20, from: true },
      { name: 'Full Arms Wax', price: 40, dur: 30, from: true },
      { name: 'Half Arms Wax', price: 25, dur: 20, from: false },
      { name: 'Under Arms Wax', price: 20, dur: 15, from: false },
      { name: 'Fingers Wax', price: 7, dur: 10, from: false },
      { name: 'Full Legs Wax', price: 45, dur: 40, from: true },
      { name: 'Half Legs (Upper) Wax', price: 30, dur: 25, from: false },
      { name: 'Half Legs (Lower) Wax', price: 25, dur: 25, from: false },
      { name: 'Full Legs + Bikini Line Wax', price: 60, dur: 45, from: true },
      { name: 'Bikini Line Wax', price: 25, dur: 20, from: true },
      { name: 'Brazilian Wax', price: 50, dur: 30, from: true },
      { name: 'Eyebrows & Lash Tinting', price: 30, dur: 30, from: true },
      { name: 'Eyebrows Tinting', price: 20, dur: 20, from: false },
      { name: 'Eyebrows Tinting & Wax', price: 30, dur: 30, from: false },
    ]},
    { name: 'Princess (Under 10)', services: [
      { name: 'Princess Manicure', price: 22, dur: 30, from: false },
      { name: 'Princess Pedicure', price: 35, dur: 40, from: false },
      { name: 'Princess Pedicure & Manicure', price: 55, dur: 60, from: false },
      { name: 'Princess Fingers & Toe Polish', price: 20, dur: 30, from: false },
    ]},
    { name: 'Facial', services: [
      { name: 'Mini Facial', price: 65, dur: 45, from: false },
      { name: 'Refresh Facial', price: 75, dur: 60, from: false },
    ]},
    { name: 'Body Massage', services: [
      { name: 'Full Body Massage (1hr)', price: 85, dur: 60, from: false },
      { name: 'Half Body Massage (30 mins)', price: 60, dur: 30, from: false },
      { name: 'Hot Stone Massage (30 mins)', price: 60, dur: 30, from: false },
      { name: 'Hot Stone Massage (1hr)', price: 85, dur: 60, from: false },
    ]},
    { name: 'Add-ons', services: [
      { name: 'Colour (add-on)', price: 30, dur: 15, from: false },
      { name: 'Shellac (add-on)', price: 30, dur: 15, from: false },
      { name: 'French / Ombre (add-on)', price: 15, dur: 15, from: false },
      { name: 'Take Off', price: 20, dur: 15, from: false },
      { name: 'Take Off & Manicure', price: 35, dur: 30, from: true },
      { name: 'Nail Repair', price: 7, dur: 10, from: true },
      { name: 'Nail Art', price: 7, dur: 10, from: true },
      { name: 'Finger Nail Polish', price: 7, dur: 10, from: true },
      { name: 'Toe Nail Polish', price: 30, dur: 20, from: false },
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
  alert('Nails For You import done! Categories +' + nc + ', services +' + ns + ', skipped ' + sk + '. Refresh the Services page.');
} catch (e) { console.error(e); alert('Import error: ' + (e && e.message ? e.message : e)); } })();
