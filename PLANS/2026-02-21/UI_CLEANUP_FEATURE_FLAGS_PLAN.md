# UI Cleanup + Feature Flags Plan (2026-02-21)

## Goal
Streamline the Claude Orchestrator UI, hide confusing/unused actions by default via settings/feature flags, restore the blue theme, and compact the dashboard/worktree layout without losing key functionality. Implement with incremental commits and run existing automated tests.

## Guiding Constraints
- Hide UI elements by default (feature flags or settings), not hard-delete unless explicitly requested.
- Keep required actions: View PR on GitHub, View Branch Diff, Assign Code Review, Start Agent with Options, Review Console, Start Server, Show Only This Worktree, View Branch Diff.
- Maintain functionality for removal/close actions but reduce confusion and visual clutter.
- Make “Remove worktree from workspace” always visible (no hover-only).
- Run automated tests that already exist.
- Commit and push after each logical mini-step.

## Mini-Step Plan
1. **Planning + Settings scaffolding**
   - Add new UI visibility flags to `user-settings.default.json` and server defaults.
   - Wire defaults into client reads.
   - Commit + push.

2. **Header + Process banner cleanup**
   - Hide confusing header items by default (Diff, Review Route, Activity, etc.) via settings.
   - Hide top WIP/BWQX banner by default.
   - Keep essential view controls (Focus/All/Review/Background). Optional: compress or group tier filters.
   - Commit + push.

3. **Sidebar worktrees compacting**
   - Remove “View Presets” button and modal access.
   - Flatten “Active Only” and tier filters into one row and reduce vertical space.
   - Hide “Refresh branch label”, “Mark ready for review”, “Show agent terminal”, “Show server terminal” toggles by default.
   - Make “Remove worktree from workspace” always visible (no hover-only).
   - Commit + push.

4. **Terminal controls cleanup**
   - Hide buttons by default: Advanced Diff View, Advanced Branch Diff, View Branch on GitHub, Build Production Zip, Interrupt, Refresh Terminal Display, Start Claude with Settings, Create New Project, Start Server Dev, Force Kill (server), Launch Settings, View Branch on GitHub.
   - Keep: View PR on GitHub, View Branch Diff, Assign Code Review, Start Agent with Options, Review Console, Start Server, Show Only This Worktree.
   - Remove duplicate/ambiguous control between “Close terminal process” and “Remove worktree from workspace” (keep only one if requested). If keeping both, make one hidden by default.
   - Commit + push.

5. **Intent hint + refresh branch label**
   - Disable intent hint (haiku) feature by default (no agent calls).
   - Ensure branch label refresh is automatic (no manual button).
   - Commit + push.

6. **Dashboard compaction + ordering**
   - Hide by default: readiness, WIP queue widget, projects, advice, polecats, telemetry, status, process, discord, suggestions, etc. (per request).
   - Make workspace cards compact and sort by last used (already sorted, tighten UI + spacing).
   - Place Workspaces left, Quick Links + Running Services in right column without excessive scrolling.
   - Provide “Claude Orchestrator on/off” button on dashboard.
   - Rename empty workspace creation from timestamped to “Workspace 1/2/3…” naming scheme.
   - Commit + push.

7. **Commander panel cleanup**
   - Hide or simplify confusing Commander controls (Cmd mode, Start/Stop/Start Claude, Advice) by default.
   - Keep sessions button if desired.
   - Commit + push.

8. **Theme restoration**
   - Restore blue theme defaults (skin = blue, intensity high).
   - Ensure “blue shrimp” styling is applied globally.
   - Commit + push.

9. **Tests + PR**
   - Run existing automated tests (`npm test` or as appropriate; also `node --check server/index.js`).
   - Fix any failures.
   - Create PR and provide URL.

