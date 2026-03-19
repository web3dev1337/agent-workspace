const fs = require('fs');
const { getProjectRoot, readPackageVersion, readTagVersionFromEnv } = require('../release/version-utils');

const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
const GITHUB_ENV = process.env.GITHUB_ENV;

const root = getProjectRoot(__dirname);

function writeLine(filePath, line) {
  if (!filePath) return;
  fs.appendFileSync(filePath, `${line}\n`);
}

function main() {
  const tagVersion = readTagVersionFromEnv(process.env);
  const pkgVersion = readPackageVersion(root);

  if (!pkgVersion) {
    throw new Error('Unable to determine release version (tag or package.json)');
  }
  if (tagVersion && tagVersion !== pkgVersion) {
    throw new Error(`Git tag version ${tagVersion} does not match package.json version ${pkgVersion}`);
  }

  const version = tagVersion || pkgVersion;

  writeLine(GITHUB_OUTPUT, `value=${version}`);
  writeLine(GITHUB_ENV, `RELEASE_VERSION=${version}`);
  console.log(`Release version set to ${version}`);
}

if (require.main === module) {
  main();
}
