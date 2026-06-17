// ===========================================================================
// One-time importer: loads Lux Nail Spa's service menu into the live system.
//
// Run (PowerShell):
//   $env:API_URL="https://lumio-api.onrender.com/api"; `
//   $env:EMAIL="nguyenviet14546@gmail.com"; `
//   $env:PASSWORD="your-admin-password"; `
//   node scripts/import-lux-services.mjs
//
// Run (Mac/Linux):
//   API_URL=https://lumio-api.onrender.com/api EMAIL=... PASSWORD=... node scripts/import-lux-services.mjs
//
// Safe to re-run: existing categories/services (matched by name) are skipped.
// ===========================================================================

const API_URL = process.env.API_URL || 'https://lumio-api.onrender.com/api';
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Missing EMAIL or PASSWORD env var. See the header of this file.');
  process.exit(1);
}

const cents = (d) => Math.round(d * 100);

// --- Menu data (parsed from the salon's price list) ---------------------------
// Each category: { name, services: [{ name, price, dur, from?, desc? }] }
const ARTIFICIAL = [
  // [name, fullSet, fillIn]  ("+" => priceFrom)
  ['Acrylic Crystal', 45, 35],
  ['Acrylic Gel Polish', 55, 45],
  ['Acrylic French White Tip', 45, 40],
  ['Solar Set', 50, 40],
  ['Pink & White Solar', 60, 55],
  ['Pink & Glitter', 60, 55],
  ['Color Ombre', 60, 50],
];

const categories = [
  {
    name: 'Artificial Nails',
    services: [
      ...ARTIFICIAL.flatMap(([n, full, fill]) => [
        { name: `${n} — Full set`, price: full, dur: 60, from: true },
        { name: `${n} — Fill-in`, price: fill, dur: 45, from: true },
      ]),
      { name: 'Gel-X (With Gel Polish) — Full set', price: 60, dur: 60, from: false, desc: 'Pre-shaped soft extensions. Strong but flexible, natural finish.' },
    ],
  },
  {
    name: 'Builder Gel (With Gel Polish)',
    services: [
      { name: 'Builder Gel — Full set', price: 60, dur: 60, from: true },
      { name: 'Builder Gel — Refill', price: 50, dur: 45, from: true },
    ],
  },
  {
    name: 'T.A.P Gel',
    services: [
      { name: 'T.A.P Gel — Full set', price: 60, dur: 60, from: true },
      { name: 'T.A.P Gel — Refill', price: 50, dur: 45, from: true },
    ],
  },
  {
    name: 'Dipping',
    services: [
      { name: 'Dipping Powder', price: 45, dur: 45, from: false },
      { name: 'Ombre Dipping Powder', price: 55, dur: 50, from: true },
      { name: 'French Dipping Powder', price: 50, dur: 50, from: true },
      { name: 'Tip Add-on', price: 5, dur: 10, from: false },
    ],
  },
  {
    name: 'Pedicure',
    services: [
      { name: 'Spa Pedicure', price: 35, dur: 45, desc: 'A classic professional pedicure for clean, smooth, and polished feet.' },
      { name: 'Hot Stone Pedicure', price: 40, dur: 50, desc: 'A classic professional pedicure for clean, smooth, and polished feet.' },
      { name: 'Collagen Spa Pedicure', price: 50, dur: 50, desc: 'Enjoy a collagen-rich pedicure that hydrates and softens the skin.' },
      { name: 'Golden Pedicure System', price: 60, dur: 60, desc: 'A luxurious gold-infused pedicure designed to firm skin, reduce fine lines, and brighten tone.' },
      { name: 'Diamond Pedicure System', price: 65, dur: 60, desc: 'Revitalize your feet with our rejuvenating Diamond Pedicure. Helps brighten, purify, and improve overall skin health.' },
      { name: 'Bomb Spa Pedicure', price: 70, dur: 60, desc: 'A relaxing pedicure using Pedi Bomb to soften skin and relieve stress.' },
      { name: 'Herbal Pedicure', price: 75, dur: 60, desc: 'A calming herbal treatment designed to detoxify, relax, and deeply moisturize your feet.' },
      { name: 'Cleopatra 24K Gold Pedicure', price: 85, dur: 60, desc: 'Enriched with pure 24K gold to rejuvenate the skin, improve elasticity, and restore a radiant, youthful glow.' },
    ],
  },
  {
    name: 'Add-On',
    services: [
      { name: 'Gel Polish Change', price: 25, dur: 20 },
      { name: 'Gel Add-On to Any Pedicure', price: 15, dur: 15 },
      { name: 'Paraffin Treatment', price: 10, dur: 15 },
      { name: 'Collagen Socks', price: 10, dur: 15 },
      { name: 'Professional Callus Treatment Add-On', price: 5, dur: 10 },
    ],
  },
];

// --- API helpers --------------------------------------------------------------
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.message || text}`);
  return data;
}

async function main() {
  console.log(`Logging in as ${EMAIL} …`);
  const login = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  const token = login.accessToken;
  if (login.user?.role !== 'SALON_ADMIN') {
    console.warn(`Warning: logged-in user role is ${login.user?.role}, expected SALON_ADMIN.`);
  }

  const existingCats = await api('/services/categories', { token });
  const existingServices = await api('/services', { token });
  const svcNames = new Set(existingServices.map((s) => s.name.toLowerCase()));

  let createdCats = 0, createdSvc = 0, skipped = 0;
  let sort = existingCats.length;

  for (const cat of categories) {
    let cur = existingCats.find((c) => c.name.toLowerCase() === cat.name.toLowerCase());
    if (!cur) {
      cur = await api('/services/categories', { method: 'POST', token, body: { name: cat.name, sortOrder: sort++ } });
      existingCats.push(cur);
      createdCats++;
      console.log(`+ Category: ${cat.name}`);
    }
    let order = 0;
    for (const s of cat.services) {
      if (svcNames.has(s.name.toLowerCase())) { skipped++; continue; }
      await api('/services', {
        method: 'POST', token,
        body: {
          name: s.name,
          description: s.desc || undefined,
          durationMinutes: s.dur,
          priceCents: cents(s.price),
          priceFrom: !!s.from,
          categoryId: cur.id,
          sortOrder: order++,
          isActive: true,
        },
      });
      svcNames.add(s.name.toLowerCase());
      createdSvc++;
      console.log(`    + ${s.name} — $${s.price}${s.from ? '+' : ''}`);
    }
  }

  console.log(`\nDone. Categories created: ${createdCats}, services created: ${createdSvc}, skipped (already existed): ${skipped}.`);
}

main().catch((e) => { console.error('\nImport failed:', e.message); process.exit(1); });
