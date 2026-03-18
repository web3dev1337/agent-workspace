# Agent Workspace Privacy Policy

Effective date: March 18, 2026

This Privacy Policy explains how Agent Workspace handles information when you use the Agent Workspace website, desktop app, and related materials.

## 1. Short version

Agent Workspace is designed to be local-first:

- we do not operate a publisher-hosted user account system for normal use of the app;
- we do not rely on publisher-hosted behavioral analytics or publisher-hosted telemetry for the product to function;
- your settings, workspace state, local logs, local process telemetry, onboarding state, and optional integration credentials are generally stored on your own device;
- if you choose to connect third-party services such as GitHub, Trello, browser speech recognition, or AI providers, data may be sent to those providers under your direction and subject to their policies.

## 2. Scope

This Privacy Policy applies to:

- [agent-workspace.ai](https://agent-workspace.ai)
- the packaged Agent Workspace desktop application
- release artifacts and update channels we control

It does not apply to third-party tools, websites, CLIs, AI models, or services you choose to connect to Agent Workspace.

## 3. Information we process

### A. Information stored locally on your device

Depending on how you use Agent Workspace, the software may store:

- workspace definitions, thread metadata, project boards, task records, settings, and onboarding state;
- local logs, diagnostics, and local process telemetry;
- local browser storage values, including UI preferences, panel state, and first-run acknowledgement state, when using the web UI or desktop app;
- local integration settings or credentials that you choose to save, such as Trello credentials or CLI login state managed by other tools;
- file paths, repository metadata, branch names, session metadata, and local command history used to power product features.

Examples of local storage paths may include:

- `~/.orchestrator/`
- `~/.trello-credentials`
- desktop-app data directories such as `%APPDATA%\\com.agent.workspace` and `%LOCALAPPDATA%\\com.agent.workspace`
- browser `localStorage` when you use the web interface or desktop webview

### B. Information sent to third parties at your direction

If you enable integrations or run commands through Agent Workspace, data may be sent to third-party providers. Depending on the feature you use, this can include:

- repository metadata, pull-request details, or authentication-driven repository lookups sent to GitHub-related APIs or tools;
- Trello board, list, card, checklist, member, or credential data sent to Trello;
- prompts, files, code, and context sent to AI providers or CLIs you invoke through the product;
- audio or transcript data sent to the speech-recognition backend you select, such as browser speech recognition.

Those providers process data according to their own terms and privacy policies, not ours.

### C. Information from our website

Based on the current codebase, the public website is a static site and does not include publisher-hosted analytics scripts or advertising trackers in the repository version reviewed for this release. Standard web hosting logs may still exist at the hosting or CDN layer.

## 4. How we use information

We use information to:

- operate Agent Workspace features on your device;
- save your settings and local state;
- render dashboards, reviews, project boards, voice features, and threads;
- support optional integrations you enable;
- distribute software releases and documentation;
- respond to security disclosures, bug reports, or support requests you send us.

## 5. No sale, no ad tech

We do not sell your personal information through Agent Workspace, and the reviewed product code does not include third-party advertising trackers or behavioral ad SDKs.

## 6. Third-party services

Agent Workspace is designed to work with third-party providers you choose. If you connect those providers, they may receive data such as repository details, prompts, task metadata, tokens, or API requests necessary for the feature you are using.

Examples include GitHub, Trello, Anthropic, OpenAI, Google, or other local or cloud-based tools. We do not control those services, and you should review their terms and privacy policies before using them.

## 7. Retention

Because Agent Workspace is local-first, retention is often controlled by you:

- local settings, logs, telemetry, and metadata remain on your device until you delete them, uninstall the app, clear browser storage, or remove the relevant files;
- third-party providers may retain information you send to them under their own retention policies;
- if you contact us directly, we may retain that correspondence as needed to respond, keep records, or protect rights and security.

## 8. Security

We take reasonable steps in the product to support local-only storage patterns and secure defaults, but no software is perfectly secure.

You are responsible for:

- securing your machine and user account;
- protecting repositories, tokens, SSH keys, and API credentials;
- restricting access to local loopback services and enabling auth when exposing the app beyond loopback;
- reviewing commands and automations before running them.

If you discover a security issue, please use our security reporting process:

[Private security advisory intake](https://github.com/web3dev1337/agent-workspace/security/advisories/new)

## 9. International users

If you choose to connect third-party providers or hosts located outside your country, your information may be transferred to other jurisdictions under those providers' policies and legal frameworks.

## 10. Children

Agent Workspace is not directed to children under 13, and we do not knowingly build publisher-hosted profiles for children through the app.

## 11. Your choices and rights

Because we generally do not maintain a central hosted user database for normal app use, many privacy controls are exercised locally by you, for example by:

- deleting local app data;
- clearing browser storage;
- removing local credentials files;
- uninstalling the app;
- disconnecting third-party services.

If applicable law gives you rights such as access, correction, deletion, or restriction, and you believe we hold personal information about you directly, contact us. In many cases, the practical answer may be to delete local files on your device or submit a request to the third-party provider you used.

## 12. Changes to this Privacy Policy

We may update this Privacy Policy from time to time. When we do, we will update the effective date above.

## 13. Contact

Questions or requests about privacy can be directed through:

- GitHub repository: [web3dev1337/agent-workspace](https://github.com/web3dev1337/agent-workspace)
- Security advisories: [Private security advisory intake](https://github.com/web3dev1337/agent-workspace/security/advisories/new)
- X: [@AIOnlyDeveloper](https://x.com/AIOnlyDeveloper)
