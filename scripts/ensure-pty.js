#!/usr/bin/env node

const { execSync } = require('child_process');

function tryRequirePty() {
  try {
    require('node-pty');
    return true;
  } catch (error) {
    return error;
  }
}

const firstTry = tryRequirePty();
if (firstTry === true) {
  console.log('node-pty ok');
  process.exit(0);
}

const message = firstTry && firstTry.message ? firstTry.message : String(firstTry);
console.warn('node-pty load failed, attempting rebuild...', message);

try {
  execSync('npm rebuild node-pty', { stdio: 'inherit' });
} catch (error) {
  console.error('npm rebuild node-pty failed');
  process.exit(1);
}

const secondTry = tryRequirePty();
if (secondTry === true) {
  console.log('node-pty rebuilt successfully');
  process.exit(0);
}

const secondMessage = secondTry && secondTry.message ? secondTry.message : String(secondTry);
console.error('node-pty still failing after rebuild:', secondMessage);
process.exit(1);
