const fs = require('fs');
const path = require('path');

const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
const GITHUB_ENV = process.env.GITHUB_ENV;

const root = path.resolve(__dirname, '..', '..');

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch (error) {
    return null;
  }
}

function fromTag() {
  const ref = process.env.GITHUB_REF;
  if (!ref || !ref.startsWith('refs/tags/')) {
    return null;
  }
  let version = ref.slice('refs/tags/'.length);
  if (version.startsWith('v')) {
    version = version.slice(1);
  }
  return version || null;
}

function writeLine(filePath, line) {
  if (!filePath) return;
  fs.appendFileSync(filePath, `${line}\n`);
}

function main() {
  const tagVersion = fromTag();
  const pkgVersion = readPackageVersion();
  const version = tagVersion || pkgVersion;

  if (!version) {
    throw new Error('Unable to determine release version (tag or package.json)');
  }

  writeLine(GITHUB_OUTPUT, `value=${version}`);
  writeLine(GITHUB_ENV, `RELEASE_VERSION=${version}`);
  console.log(`Release version set to ${version}`);
}

if (require.main === module) {
  main();
}
