#!/usr/bin/env node
'use strict';
/*
 * Lumio Booking — print agent (reception / restaurant).
 *
 * Runs on a Windows PC that has the printers. It polls the Lumio backend for
 * pending print jobs (authenticated by the business's API key, so it only
 * ever sees that business's jobs) and prints each one.
 *
 * Three ways to print, per printer (see README):
 *   - "gdi"    (default) Windows driver, drawn with a Windows font: Vietnamese
 *              accents print correctly, the table name comes out LARGE, dish
 *              lines bold, and the driver cuts the paper at the end.
 *   - "text"   the old plain-text path (Out-Printer). Also the fallback when
 *              "gdi" fails for any reason.
 *   - "escpos" raw ESC/POS straight to a network printer (IP, port 9100):
 *              large text, auto-cut, optional beep — no driver needed. Most
 *              thermal printers have no Vietnamese code page, so accents are
 *              removed on this path ("Phở bò" → "Pho bo").
 *
 * Requirements: Windows + Node.js 18+ (for built-in fetch).
 * `node index.js --test` prints a test ticket on every configured printer.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
    catch (e) { console.error('config.json is not valid JSON:', e.message); }
  }
  return {
    apiBase: String(cfg.apiBase || process.env.LUMIO_API_BASE || '').replace(/\/+$/, ''),
    apiKey: String(cfg.apiKey || process.env.LUMIO_API_KEY || ''),
    printer: cfg.printer == null ? String(process.env.LUMIO_PRINTER || '') : cfg.printer, // '' = Windows default printer
    // Restaurants: one printer per prep station, e.g.
    // { "COUNTER": "EPSON TM-T82", "KITCHEN": { "host": "192.168.1.50" }, "BAR": "XP-58 Bar" }.
    // When set, this agent takes only those stations' tickets (COUNTER = bills
    // and guest checks), so a second PC can serve other stations.
    printers: cfg.printers && typeof cfg.printers === 'object' && !Array.isArray(cfg.printers) ? cfg.printers : null,
    mode: ['gdi', 'text', 'escpos'].includes(String(cfg.mode)) ? String(cfg.mode) : 'gdi',
    font: String(cfg.font || 'Consolas'),
    pollMs: Math.max(2000, Number(cfg.pollMs || process.env.LUMIO_POLL_MS || 4000)),
  };
}

// ---------------------------------------------------------------- targets --

/** One printer, however config.json describes it (a Windows name, or an object). */
function targetOf(spec, cfg) {
  if (spec && typeof spec === 'object') {
    const host = spec.host ? String(spec.host).trim() : '';
    const mode = host ? 'escpos' : (['gdi', 'text'].includes(String(spec.mode)) ? String(spec.mode) : cfg.mode === 'escpos' ? 'gdi' : cfg.mode);
    return {
      name: String(spec.name || ''), host, port: Number(spec.port) || 9100, mode,
      font: String(spec.font || cfg.font), beep: !!spec.beep, cut: spec.cut !== false, accents: !!spec.accents,
    };
  }
  return { name: String(spec || ''), host: '', port: 9100, mode: cfg.mode === 'escpos' ? 'gdi' : cfg.mode, font: cfg.font, beep: false, cut: true, accents: false };
}

function describe(t) {
  if (t.host) return `${t.host}:${t.port} (ESC/POS)`;
  return `${t.name || '(Windows default)'} (${t.mode === 'text' ? 'text' : 'Windows font'})`;
}

// ------------------------------------------------------------- the ticket --

/**
 * How each line is drawn: 'h' huge (the table on a kitchen ticket), 'b' bold
 * (dishes, kitchen notes, the shop name, the total), 'n' normal. Read from
 * the ticket itself, so the server and old tickets need no change.
 */
function styleRows(text, station) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  const kitchen = !!station && String(station).toUpperCase() !== 'COUNTER';
  return lines.map((t, i) => {
    let role = 'n';
    if (kitchen) {
      if (i === 0 && t.trim()) role = 'b';
      else if (i === 1 && t.trim()) role = 'h';
      else if (/^\s*\d+\s*x\s/i.test(t) || /^\s+[-+]\s/.test(t)) role = 'b';
    } else if (i === 0 && t.trim()) role = 'b';
    else if (/^\s*(TỔNG|TONG|TOTAL|PHẢI TRẢ|PHAI TRA|CHƯA PHẢI HOÁ ĐƠN|CHƯA PHẢI HÓA ĐƠN|NOT A RECEIPT)/i.test(t)) role = 'b';
    return { role, text: t };
  });
}

