/* ===========================================================================
   LUMIO — RESTAURANT TEST DATA seeder  (run in the BROWSER CONSOLE)

   Loads a full test dataset for a large Vietnamese restaurant (US/CA/AU):
   24 tables (5 zones) + 33 menu items + 12 reservations for today.

   HOW TO USE
   1. In Super Admin, set a tenant's Business type to "Restaurant".
   2. Log in as that restaurant's admin, open the "Tables" page (or Calendar)
      so the app has called the API at least once.
   3. Press F12 -> "Console" tab -> paste this whole file -> Enter.
   4. Watch the log. Safe to re-run (existing items are skipped by name).
   =========================================================================== */
(async () => { try {
  console.log('%cLumio restaurant seed starting…', 'color:#6366f1;font-weight:bold');
  const auth = JSON.parse(localStorage.getItem('lumio_auth') || '{}');
  const token = auth.accessToken;
  if (!token) { alert('Not logged in in this tab. Sign in to the restaurant admin, open the Tables page, then re-run.'); return; }

  const urls = performance.getEntriesByType('resource').map((e) => e.name);
  let base = (urls.find((u) => /\/api\//.test(u)) || '').split('/api')[0];
  base = base ? base + '/api' : (prompt('Paste your API URL (ends with /api):', 'https://lumio-api-uqm6.onrender.com/api') || '');
  if (!base) { alert('No API URL provided — cancelled.'); return; }
  console.log('Using API:', base);

  const api = async (path, opts = {}) => {
    const r = await fetch(base + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const tx = await r.text(); const d = tx ? JSON.parse(tx) : null;
    if (!r.ok) throw new Error((opts.method || 'GET') + ' ' + path + ' -> ' + r.status + ': ' + (d?.message || tx));
    return d;
  };

  /* ---- 1) TABLES (24 tables, 5 zones) ---- */
  const TABLES = [
    ['M1', 2, 'Main Dining'], ['M2', 2, 'Main Dining'], ['M3', 4, 'Main Dining'], ['M4', 4, 'Main Dining'],
    ['M5', 4, 'Main Dining'], ['M6', 4, 'Main Dining'], ['M7', 6, 'Main Dining'], ['M8', 6, 'Main Dining'],
    ['M9', 4, 'Main Dining'], ['M10', 2, 'Main Dining'],
    ['W1', 2, 'Window'], ['W2', 2, 'Window'], ['W3', 4, 'Window'], ['W4', 4, 'Window'],
    ['P1', 4, 'Patio'], ['P2', 4, 'Patio'], ['P3', 6, 'Patio'], ['P4', 6, 'Patio'], ['P5', 8, 'Patio'],
    ['VIP1', 10, 'Private Room'], ['VIP2', 12, 'Private Room'],
    ['B1', 2, 'Bar'], ['B2', 2, 'Bar'], ['B3', 2, 'Bar'],
  ];
  const exTables = await api('/tables').catch(() => []);
  const haveT = new Set((exTables || []).map((t) => (t.name || '').toLowerCase()));
  let tmade = 0;
  for (let i = 0; i < TABLES.length; i++) {
    const [name, seats, area] = TABLES[i];
    if (haveT.has(name.toLowerCase())) continue;
    await api('/tables', { method: 'POST', body: { name, seats, area, sortOrder: i } });
    tmade++;
  }
  console.log('%cTables: created ' + tmade + ', skipped ' + (TABLES.length - tmade) + '.', 'color:#16a34a;font-weight:bold');

  /* ---- 2) MENU (33 dishes) ---- */
  const MENU = [
    ['Crispy Egg Rolls', 'Appetizers', 8], ['Fresh Spring Rolls', 'Appetizers', 7], ['Green Papaya Salad', 'Appetizers', 11], ['Fish-Sauce Chicken Wings', 'Appetizers', 12], ['Sizzling Vietnamese Crêpe', 'Appetizers', 13],
    ['Rare Beef Pho', 'Pho', 14], ['House Special Pho', 'Pho', 16], ['Chicken Pho', 'Pho', 14], ['Vegetarian Pho', 'Pho', 13],
    ['Spicy Hue Beef Noodle', 'Vermicelli', 15], ['Hanoi Grilled Pork Vermicelli', 'Vermicelli', 15], ['Grilled Pork Vermicelli Bowl', 'Vermicelli', 14], ['Crab & Tomato Noodle Soup', 'Vermicelli', 15],
    ['Broken Rice Combo Plate', 'Rice Plates', 16], ['Crispy Chicken over Rice', 'Rice Plates', 15], ['Yang Chow Fried Rice', 'Rice Plates', 14],
    ['Shaking Beef', 'Entrées', 22], ['Clay-Pot Caramel Fish', 'Entrées', 20], ['Tamarind Shrimp', 'Entrées', 21], ['Grilled Pork Chops', 'Entrées', 19], ['Ginger Braised Chicken', 'Entrées', 18], ['Garlic Water Spinach', 'Entrées', 12],
    ['Thai Hot Pot', 'Hot Pot (serves 2-4)', 45], ['Seafood Hot Pot', 'Hot Pot (serves 2-4)', 55], ['Beef Hot Pot', 'Hot Pot (serves 2-4)', 50],
    ['Three-Color Sweet Dessert', 'Dessert', 6], ['Vietnamese Flan', 'Dessert', 5], ['Coconut Jelly', 'Dessert', 5],
    ['Vietnamese Iced Coffee', 'Drinks', 5], ['Iced Tea', 'Drinks', 2], ['Sugarcane Juice', 'Drinks', 5], ['Avocado Smoothie', 'Drinks', 6], ['Saigon Beer', 'Drinks', 6],
  ];
  const exMenu = await api('/menu-items').catch(() => []);
  const haveM = new Set((exMenu || []).map((m) => (m.name || '').toLowerCase()));
  let mmade = 0;
  for (let i = 0; i < MENU.length; i++) {
    const [name, category, price] = MENU[i];
    if (haveM.has(name.toLowerCase())) continue;
    await api('/menu-items', { method: 'POST', body: { name, category, priceCents: Math.round(price * 100), sortOrder: i } });
    mmade++;
  }
  console.log('%cMenu: created ' + mmade + ', skipped ' + (MENU.length - mmade) + '.', 'color:#16a34a;font-weight:bold');

  /* ---- 3) SAMPLE RESERVATIONS for today (to fill the Tables calendar) ---- */
  const svcs = await api('/services').catch(() => []);
  const svc = (svcs || []).find((s) => /reserv|table/i.test(s.name)) || (svcs || [])[0];
  if (!svc) { console.warn('No service found. Set the tenant to Restaurant (auto-seeds a "Table reservation" service), then re-run.'); return; }
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const RES = [
    ['Emily', 'Tran', '4155550101', 2, at(17, 0)],
    ['Michael', 'Nguyen', '4155550102', 4, at(17, 30)],
    ['The Johnson', 'Family', '4155550103', 6, at(18, 0)],
    ['David', 'Chen', '4155550104', 10, at(18, 0)],
    ['Sarah', 'Pham', '4155550105', 2, at(18, 30)],
    ['James', 'Le', '4155550106', 4, at(19, 0)],
    ['Birthday', 'Party', '4155550107', 8, at(19, 0)],
    ['Jessica', 'Do', '4155550108', 2, at(19, 30)],
    ['Kevin', 'Vo', '4155550109', 4, at(19, 30)],
    ['Company', 'Group', '4155550110', 12, at(20, 0)],
    ['Amanda', 'Hoang', '4155550111', 2, at(20, 0)],
    ['Brian', 'Dang', '4155550112', 6, at(20, 30)],
  ];
  let rmade = 0;
  for (const [fn, ln, ph, party, startTime] of RES) {
    try { await api('/bookings', { method: 'POST', body: { serviceId: svc.id, startTime, partySize: party, customerFirstName: fn, customerLastName: ln, customerPhone: ph } }); rmade++; }
    catch (e) { console.warn('  skip', fn, ln, '-', e.message); }
  }
  console.log('%cReservations: created ' + rmade + ' for today.', 'color:#16a34a;font-weight:bold');
  console.log('%c✔ Done — open Calendar -> "Tables" view for today. Check the Tables and Menu pages too.', 'color:#6366f1;font-weight:bold;font-size:13px');
} catch (e) { console.error(e); alert('Import error: ' + e.message); } })();
