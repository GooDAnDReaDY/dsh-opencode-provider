# AGENTS.md — dsh-opencode-provider

Project-specific instructions for agents. The parent `DEV/AGENTS.md` remains authoritative.

## Scope

- Gitea is the source of truth: `goodandready/dsh-opencode-provider`.
- Production plugin targets: DSH Desktop and DSH Web 111.
- Do not edit the production profile or a DSH runtime unless the owner explicitly asks for a deployment.
- Do not touch other plugins, especially `dsh-moa`, while working on this project.

## Release rules

- Use the documented release workflow (`npm run check`, npm publish, Gitea PR/tag, then deploy only when requested).
- Support the tested `dsh.compatibility.dshReleases`; do not add exact-version exemptions.
- Keep npm package contents limited to `files`; never publish tests, plans, credentials or local worktrees.
- Do not use forced dependency updates or bypass CI checks.
- After a requested deployment, verify `/dsh-opencode/state`, `/health`, `/analytics` and `/update`, then record the result.

## Code and tests

- Run `npm run typecheck` and the full `npm test` suite; do not claim a compatibility matrix from typecheck alone.
- Preserve the separation between Host routes, transports, credentials and the browser bundle.
- Never persist raw keys, prompts or image bytes in logs, analytics, heatmap or sticky/cooldown state.
- HTTP writes require same-origin Origin/Referer; do not weaken this boundary without an owner-approved authentication design.
- Keep credentials masked in UI and diagnostics.

## Documentation

- README is English with RU/ZH mirrors; keep user-facing behavior and compatibility declarations synchronized.
- Record security-sensitive decisions and known limitations in `DESIGN.md`.
- Unknown infrastructure facts must be marked as unknown, not inferred.
