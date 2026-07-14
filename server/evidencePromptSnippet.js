'use strict';

// Compact evidence-protocol instructions appended to agent launch prompts.
// Full reference: docs/agents/EVIDENCE_PROTOCOL.md (agents in other repos
// can't read that file, so this snippet must stand alone).

const EXAMPLE = {
  summary: 'What was built and how it was verified',
  tests: { ran: true, command: 'npm test', passed: 47, failed: 0 },
  appRun: { ran: true, method: 'puppeteer | server-smoke | studio | manual', notes: 'what you exercised; console errors seen (should be none)' },
  media: [{ type: 'image', path: '.agent-evidence/feature.png', caption: '...' }],
  data: [{ metric: 'only for balance/tuning changes', before: 0, after: 0, note: 'measured, not intended' }],
  standards: ['CLAUDE.md'],
  handoff: { notes: 'state + exact next steps for a successor agent (fresh sessions start from this)' }
};

const buildEvidencePromptSnippet = () => [
  '--- EVIDENCE PROTOCOL (required before requesting review) ---',
  'Prove your work so it can be approved at a glance. After creating/updating the PR, post ONE fenced block in the PR description or as a PR comment:',
  '',
  '```agent-evidence',
  JSON.stringify(EXAMPLE, null, 2),
  '```',
  '',
  'Rules:',
  '- Actually RUN the tests and the app before reporting. Never claim green you did not see.',
  '- Save screenshots/video into .agent-evidence/ inside your worktree (git-ignore it) and list them under media.',
  '- Balance/tuning changes need measured before/after numbers under data.',
  '- No PR yet? Write the same JSON to .agent-evidence.json at the worktree root instead.',
  '--- END EVIDENCE PROTOCOL ---'
].join('\n');

module.exports = { buildEvidencePromptSnippet };
