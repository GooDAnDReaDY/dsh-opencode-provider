# Project and security audit

Read-only review of `main` on 2026-11-05. Findings are recorded separately from
implementation; no production runtime or other plugin was modified during the
review.

## Scope

- Architecture: Host routes, adapter/transports, credentials, proxy, catalog,
  analytics, settings/client bundle.
- Correctness: routing, account failover, streaming, tool-call normalization,
  pricing/analytics, image policy.
- Security: HTTP boundary, secret handling, updater, dependency graph.
- Tests and prior issues: 153 tests, tracked parity/security backlog.

## Verified findings

| # | Severity | Finding | Status |
|---|---|---|---|
| A1 | High (dev-only) | `zod` 4.4.3 is pinned by every `@deepseek-ai/dsh-*` 0.2.2-rc.1 package; GHSA-mrhx-c7xc-m3w5 affects `<4.6.6`. | Residual. `npm audit --omit=dev` reports **0 vulnerabilities**; the plugin does not bundle zod. No DSH 0.2.2 release with 4.6.6 exists and no forced override is applied. Re-audit after upstream. |
| A2 | Medium (deployment) | Same-origin checks are CSRF protection, not authentication. DSH exposes no host auth for plugin routes. | Mitigated by optional `adminToken`/`OPENCODE_ADMIN_TOKEN` with constant-time comparison on every `/dsh-opencode/*` route and a browser prompt. If no token is configured, the existing loopback/same-origin guard remains; this is documented, not represented as authentication. |
| A3 | Low (operational) | Production profile `pnpm-lock.yaml` files were not regenerated during manual `node_modules` deployments. | Residual operational note. Packages installed by verified tarballs; regenerate lockfiles separately before any `--frozen-lockfile` install. |
| A4 | Low (scope) | Engine compatibility cannot run from a worktree or force-kill a runtime under project rules. | `npm run test:engine -- <candidate.tgz>` validates immutable candidates read-only; compatibility execution stays on the approved MiniPC contour. |

No critical findings were verified. No raw API keys, prompt text, image bytes
or proxy passwords are written to analytics, heatmap, request logs or sticky /
cooldown state. Credential values are masked in the UI and diagnostics.

## Evidence

```bash
npm run check                 # 153 tests + typecheck + build + client smoke
npm audit --omit=dev --json   # 0 production vulnerabilities
npm ls zod --all              # zod 4.4.3 through DSH dev packages
npm run test:engine -- <candidate.tgz>
```

- Production package contents are limited by `files`; no tests, sources,
  credentials or worktrees are published.
- HTTP writes require a JSON body, same-origin `Origin`/`Referer`, a trusted
  Host, and the admin token when configured.
- The updater is loopback-only and also sits behind the admin-token guard.
- MOA and other plugins were not touched.

## 0.5.35 remediation

All confirmed findings from this audit were addressed in one release: proxy/auth, transport terminal events, abort lifecycle, retry-after, secret-write draft state, cache/data resilience, pricing boundaries, UI/CSS/accessibility, HTTP error mapping, test discovery and docs. The `zod` advisory remains upstream-blocked and is documented above. Verification: 153 tests, client smoke, typecheck and build.

## Conclusion

The production dependency surface is clean; the only high advisory is a
dev/peer `zod` pin inherited from DSH and blocked on an upstream release. The
remaining deployment caveats (optional admin token, profile lockfiles) are
documented and tracked. No open critical or correctness issue was found in the
reviewed scope.
