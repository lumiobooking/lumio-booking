#!/usr/bin/env node
'use strict';
/*
 * Lumio Booking — reception-desk print agent.
 *
 * Runs on the salon's reception PC (the one with the receipt printer). It polls
 * the Lumio backend for pending receipts (authenticated by the salon's API key,
 * so it only ever sees this salon's jobs) and prints each one to the connected
 * printer via Windows. When staff press "print" on their phone with "Print at
 * reception" enabled, the receipt comes out here automatically.
 *
 * Requirements: Windows + Node.js 18+ (for built-in fetch).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.error('config.json is not valid JSON:', e.message); }
  }
  return {
    apiBase: String(cfg.apiBase || process.env.LUMIO_API_BASE || '').replace(/\/+$/, ''),
    apiKey: String(cfg.apiKey || process.env.LUMIO_API_KEY || ''),
    printer: String(cfg.printer || process.env.LUMIO_PRINTER || ''), // empty = Windows default printer
    pollMs: Math.max(2000, Number(cfg.pollMs || process.env.LUMIO_POLL_MS || 4000)),
  };
}

const cfg = loadConfig();
if (!cfg.apiBase || !cfg.apiKey) {
  console.error('\nMissing apiBase or apiKey. Open config.json and fill them in (see config.example.json).\n');
  process.exit(1);
}
if (typeof fetch !== 'function') {
  console.error('\nThis agent needs Node.js 18 or newer (built-in fetch). Please update Node.\n');
  process.exit(1);
}
console.log(`Lumio print agent started.\n  API: ${cfg.apiBase}\n  Printer: ${cfg.printer || '(Windows default)'}\n  Poll: ${cfg.pollMs}ms\nWaiting for receipts… (keep this window open)`);

const headers = { 'X-Lumio-Api-Key': cfg.apiKey, 'Content-Type': 'application/json' };

async function getPending() {
  const r = await fetch(`${cfg.apiBase}/print-jobs/agent/pending`, { headers });
  if (!r.ok) throw new Error(`pending HTTP ${r.status}`);
  return r.json();
}
async function report(id, ok, error) {
  try {
    await fetch(`${cfg.apiBase}/print-jobs/agent/${id}/result`, {
      method: 'POST', headers, body: JSON.stringify({ ok, error: error ? String(error).slice(0, 400) : undefined }),
    });
  } catch { /* best effort */ }
}

function printText(text, copies) {
  const tmp = path.join(os.tmpdir(), `lumio-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  // CRLF line endings print most reliably through the Windows spooler.
  fs.writeFileSync(tmp, String(text).replace(/\r?\n/g, '\r\n'), 'utf8');
  try {
    const target = cfg.printer ? ` -Name '${cfg.printer.replace(/'/g, "''")}'` : '';
    const psCmd = `Get-Content -LiteralPath '${tmp.replace(/'/g, "''")}' -Raw | Out-Printer${target}`;
    for (let i = 0; i < Math.max(1, Number(copies) || 1); i++) {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { stdio: 'ignore' });
    }
  } finally {
    fs.unlink(tmp, () => {});
  }
}

const inFlight = new Set();
async function tick() {
  let jobs;
  try { jobs = await getPending(); }
  catch { process.stdout.write('.'); return; } // network/API hiccup — retry next poll
  for (const job of jobs) {
    if (inFlight.has(job.id)) continue;
    inFlight.add(job.id);
    try {
      printText(job.text, job.copies);
      await report(job.id, true);
      console.log(`\n[${new Date().toLocaleTimeString()}] Printed ${job.title || job.id}`);
    } catch (e) {
      await report(job.id, false, e && e.message);
      console.error(`\n[${new Date().toLocaleTimeString()}] Print FAILED for ${job.id}: ${(e && e.message) || e}`);
    } finally {
      inFlight.delete(job.id);
    }
  }
}

setInterval(tick, cfg.pollMs);
tick();
