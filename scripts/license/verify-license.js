#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');

function stableStringify(value) {
  const seen = new WeakSet();

  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return null;
    seen.add(v);

    if (Array.isArray(v)) return v.map(walk);

    const out = {};
    for (const key of Object.keys(v).sort()) {
      out[key] = walk(v[key]);
    }
    return out;
  };

  return JSON.stringify(walk(value));
}

function parseArgs(argv) {
  const out = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = args[i + 1];
    if (a === '--license' && next) { out.licensePath = next; i += 1; continue; }
    if (a === '--public-key' && next) { out.publicKeyPath = next; i += 1; continue; }
    if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.licensePath || !opts.publicKeyPath) {
    console.log(`Usage: node scripts/license/verify-license.js --license <signed.json> --public-key <public.pem>`);
    process.exit(opts.help ? 0 : 1);
  }

  const file = JSON.parse(fs.readFileSync(opts.licensePath, 'utf8'));
  const license = file?.license || null;
  const signature = file?.signature || null;
  const publicKeyPem = fs.readFileSync(opts.publicKeyPath, 'utf8');

  if (!license || !signature) {
    console.error('Invalid file: expected { license, signature }');
    process.exit(2);
  }

  const payload = Buffer.from(stableStringify(license), 'utf8');
  const sig = Buffer.from(String(signature), 'base64');
  const ok = crypto.verify(null, payload, publicKeyPem, sig);

  if (ok) {
    console.log('OK: signature verified');
    process.exit(0);
  }
  console.error('FAIL: bad signature');
  process.exit(3);
}

main();

