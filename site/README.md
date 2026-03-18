# Showcase Site

This folder contains the standalone product showcase for Agent Workspace.

## Local preview

```bash
npm run site:preview
```

The preview server serves `site/` on `http://127.0.0.1:4173` by default.

## Assets

`site/assets/orchestrator-ui.png` is a real product screenshot used in the hero.

`site/assets/og-card.svg` is the editable social card source, and `site/assets/og-card.png` is the generated preview image referenced by the page metadata.

## Crawl and discovery files

- `site/robots.txt` defines crawl policy and points to the sitemap.
- `site/sitemap.xml` lists canonical public URLs.
- `site/llms.txt` and `site/llms-full.txt` provide concise and extended AI-readable summaries.

## Why this is not wired to GitHub Pages yet

GitHub's current Pages documentation says private Pages access control is available for organization-owned sites on GitHub Enterprise Cloud. Since this repository still contains internal documentation and private-only materials, the showcase source is isolated here but deployment is intentionally not enabled yet.

When you're ready to publish, the clean path is to deploy only this `site/` folder with a dedicated GitHub Pages workflow.
