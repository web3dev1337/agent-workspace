# Showcase Site

This folder contains the standalone product showcase for Agent Workspace.

## Local preview

```bash
npm run site:preview
```

The preview server serves `site/` on `http://127.0.0.1:4173` by default.

## Why this is not wired to GitHub Pages yet

GitHub's current Pages documentation says private Pages access control is available for organization-owned sites on GitHub Enterprise Cloud. Since this repository still contains internal documentation and private-only materials, the showcase source is isolated here but deployment is intentionally not enabled yet.

When you're ready to publish, the clean path is to deploy only this `site/` folder with a dedicated GitHub Pages workflow.
