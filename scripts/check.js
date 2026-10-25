'use strict';

/**
 * Pemeriksaan sintaks ringan untuk seluruh JavaScript aplikasi.
 * Jalankan: npm run check
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const targets = ['app.js', 'config', 'lib', 'routes', 'services', 'public/js', 'scripts'];
const skip = new Set(['node_modules', '_legacy', '.git', 'downloads']);
const files = [];

function walk(entry) {
  const full = path.join(root, entry);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(full)) {
      if (skip.has(name)) continue;
      walk(path.join(entry, name));
    }
    return;
  }
  if (stat.isFile() && full.endsWith('.js')) files.push(full);
}

for (const target of targets) walk(target);

let failed = 0;
for (const file of files.sort()) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('✓ ' + path.relative(root, file));
  } catch (error) {
    failed += 1;
    console.error('✖ ' + path.relative(root, file));
    console.error(String(error.stderr || error.message).trim());
  }
}

console.log(`\n${files.length - failed}/${files.length} file JavaScript valid.`);
if (failed) process.exitCode = 1;
