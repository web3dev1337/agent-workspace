#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = args[i + 1];
    if (a === '--public-out' && next) { out.publicOut = next; i += 1; continue; }
    if (a === '--private-out' && next) { out.privateOut = next; i += 1; continue; }
    if (a === '--out-dir' && next) { out.outDir = next; i += 1; continue; }
    if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(`Usage: node scripts/license/generate-keypair.js [--out-dir <dir>] [--public-out <path>] [--private-out <path>]

Generates an Ed25519 keypair (PEM) for offline license signing.

Examples:
  node scripts/license/generate-keypair.js
  node scripts/license/generate-keypair.js --out-dir /tmp/orchestrator-license-keys
  node scripts/license/generate-keypair.js --public-out ./license-public-key.pem --private-out /tmp/license-private-key.pem
`);
    process.exit(0);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const publicOut = opts.publicOut || (opts.outDir ? path.join(opts.outDir, 'license-public-key.pem') : null);
  const privateOut = opts.privateOut || (opts.outDir ? path.join(opts.outDir, 'license-private-key.pem') : null);

  if (opts.outDir) ensureDir(opts.outDir);
  if (publicOut) {
    ensureDir(path.dirname(publicOut));
    fs.writeFileSync(publicOut, publicKey, 'utf8');
    console.log(`Wrote public key: ${publicOut}`);
  }
  if (privateOut) {
    ensureDir(path.dirname(privateOut));
    fs.writeFileSync(privateOut, privateKey, 'utf8');
    console.log(`Wrote private key: ${privateOut}`);
  }

  if (!publicOut && !privateOut) {
    console.log('--- LICENSE PUBLIC KEY (PEM) ---\n' + publicKey.trim() + '\n');
    console.log('--- LICENSE PRIVATE KEY (PEM) ---\n' + privateKey.trim() + '\n');
  }
}

main();

