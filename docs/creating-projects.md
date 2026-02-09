# Creating Projects

## Vocabulary
- `category`: Top-level grouping from `config/project-types.json` (for example `games`, `tools`, `writing`).
- `framework`: Framework within a category (for example `hytopia`, `monogame`, `unity`).
- `template`: Lowest-level scaffold kit used to create starter files.
- `project`: The repository/folder you create.
- `worktree`: A working branch directory like `work1`, `work2`.
- `workspace`: Orchestrator config that owns sessions, terminals, and worktrees.

## Main Flow (UI)
1. Open Dashboard.
2. Click `New Project` card.
3. Complete wizard steps:
   - Describe project
   - Configure category -> framework -> template, plus privacy/worktree count
   - Review and create
4. On success, click `Open Workspace`.

If you open the wizard while focused in an existing workspace/worktree, it now pre-suggests framework/template defaults from the current repository type when possible.

Quick entrypoints:
- `Alt+Shift+N` opens the New Project wizard.
- Terminal header `✨` button opens the same wizard.

## CLI Fallback
Use the scaffold CLI directly:

```bash
node scripts/create-project.js --help
```

Typical example:

```bash
node scripts/create-project.js \
  --category games \
  --framework hytopia \
  --template basic \
  --name my-new-project \
  --init-git \
  --create-worktree work1
```

## Troubleshooting
- GitHub repo creation fails:
  - Ensure `gh auth status` is valid.
  - Re-run with GitHub creation disabled, then set remote manually.
- Taxonomy options missing:
  - Verify `config/project-types.json` exists and is valid JSON.
  - Check `/api/project-types/taxonomy` response in browser devtools.
- Wizard fails with workspace creation error:
  - Inspect server logs for `create-new-project` or `/api/projects/create-workspace`.
  - Confirm target base paths are writable.
