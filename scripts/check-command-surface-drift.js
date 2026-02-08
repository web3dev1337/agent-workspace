#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function readFileOrExit(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`Failed to read ${filePath}: ${error.message}`);
    process.exit(2);
  }
}

function extractCommanderActionsFromRegistry(source) {
  const actions = new Set();
  const regex = /io\.emit\(\s*['"]commander-action['"]\s*,\s*\{\s*action:\s*['"]([^'"]+)['"]/g;
  let match = regex.exec(source);
  while (match) {
    const action = String(match[1] || '').trim();
    if (action) actions.add(action);
    match = regex.exec(source);
  }
  return actions;
}

function extractFunctionBody(source, signatureRegex) {
  const match = signatureRegex.exec(source);
  if (!match || typeof match.index !== 'number') {
    throw new Error(`Could not find function signature: ${signatureRegex}`);
  }

  const startBrace = source.indexOf('{', match.index);
  if (startBrace < 0) {
    throw new Error(`Could not find opening brace for: ${signatureRegex}`);
  }

  let depth = 0;
  for (let index = startBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(startBrace + 1, index);
    }
  }

  throw new Error(`Could not find closing brace for: ${signatureRegex}`);
}

function extractHandledActionsFromClient(source) {
  const body = extractFunctionBody(source, /\bhandleCommanderAction\s*\(\s*action\s*,\s*params\s*\)\s*\{/g);
  const actions = new Set();
  const regex = /case\s+['"]([^'"]+)['"]\s*:/g;
  let match = regex.exec(body);
  while (match) {
    const action = String(match[1] || '').trim();
    if (action) actions.add(action);
    match = regex.exec(body);
  }
  return actions;
}

function parseArgs(argv) {
  return {
    strictExtra: argv.includes('--strict-extra'),
    json: argv.includes('--json')
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..');
  const registryPath = path.join(repoRoot, 'server', 'commandRegistry.js');
  const clientPath = path.join(repoRoot, 'client', 'app.js');

  const registrySource = readFileOrExit(registryPath);
  const clientSource = readFileOrExit(clientPath);

  let registryActions;
  let handledActions;
  try {
    registryActions = extractCommanderActionsFromRegistry(registrySource);
    handledActions = extractHandledActionsFromClient(clientSource);
  } catch (error) {
    console.error(`Failed to evaluate commander action coverage: ${error.message}`);
    process.exit(2);
  }

  const missingHandlers = Array.from(registryActions)
    .filter((action) => !handledActions.has(action))
    .sort();

  const unreferencedClientCases = Array.from(handledActions)
    .filter((action) => !registryActions.has(action))
    .sort();

  const payload = {
    ok: missingHandlers.length === 0 && (!args.strictExtra || unreferencedClientCases.length === 0),
    summary: {
      registryActions: registryActions.size,
      clientCases: handledActions.size,
      missingHandlers: missingHandlers.length,
      unreferencedClientCases: unreferencedClientCases.length
    },
    missingHandlers,
    unreferencedClientCases
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('Commander action drift check');
    console.log(`- registry actions: ${payload.summary.registryActions}`);
    console.log(`- client cases: ${payload.summary.clientCases}`);
    if (missingHandlers.length) {
      console.error(`- missing handlers (${missingHandlers.length}): ${missingHandlers.join(', ')}`);
    } else {
      console.log('- missing handlers: none');
    }
    if (unreferencedClientCases.length) {
      const label = args.strictExtra ? 'extra client cases (strict)' : 'extra client cases';
      console.log(`- ${label} (${unreferencedClientCases.length}): ${unreferencedClientCases.join(', ')}`);
    } else {
      console.log('- extra client cases: none');
    }
  }

  if (missingHandlers.length) {
    process.exit(1);
  }
  if (args.strictExtra && unreferencedClientCases.length) {
    process.exit(1);
  }
}

main();
