# Checklist (2026-01-20)

This checklist tracks completion for the roadmap in `PLANS/2026-01-20/IMPLEMENTATION_PLAN.md`.

## Global process (repeat per PR)

- [ ] Branch created from updated `main`
- [ ] Issue reproduced and documented (notes in `PLANS/2026-01-20/ROLLING_LOG.md`)
- [ ] Fix implemented with minimal scope
- [ ] Unit tests run: `npm run test:unit`
- [ ] E2E tests run on safe port: `npm run test:e2e:safe` (or justified skip)
- [ ] Manual sanity check (focused, <5 minutes)
- [ ] Docs updated (requirements/plan/log as needed)
- [ ] Commit created (clear message)
- [ ] Pushed to `origin`
- [ ] PR opened (record PR URL in rolling log)
- [ ] PR merged

## Feature / Fix tracking

### Planning & docs
- [x] Requested changes captured (`REQUESTED_CHANGES.md`)
- [x] Implementation plan written (`IMPLEMENTATION_PLAN.md`)
- [x] Rolling log started (`ROLLING_LOG.md`)

### Reliability (highest priority)
- [x] Tab switching preserves terminal typing & sizing
- [x] Tab switching preserves sidebar selection state
- [x] Adding worktrees does not resurrect startup overlays
- [x] Adding worktrees does not “reset” existing terminals
- [x] Sidebar worktree list updates immediately (no “one behind”)
- [x] Terminal scroll does not jump to top
- [ ] Commander terminal supports text paste (Ctrl/Cmd+V)

### Status + UX cleanups
- [x] Status indicator colors are accurate and documented
- [x] Remove/hide non-functional “Dynamic layout”
- [x] Remove or fix empty “Quick actions” strip
- [x] Sidebar worktree list is compact
- [x] Modal close buttons are usable (ports + conversations + worktree picker)

### Ports / services
- [x] Remove bottom-left “Services” list under worktrees
- [ ] Ports/Services modal is large + card/grid layout
- [ ] Ports/Services modal supports open + copy URL/port actions

### Worktree picker UX
- [ ] Modal layout is large and usable without excessive scrolling
- [ ] Grouping by category/framework + ungrouped sections
- [ ] Sorting: most recently edited + most recently created
- [ ] Recency filters (radio buttons)
- [ ] Favorites (persisted)
- [ ] Quick launch: oldest + most recent + choose any
- [ ] Show branch + PR + merged status

### PR management
- [ ] PR list view (mine by default)
- [ ] Filter toggle for “others’ PRs”
- [ ] “Ready for review” tagging (independent of PR creation)

### Naming / branding
- [ ] UI copy updates: “Claude” → “Agent” where appropriate

### Agents
- [ ] Detect agent type where feasible (Claude vs Codex vs other)
- [ ] Simplify Codex start command / remove unnecessary hard-coded flags

### Config-driven buttons
- [ ] Custom buttons are wired from config JSON
- [ ] Cascaded config hierarchy works reliably
- [ ] Dynamic port selection avoids collisions

### Skill + docs
- [ ] Skill doc added for folder/worktree conventions
- [ ] “Products” quick links: pull latest master + start + open/copy URL
