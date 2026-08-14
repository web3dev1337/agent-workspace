'use strict';

// Guards for values that get interpolated into shell command strings written
// to a PTY. Config files (custom-agents.json, .orchestrator-config.json) and
// workflow model/effort values are attacker-influenceable, so anything that
// reaches a shell command must be validated against a strict allowlist — a
// stray ";", "|", "$(", backtick, "&", redirection, or newline would otherwise
// let a malicious config run arbitrary commands.

// Model ids: letters/digits and the punctuation real model names use
// (dots, dashes, underscore, slash, colon, @, and claude's "[1m]" suffix).
const MODEL_RE = /^[A-Za-z0-9._:@/\-[\]]{1,120}$/;

// Reasoning/effort levels are short lowercase words.
const REASONING_RE = /^[a-z][a-z-]{0,20}$/;

// CLI flag/arg tokens may contain spaces (e.g. "--sandbox workspace-write")
// but never shell metacharacters.
const FLAG_RE = /^[A-Za-z0-9 _\-=./:@,+]{0,200}$/;

// Denylist for a fully-resolved command string as a last line of defense.
const DANGEROUS_SHELL = /[;&|`$<>\n\r\\]|\$\(|\|\||&&/;

const isSafeModel = (v) => typeof v === 'string' && MODEL_RE.test(v);
const isSafeReasoning = (v) => typeof v === 'string' && REASONING_RE.test(v);
const isSafeFlag = (v) => typeof v === 'string' && FLAG_RE.test(v);
const hasDangerousShell = (v) => DANGEROUS_SHELL.test(String(v || ''));

module.exports = {
  MODEL_RE,
  REASONING_RE,
  FLAG_RE,
  isSafeModel,
  isSafeReasoning,
  isSafeFlag,
  hasDangerousShell
};
