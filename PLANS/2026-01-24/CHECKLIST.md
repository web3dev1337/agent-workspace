# Checklist: Process Layer PRs

Use this for every PR in `PLANS/2026-01-24/IMPLEMENTATION_ROADMAP.md`.

## Safety
- [ ] Running instance in `.../claude-orchestrator/master` is not touched
- [ ] Dev/test ports avoid 3000 (use 4001+ for tests)

## Build/Tests
- [ ] `npm run test:unit`
- [ ] `npm run test:e2e:safe` (or note why skipped)

## UX Validation (manual, <5 min)
- [ ] Dashboard loads
- [ ] Workspaces load and terminals type normally
- [ ] Quick Work modal works
- [ ] PR list works

## Shipping
- [ ] Commit message is scoped and clear
- [ ] Pushed to `origin`
- [ ] PR opened
- [ ] PR URL recorded in rolling log (if applicable)