/** Columns the ticket was laid out for (32 for kitchen tickets, up to 48 for receipts). */
function columnsOf(rows) {
  const longest = rows.filter((r) => r.role !== 'h').reduce((m, r) => Math.max(m, r.text.replace(/\s+$/, '').length), 0);
  return Math.max(32, Math.min(48, longest));
}

/** "Phở bò tái" → "Pho bo tai": for printers without a Vietnamese code page. */
function plain(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/·/g, '-')
    .replace(/[^\x0a\x20-\x7e]/g, '?');
}

/** ESC/POS bytes: large table line, bold dishes, feed, cut. */
function escposBytes(rows, t) {
  const ESC = 0x1b; const GS = 0x1d;
  const parts = [Buffer.from([ESC, 0x40])]; // initialise
  if (t.beep) parts.push(Buffer.from([ESC, 0x42, 0x02, 0x02])); // two short beeps (printers that have a buzzer)
  for (const r of rows) {
    const text = t.accents ? r.text : plain(r.text);
    if (r.role === 'h') parts.push(Buffer.from([ESC, 0x61, 0x01, GS, 0x21, 0x11, ESC, 0x45, 0x01]), Buffer.from(text.trim(), 'latin1'), Buffer.from([0x0a, GS, 0x21, 0x00, ESC, 0x45, 0x00, ESC, 0x61, 0x00]));
    else if (r.role === 'b') parts.push(Buffer.from([ESC, 0x45, 0x01, GS, 0x21, 0x01]), Buffer.from(text, 'latin1'), Buffer.from([0x0a, GS, 0x21, 0x00, ESC, 0x45, 0x00]));
    else parts.push(Buffer.from(text, 'latin1'), Buffer.from([0x0a]));
  }
  parts.push(Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]));
  if (t.cut) parts.push(Buffer.from([GS, 0x56, 0x42, 0x00])); // feed and (partial) cut
  return Buffer.concat(parts);
}

function sendRaw(host, port, buf) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => { if (done) return; done = true; if (err) reject(err); else resolve(); };
    const sock = net.connect({ host, port });
    sock.setTimeout(8000, () => sock.destroy(new Error(`printer ${host}:${port} did not answer`)));
    sock.on('connect', () => sock.end(buf));
    sock.on('error', (e) => finish(e));
    sock.on('close', (hadError) => { if (!hadError) finish(); });
  });
}

const PS = (args) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 90000 });

function printTextMode(text, name) {
  const tmp = path.join(os.tmpdir(), `lumio-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  // CRLF line endings print most reliably through the Windows spooler.
  fs.writeFileSync(tmp, String(text).replace(/\r?\n/g, '\r\n'), 'utf8');
  try {
    const target = name ? ` -Name '${name.replace(/'/g, "''")}'` : '';
    // -Encoding UTF8: Windows PowerShell reads files as ANSI otherwise, which
    // garbles Vietnamese (and any accented) dish names on the ticket.
    PS(['-Command', `Get-Content -LiteralPath '${tmp.replace(/'/g, "''")}' -Raw -Encoding UTF8 | Out-Printer${target}`]);
  } finally {
    fs.unlink(tmp, () => {});
  }
}

