#!/usr/bin/env node
// Superseded by ios-prepare.mjs (iPad turning is one of its settings). Kept so an
// old "node scripts/ios-ipad.mjs" habit still does the right thing.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

execFileSync(process.execPath, [fileURLToPath(new URL('./ios-prepare.mjs', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit' });