## Verbatim Request (Do Not Lose Context)
```
PLEASE PULL THE ABSOLUTE LATEST MASTER branch code, confirm ur on it, then do a new branch for these changes: MAKE A DOCUMENT FOR THEM, break them down into mini steps, and commit n push each time please >> ensure autoamted tests are run if existing.  OK in the Claude orchestrator we want to add some feature flags and settings to toggle some of this stuff off so I see something called WIP2BWQXT10T14 etc it's like this little element at the top flag that as some kind of setting whatever that is turn it off by default then in the agent thing like the agent terminal I want you to hide the thing again flag this stuff up but I've got one called closed terminal process and one called remove work tree from workspace I don't know what the difference between these two are I need to get rid of one of them then we've got the advanced diff view and also the advanced branch diff again I don't know what they are but hide it for now again flag it then we've got the view PR on github keep that one when it's there view branch diff keep that one view branch on github hide that one build production zip hide that one by default assign code review leave that for now interrupt hide that one for now refresh terminal display hide that one for now start agent with options maybe leave that one start Claude with settings and create new project hide that for now show only this work tree mmm yeah you can leave that review console leave that for now start server dev hide that one for now and then in the server terminal 1 we've got forced kill and interrupt mmm I don't get what the difference is between them but let's just get one of them build production zip hide that one create new project hide that one show in this work tree I guess we can keep that launch settings hide that one for now start server leave that one for now

Then, so where it says empty works like when we create an empty workspace we don't really want to be calling an empty workspace, we don't want the long time stamp necessarily. We more just want to call it workspace 1, workspace 2, workspace 3 you know just count up and don't have timestamps or anything on the name Then Get rid of the bit that says agent orchestrator, okay, that's just cruft And then The stuffers got in the work trees on left got all t1 t2 t3 t4 and none And then active only they should all be in the same row. The thing where it's got work trees and view presets I don't know view presets is but let's get rid of it And then the work trees should just be like the heading again. Make sure it's really efficient because we're really taking up too much space here you know And then Yep after that, I Don't know what mark ready for review is Or a fresh branch label yeah, fair enough, but that that should be or get rid of that refresh branch label that should all be automatic in the background Hide mark ready for review as well Hide the show agent terminal and show server terminal for now as well Thanks and make that remove work tree from workspace make that More visible at the moment. You actually got a hover to make the thing visible so you get fix all that

Then look, I really need you to look deeply into Well actually, okay so Then so on the dashboard okay let's hide the readiness check readiness thing on the dashboard let's hide the top right thing that's like work in progress queue by default um let's hide the projects thing for now let's hide the advice thing for now let's make the discord thing whatever let's hide the poll cats i don't what no what that is let's hide the telemetry let's hide the status one let's hide you know the process thing as well um where it's got active workspaces yep that's fair enough but we want to have that like these work space and all work space things the cards around these are far too inefficient they're too big they're too huge right so we need to make that way more efficient things and we also need to sort them by latest used or something last used up top like in order

Also want a button to have Claude orchestrator toggle on and off from the dashboard as well so and then quick links running services yeah they should be a bit more efficient so yeah effectively I shouldn't have to keep scrolling around for this kind of stuff like I feel like I want the workspace is kind of like on the left and I want like Quick Links and running services kind of been the right column you know one after the other so I don't want to keep scrolling up and down so like really make this area way more efficient and even start at the top the agent orchestrator like this too much vertical space in horizontal space between everything the new project thing should probably also be more and the new workspace thing they should be more have their own little section somewhere I don't know yeah so do that

The Commander Claude I don't really get what CMD off is either I don't get what start Claude vs start and stop is or fresh sessions advice probably hide advice I don't know I know what sessions is but I'm just have a look into that

So I'm already discussed a blue color theme like it was blue shrimp and it was like a really nice blue I kind of want to make sure we have like that theme or whatever we lost all that really beautiful blue theme

Then again I don't know what the difference between PR's Q chats commands review route activity diff I really get what all of the difference between them are and I get the difference between focus all or review and yeah the night background little thing as well I don't get the difference between all them so yeah we need to clean all that up a bit yeah and then also this thing that's like intent hint that let's flag that off because it's not working properly let some put that off by default and make sure it's not happening and not calling any agents for now also I have is also this little refresh branch label thing again on the agent get rid of that that should be automatic it should be automatic somehow

BRO do ui have a .md plan yet? IF NOT MAKE ONE, dont u dare lose the context of what we want, dump my entire prompt for sure
```