function printGdi(rows, t) {
  const tmp = path.join(os.tmpdir(), `lumio-ticket-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  // One line per row, "<role>|<text>", read by print-gdi.ps1.
  fs.writeFileSync(tmp, '﻿' + rows.map((r) => `${r.role}|${r.text}`).join('\r\n'), 'utf8');
  try {
    // An empty argument is mangled by `powershell -File`, so the printer name is only passed when set.
    PS(['-File', path.join(__dirname, 'print-gdi.ps1'), '-Path', tmp, '-Cols', String(columnsOf(rows)), '-FontName', t.font, ...(t.name ? ['-Printer', t.name] : [])]);
  } finally {
    fs.unlink(tmp, () => {});
  }
}

let warnedGdi = false;
async function printOn(t, text, station, copies) {
  const rows = styleRows(text, station);
  for (let i = 0; i < Math.max(1, Number(copies) || 1); i++) {
    if (t.host) { await sendRaw(t.host, t.port, escposBytes(rows, t)); continue; }
    if (t.mode === 'text') { printTextMode(text, t.name); continue; }
    try { printGdi(rows, t); }
    catch (e) {
      // Never lose a ticket because of the nicer path: print it the old way.
      if (!warnedGdi) { console.error(`\n(Windows-font printing failed, using plain text: ${(e && e.stderr && String(e.stderr).trim().split('\n').pop()) || (e && e.message) || e})`); warnedGdi = true; }
      printTextMode(text, t.name);
    }
  }
}

// ------------------------------------------------------------------ main --

const cfg = loadConfig();
const stationKeys = cfg.printers ? Object.keys(cfg.printers).map((k) => String(k).trim().toUpperCase()).filter((k) => /^[A-Z0-9_]{2,20}$/.test(k)) : [];

function targetFor(station) {
  if (!cfg.printers) return targetOf(cfg.printer, cfg);
  const key = station ? String(station).toUpperCase() : 'COUNTER';
  const hit = Object.keys(cfg.printers).find((k) => String(k).toUpperCase() === key);
  return targetOf(hit ? cfg.printers[hit] : cfg.printer, cfg);
}

const TEST_TICKET = [
  '      BẾP · MÓN MỚI',
  '        BÀN M3',
  'Bill #57 · Lần 1',
  '4 khách · Phục vụ: Lan',
  '19:42',
  '--------------------------------',
  '2 x Phở bò tái nạm',
  '    + Tô lớn',
  '    - Không hành',
  '1 x Gỏi cuốn tôm thịt',
  '1 x Cà phê sữa đá',
  '--------------------------------',
  '            4 món',
  '',
  'Lumio Print · in thử / test page',
].join('\n');

async function testAll() {
  const list = stationKeys.length ? stationKeys.map((k) => [k, targetFor(k)]) : [['(all)', targetFor(null)]];
  for (const [k, t] of list) {
    process.stdout.write(`Test ${k} -> ${describe(t)} … `);
    try { await printOn(t, TEST_TICKET, k === 'COUNTER' ? null : 'KITCHEN', 1); console.log('OK'); }
    catch (e) { console.log(`FAILED: ${(e && e.message) || e}`); }
  }
}

if (require.main !== module) {
  // required by a test: only the helpers below
} else if (process.argv.includes('--test')) {
  testAll().then(() => process.exit(0));
} else {
  if (!cfg.apiBase || !cfg.apiKey) {
    console.error('\nMissing apiBase or apiKey. Open config.json and fill them in (see config.example.json).\n');
    process.exit(1);
  }
  if (typeof fetch !== 'function') {
    console.error('\nThis agent needs Node.js 18 or newer (built-in fetch). Please update Node.\n');
    process.exit(1);
  }
  const printerList = stationKeys.length ? stationKeys.map((k) => `\n    ${k} -> ${describe(targetFor(k))}`).join('') : ` ${describe(targetFor(null))}`;
  console.log(`Lumio print agent started.\n  API: ${cfg.apiBase}\n  Printer:${printerList}\n  Poll: ${cfg.pollMs}ms\nWaiting for receipts… (keep this window open)`);

  const headers = { 'X-Lumio-Api-Key': cfg.apiKey, 'Content-Type': 'application/json' };
  const getPending = async () => {
    const q = stationKeys.length ? `?stations=${encodeURIComponent(stationKeys.join(','))}` : '';
    const r = await fetch(`${cfg.apiBase}/print-jobs/agent/pending${q}`, { headers });
    if (!r.ok) throw new Error(`pending HTTP ${r.status}`);
    return r.json();
  };
  const report = async (id, ok, error) => {
    try {
      await fetch(`${cfg.apiBase}/print-jobs/agent/${id}/result`, {
        method: 'POST', headers, body: JSON.stringify({ ok, error: error ? String(error).slice(0, 400) : undefined }),
      });
    } catch { /* best effort */ }
  };

  let running = false;
  const tick = async () => {
    if (running) return; // a slow printer must not start the same job twice
    running = true;
    try {
      let jobs;
      try { jobs = await getPending(); }
      catch { process.stdout.write('.'); return; } // network/API hiccup — retry next poll
      for (const job of jobs) {
        try {
          await printOn(targetFor(job.station), job.text, job.station, job.copies);
          await report(job.id, true);
          console.log(`\n[${new Date().toLocaleTimeString()}] Printed ${job.title || job.id}`);
        } catch (e) {
          await report(job.id, false, e && e.message);
          console.error(`\n[${new Date().toLocaleTimeString()}] Print FAILED for ${job.id}: ${(e && e.message) || e}`);
        }
      }
    } finally { running = false; }
  };
  setInterval(tick, cfg.pollMs);
  tick();
}

module.exports = { styleRows, columnsOf, plain, escposBytes, targetOf, sendRaw, printOn };
