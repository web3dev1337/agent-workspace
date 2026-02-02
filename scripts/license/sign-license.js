#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
    if (a === '--private-key' && next) { out.privateKeyPath = next; i += 1; continue; }
    if (a === '--out' && next) { out.outPath = next; i += 1; continue; }
    if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.licensePath || !opts.privateKeyPath) {
    console.log(`Usage: node scripts/license/sign-license.js --license <license.json> --private-key <private.pem> [--out <signed.json>]

Input file format: a JSON object representing the *license payload* (not wrapped).
Example license payload:
  {
    \"customer\": \"acme\",
    \"plan\": \"pro\",
    \"expiresAt\": \"2026-12-31T00:00:00Z\"
  }

Output file format (what Orchestrator consumes):
  { \"license\": { ... }, \"signature\": \"base64...\" }
`);
    process.exit(opts.help ? 0 : 1);
  }

  const license = JSON.parse(fs.readFileSync(opts.licensePath, 'utf8'));
  const privateKeyPem = fs.readFileSync(opts.privateKeyPath, 'utf8');

  const payload = Buffer.from(stableStringify(license), 'utf8');
  const signature = crypto.sign(null, payload, privateKeyPem).toString('base64');

  const out = { license, signature };
  const outPath = opts.outPath || path.join(process.cwd(), 'license.json');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote signed license: ${outPath}`);
}

main();

