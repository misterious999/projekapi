#!/usr/bin/env node
'use strict';

/**
 * NusaAPI CLI — pemanggil endpoint sederhana untuk terminal.
 * Tidak membutuhkan dependency eksternal. Node.js 18+ (fetch bawaan).
 *
 * Contoh:
 *   node nusaapi-cli.js /api/status
 *   NUSAAPI_KEY=nusa_xxx node nusaapi-cli.js /api/tools/weather?city=Jakarta
 *   node nusaapi-cli.js /api/ai/chat --key FreeLimit --query q="Apa itu REST API?"
 *   node nusaapi-cli.js /api/tools/hash --data '{"text":"NusaAPI","algorithm":"sha256"}'
 */

const fs = require('fs');
const path = require('path');

const VERSION = '1.0.0';
const DEFAULTS = {
  base: process.env.NUSAAPI_BASE || 'http://localhost:3000',
  key: process.env.NUSAAPI_KEY || 'FreeLimit',
};

function usage() {
  console.log(`
NusaAPI CLI v${VERSION}

Pemakaian:
  node nusaapi-cli.js <path> [opsi]

Opsi:
  --method <GET|POST>     Method request (default: GET, atau POST jika --data dipakai)
  --key <api-key>         API key (default: env NUSAAPI_KEY atau FreeLimit)
  --base <url>            Base URL (default: env NUSAAPI_BASE atau ${DEFAULTS.base})
  --query <k=v>           Tambah query parameter (bisa diulang)
  --data <json>           Body JSON untuk POST
  --data @file.json       Baca body JSON dari file
  --no-key                Jangan kirim Authorization
  -h, --help              Tampilkan bantuan
  -v, --version           Tampilkan versi

Contoh:
  node nusaapi-cli.js /api/status
  node nusaapi-cli.js /api/tools/qr --query text="Halo NusaAPI"
  node nusaapi-cli.js /api/ai/summarize --data '{"text":"Teks yang ingin diringkas..."}'
`);
}

function parseArgs(argv) {
  const options = { base: DEFAULTS.base, key: DEFAULTS.key, sendKey: true, query: [], method: '' };
  const rest = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Opsi ${arg} membutuhkan nilai.`);
      i += 1;
      return argv[i];
    };

    if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '-v' || arg === '--version') options.version = true;
    else if (arg === '--method') options.method = next().toUpperCase();
    else if (arg === '--key') options.key = next();
    else if (arg === '--base') options.base = next();
    else if (arg === '--query') options.query.push(next());
    else if (arg === '--data') options.data = next();
    else if (arg === '--no-key') options.sendKey = false;
    else if (arg.startsWith('--')) throw new Error(`Opsi tidak dikenal: ${arg}`);
    else rest.push(arg);
  }

  options.path = rest.join(' ');
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error('✖ ' + error.message);
    console.error('Jalankan dengan --help untuk melihat pemakaian.');
    process.exitCode = 1;
    return;
  }

  if (options.help) return usage();
  if (options.version) {
    console.log(VERSION);
    return;
  }
  if (!options.path) {
    usage();
    process.exitCode = 1;
    return;
  }

  let target;
  try {
    target = new URL(options.path, options.base.endsWith('/') ? options.base : options.base + '/');
  } catch (error) {
    console.error('✖ Path atau base URL tidak valid.');
    process.exitCode = 1;
    return;
  }

  for (const entry of options.query) {
    const index = entry.indexOf('=');
    if (index < 1) {
      console.error(`✖ Query harus berformat kunci=nilai: ${entry}`);
      process.exitCode = 1;
      return;
    }
    target.searchParams.set(entry.slice(0, index), entry.slice(index + 1));
  }

  let body;
  if (options.data !== undefined) {
    try {
      const source = options.data.startsWith('@') ? fs.readFileSync(path.resolve(options.data.slice(1)), 'utf8') : options.data;
      body = JSON.stringify(JSON.parse(source));
    } catch (error) {
      console.error('✖ Body bukan JSON valid: ' + error.message);
      process.exitCode = 1;
      return;
    }
  }

  const method = options.method || (body ? 'POST' : 'GET');
  const headers = { Accept: 'application/json', 'User-Agent': 'NusaAPI-CLI/' + VERSION };
  if (options.sendKey && options.key) headers.Authorization = 'Bearer ' + options.key;
  if (body) headers['Content-Type'] = 'application/json';

  const started = Date.now();
  console.log(`→ ${method} ${target.toString()}`);
  try {
    const response = await fetch(target, { method, headers, body });
    const elapsed = Date.now() - started;
    const text = await response.text();
    let output = text;
    try {
      output = JSON.stringify(JSON.parse(text), null, 2);
    } catch (error) {
      /* plain text */
    }
    console.log(`← HTTP ${response.status} ${response.statusText} · ${elapsed}ms`);
    console.log(output);
    if (!response.ok) process.exitCode = 1;

    const remaining = response.headers.get('x-quota-remaining');
    const limit = response.headers.get('x-quota-limit');
    if (remaining !== null && limit !== null) console.log(`\nKuota: ${remaining} / ${limit} tersisa.`);
  } catch (error) {
    console.error(`✖ Request gagal: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
