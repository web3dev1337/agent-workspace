# Security Policy

## Supported Versions

This project is under active development. Only the latest `main` branch and the latest tagged release are supported.

## Reporting a Vulnerability

If you believe you found a security vulnerability:

1) **Do not open a public issue.**
2) Send details privately to the maintainer:
   - GitHub: [open a private security advisory](https://github.com/web3dev1337/agent-workspace/security/advisories/new) (preferred)
   - Or DM on X: [@AIOnlyDeveloper](https://x.com/AIOnlyDeveloper)

Please include:
- a clear description of the issue and impact
- reproduction steps (minimal)
- affected version / commit SHA
- OS + environment details (Windows / WSL / Linux)

## Threat Model Notes (local-first)

This orchestrator is intentionally powerful (it controls local terminals and can execute actions).

Safe-by-default assumptions:
- The server binds to **loopback** by default (`127.0.0.1`).
- If you enable LAN binding, you must use `AUTH_TOKEN` (or you are effectively granting network users control).

If you deploy this tool in a shared environment, treat it like local admin tooling:
- restrict network exposure
- run on trusted machines only
- keep `AUTH_TOKEN` enabled for any non-loopback binding

## Public Release Audit Commands

Before publishing a release branch publicly:

- `npm run audit:public-release`
- `npm run audit:public-release:history`

These checks verify tracked-artifact hygiene, docs path hygiene, bind-host/auth defaults, and history secret scanning.
