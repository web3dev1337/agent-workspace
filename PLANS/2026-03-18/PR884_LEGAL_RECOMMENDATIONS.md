# PR 884 Legal Recommendations

Date: 2026-03-18
PR: https://github.com/web3dev1337/claude-orchestrator/pull/884
Branch: `feat/windows-installer-tos`

This note captures recommended follow-up changes after reviewing PR 884 against the requested terms/privacy guidance.

## Summary

PR 884 is the right direction. It adds:

- product legal docs under `docs/legal/`
- public legal pages under `site/`
- Windows installer terms wiring in `src-tauri/tauri.conf.json`

The remaining work is mostly about consistency and implementation:

- the terms need a clear carve-out for rights that cannot be excluded under applicable law
- the repo docs, site pages, and installer terms should not drift apart
- the desktop app still lacks a first-run legal acknowledgement step
- the public telemetry wording is broader than the new privacy disclosures
- the download flow still lacks checksum and signature verification guidance

## Required before merge

### 1. Add a non-excludable-rights carve-out

The current legal docs use strong warranty and liability disclaimers, but they should also say clearly that rights that cannot be excluded under applicable law remain intact.

Suggested clause:

`Nothing in these Terms excludes, restricts, or modifies any rights or remedies that cannot be excluded, restricted, or modified under applicable law.`

Files to update:

- `docs/legal/TERMS_OF_USE.md`
- `docs/legal/WINDOWS_INSTALLER_EULA.txt`
- `site/terms.html`

### 2. Pick one canonical legal source

The branch currently has:

- repo markdown docs in `docs/legal/`
- separate HTML copies in `site/`
- a separate installer terms file

That structure is workable, but it creates drift risk.

Recommendation:

- treat `docs/legal/TERMS_OF_USE.md` and `docs/legal/PRIVACY_POLICY.md` as the canonical source
- either generate the site pages from those files or keep them manually mirrored with a clear update rule
- keep the installer text shorter if needed, but make it clearly incorporate the canonical public terms

### 3. Add first-run legal acknowledgement in the app

The branch adds installer-level terms, but the app already has an onboarding modal system and does not use it for legal acknowledgement.

Relevant existing files:

- `client/index.html`
- `client/app.js`

Recommendation:

- add a first-run legal notice step before onboarding completes
- include a short warning that the app can execute commands and modify files
- link to the Terms and Privacy Policy
- require explicit acceptance before continuing

This can be a small addition to the existing onboarding flow.

### 4. Add binary verification guidance

The download flow should tell users how to verify what they downloaded, especially for Windows binaries.

Add guidance to:

- `README.md`
- `site/index.html`
- release notes or release checklist

Minimum guidance:

- verify the published SHA-256 digest before running
- if code signing is present, verify the signature
- if verification fails, do not run the file
- if the build is unsigned, say so plainly

Recommended Windows commands:

- `Get-FileHash <file>`
- `Get-AuthenticodeSignature <file>`

### 5. Narrow the telemetry wording

Current public copy still uses wording like:

- "Zero telemetry"
- "No external telemetry"
- "Zero external telemetry, zero data collection"

That is broader than the new privacy docs, which describe:

- local logs and diagnostics
- local telemetry/process metrics
- optional data flows to third-party services when integrations are enabled

Recommendation:

- replace absolute claims with narrower, precise wording
- suggested direction:

`No publisher-hosted telemetry by default. Agent Workspace runs locally and only communicates with third-party services you enable.`

Files to update:

- `README.md`
- `site/index.html`
- any release copy that repeats the stronger claim

## Recommended follow-up after merge

### 1. Add integration-specific notices

When integrations are enabled, show a short note that use is subject to the relevant third-party terms and that users are responsible for tokens, scopes, and rate-limit compliance.

This can live in settings/help text rather than only in the legal docs.

### 2. Add a durable contact channel

The current docs point users to:

- GitHub repository
- GitHub security advisories
- X

That is workable, but a stable email address would be better for privacy and legal inquiries.

### 3. Keep the license decision separate

PR 884 should stay focused on product legal pages, installer terms, and consent flow.

If the project ever wants to revisit MIT vs Apache 2.0, that should be a separate repo-wide licensing decision rather than being folded into this PR.

## Suggested implementation order

1. Add the non-excludable-rights carve-out to the repo terms, site terms, and installer terms.
2. Tighten the public telemetry wording in the README and website.
3. Add first-run legal acknowledgement using the existing onboarding flow.
4. Add checksum/signature verification guidance to the README, website, and release process.
5. Decide whether the site legal pages should be generated from the repo markdown or manually mirrored.

## Non-issues

These items looked fine in review:

- `bundle.licenseFile` in `src-tauri/tauri.conf.json` is valid Tauri v2 config
- linking Terms and Privacy from the install sections is useful and should stay
- adding repo-local legal docs under `docs/legal/` is the right structural direction
