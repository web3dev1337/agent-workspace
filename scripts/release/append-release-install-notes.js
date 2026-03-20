#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getProjectRoot } = require('./version-utils');

const DEFAULT_NOTES_PATH = path.join('docs', 'MACOS_RELEASE_INSTALL_NOTES.md');

function parseArgs(argv) {
  const args = argv.slice(2);
  let tag = process.env.GITHUB_REF_NAME || '';
  let notesPath = DEFAULT_NOTES_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--tag' && args[index + 1]) {
      tag = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--notes-file' && args[index + 1]) {
      notesPath = args[index + 1];
      index += 1;
    }
  }

  return { notesPath, tag };
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function githubRequest(url, { method = 'GET', body } = {}) {
  const token = requireEnv('GITHUB_TOKEN');
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${url} failed (${response.status}): ${text}`);
  }

  return response.json();
}

function resolveNotesPath(repoRoot, notesPath) {
  return path.resolve(repoRoot, notesPath);
}

function appendNotes(existingBody, installNotes) {
  const trimmedBody = String(existingBody || '').trimEnd();
  const trimmedNotes = String(installNotes || '').trim();
  if (!trimmedNotes) {
    return trimmedBody ? `${trimmedBody}\n` : '';
  }
  if (trimmedBody.includes('<!-- macos-source-install-notes -->')) {
    return trimmedBody ? `${trimmedBody}\n` : '';
  }
  return trimmedBody ? `${trimmedBody}\n\n${trimmedNotes}\n` : `${trimmedNotes}\n`;
}

async function main() {
  const { notesPath, tag } = parseArgs(process.argv);
  if (!tag) {
    throw new Error('Missing release tag. Pass --tag or set GITHUB_REF_NAME.');
  }

  const repoRoot = getProjectRoot();
  const notesFilePath = resolveNotesPath(repoRoot, notesPath);
  if (!fs.existsSync(notesFilePath)) {
    throw new Error(`Install notes file not found: ${notesFilePath}`);
  }

  const repository = requireEnv('GITHUB_REPOSITORY');
  const installNotes = fs.readFileSync(notesFilePath, 'utf8');
  const release = await githubRequest(`https://api.github.com/repos/${repository}/releases/tags/${tag}`);
  const nextBody = appendNotes(release.body || '', installNotes);

  if (nextBody === `${String(release.body || '').trimEnd()}\n`) {
    console.log(`[release] Install notes already present on ${tag}; nothing to update.`);
    return;
  }

  await githubRequest(`https://api.github.com/repos/${repository}/releases/${release.id}`, {
    method: 'PATCH',
    body: {
      body: nextBody
    }
  });

  console.log(`[release] Appended install notes to ${tag}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[release] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  appendNotes,
  parseArgs,
  resolveNotesPath
};
