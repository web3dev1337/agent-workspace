# New Project & Workspace Creation Roadmap

This document outlines how to evolve the orchestrator so that creating entirely new projects (repos, frameworks, individual games) becomes a first-class workflow instead of a manual shell process.

---

## 1. Shared Vocabulary & Metadata

- **Define taxonomy JSON** describing categories (`writing`, `games`, `tools`), frameworks (`hytopia`, `monogame`, `unity`), and project templates (lowest-level implementations).
- Store under `config/project-types.json` and load during client bootstrap; expose through an internal API route so the dashboard and wizard stay in sync.
- Add validation helpers to ensure new types provide:
  - `basePath` resolver (relative to `$HOME/GitHub/...`)
  - Template ID (the scaffold to use)
  - Default launch settings / button configs

**Deliverables**
1. `config/project-types.json`
2. `server/projectTypeService.js` – reads config, enforces schema
3. Client hook in `app.js` to fetch taxonomy before rendering creation modals

---

## 2. Project Scaffold Generator

- Create `scripts/create-project.js` CLI:
  - Accepts `--category`, `--framework`, `--template`, `--name`, `--repo` (optional remote URL)
  - Builds directory tree (`mkdir -p`)
  - Copies template files from `templates/project-kits/<template-id>`
  - Initializes git (`git init`, optional `gh repo create`)
  - Writes metadata stub (`project.json`) capturing type and default worktree naming
- Allow template hooks for post-create commands (e.g., `npm install`, `dotnet new`).

**Deliverables**
1. `templates/project-kits/` reorganized with starter kits
2. `scripts/create-project.js`
3. Unit smoke test (`npm run test:create-project` placeholder)

---

## 3. Worktree Bootstrap Integration

- Extend `WorkspaceManager` with `createProjectWorkspace(params)`:
  1. Calls project generator
  2. Creates initial worktree (`work1`) via existing `worktreeHelper`
  3. Builds workspace JSON with default Claude/server terminal pair
  4. Persists workspace under `~/.orchestrator/workspaces/<project>.json`
- Add socket event `create-new-project` so client can request this in one RPC.

**Deliverables**
1. `server/workspaceManager.js` additions (`createProjectWorkspace`, helpers)
2. Socket handler in `server/index.js` (`socket.on('create-new-project', ...)`)
3. Client util `app.createProjectWorkspace(options)`

---

## 4. Dashboard UX Enhancements

- Update `client/dashboard.js`:
  - New “+ New Project” card
  - Modal wizard steps:
    1. Select Category → Framework → Template
    2. Enter project name, repo slug, optional GitHub org
    3. Preview directory path & repo URL
    4. Confirm → trigger socket event
- Show progress overlay (creating repo, creating workspace, launching terminals).

**Deliverables**
1. `client/dashboard.js` card + modal
2. `client/styles/dashboard.css` adjustments
3. Reuse `workspace-wizard` components where possible for consistency

---

## 5. Command Palette / Shortcut

- Add Alt+Shift+N shortcut (in `workspace-tab-manager.js`) to open the creation modal from anywhere.
- Optionally expose a palette entry (if command palette exists) that calls the same modal.

**Deliverables**
1. Extend shortcut handler
2. Hook into modal open logic

---

## 6. Button Registry & Quick Actions

- Register a “Create Project” quick action within the terminal button registry so users can trigger the modal from any terminal header.
- Buttons should respect project taxonomy (e.g., highlight suggested template when invoked from a Hytopia workspace).

**Deliverables**
1. Button registration in `app.js`
2. Tooltip & icon assets

---

## 7. Telemetry & Logging

- Log project creation steps server-side (`logger.info`) with outcomes (success/failure).
- Optionally emit UI notifications (e.g., success toast, failure with error message).

---

## 8. Documentation & Onboarding

- Update `CODEBASE_DOCUMENTATION.md` with new workflow.
- Add `docs/creating-projects.md` walkthrough covering:
  - Taxonomy terms (category, framework, template, project, worktree, workspace)
  - Step-by-step using dashboard
  - CLI fallback (`node scripts/create-project.js --help`)
- Provide troubleshooting (e.g., missing GitHub token for `gh`).

---

## 9. Future Enhancements (Backlog)

- **Template marketplace:** fetch remote templates (GitHub repo) and cache locally.
- **Custom scripts:** allow templates to define post-create scripts run by orchestrator.
- **Workspace bundles:** support multi-project setups (e.g., backend + frontend) on creation.
- **Integration tests:** spin up a temporary repo in CI to ensure scaffolding works per template.

---

## Implementation Order (Suggested Milestones)

1. Taxonomy configuration & service (Section 1)
2. Project generator CLI & templates (Section 2)
3. Workspace manager integration (Section 3)
4. Dashboard UI/UX (Section 4)
5. Shortcut & button hooks (Sections 5–6)
6. Telemetry & docs (Sections 7–8)

Each milestone can be developed and merged independently, enabling incremental rollout.

