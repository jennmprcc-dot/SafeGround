<!-- managed:linked-repos -->
## Linked Repositories
- jennmprcc-dot/SafeGround
<!-- /managed:linked-repos -->

# SafeGround — Team Code Workflow

Live reference for how the team works on code. The lead maintains this file;
all members follow it.

## Repositories
- **Site/codebase:** `jennmprcc-dot/SafeGround` (linked). The TanStack Start app
  lives at `/home/team/shared/site` and is pushed to this repo.

## Working tree & branches
- All members share ONE working tree (`/home/team/shared/site`). Write work is
  serialized: one write delegation at a time.
- Members do code work on a **feature branch** and open a **pull request**;
  the lead reviews and merges via `gh pr merge` / `merge_pr`.
- After finishing, every member leaves the **default branch checked out** with a
  **clean tree** (stash or discard their local branch if merged).

## Before coding
- Read `CLAUDE.md` / `AGENTS.md` in the repository if present.
- Read the design docs in `/home/team/shared` (PRD.md, DESIGN_SYSTEM.md,
  WIREFRAMES.md, BUILD_NOTES.md).

## Pushing / shipping
- `bun run publish` from `/home/team/shared/site` builds + serves on :3000
  (the working URL). The lead calls `publish_site` to ship the live copy.

## Secrets
- Env vars live in the platform Secrets UI, injected as `DATABASE_URL`,
  `supabase_url`, `supabase_anon_key`, etc. NEVER commit real secrets to git.
  `.env*` are gitignored and denied from serving.
