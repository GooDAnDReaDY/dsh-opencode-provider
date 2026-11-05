# Changelog

## 0.5.36 — audit remediation follow-up

- Empty timeout/image/catalog numeric fields now unset the setting instead of silently writing hardcoded defaults; invalid values still fail on save.
- Final audit artifact: 153 tests, client smoke, authenticated LAN route checks.

## 0.5.35 — audit remediation

- **Proxy/auth (#106, #107, #112)**: authenticated proxy URLs are built after bare-address validation; non-loopback peers require the admin token; the updater is behind the same guard; credential refs are restricted to plugin-owned refs; custom endpoints require `allowCustomEndpoints`.
- **Transports (#108, #109, #113, #114)**: `error:null` is ignored, `response.incomplete` finishes as max-tokens, abort listeners are replaced with `AbortSignal.any`, SSE early exit cancels upstream, and `retry-after` is honored for 429/402.
- **Secrets/UI (#110, #111, #119, #122, #123, #124)**: key writes use saved refs and clear drafts on reorder; refresh adopts state without stale drafts; quota polling stops when Off; one 80/95 severity policy; theme-correct heatmap/CSS; alert/status roles and discard confirmation; mapped HTTP errors.
- **Caches/data (#115, #116, #117, #118)**: bounded analytics ranking, directory recreation for request logs, exact-URL pricing with negative catalog cache, and strict `gt` tier boundaries.
- **Tests/docs (#120, #121)**: test glob instead of a hand-maintained list, client smoke in `check`, README/DESIGN sync and RU/ZH feature sections.
- 153 tests.

## 0.5.34 — release 11: engine matrix and audit closure

- **#55 — engine matrix**: `npm run test:engine -- <candidate.tgz>` validates one immutable candidate against `engines.dsh` and `dsh.compatibility.dshReleases`, and rejects test/source content. It never installs DSH, starts a runtime, extracts the tarball, uses a worktree path, or performs forced cleanup; compatibility execution remains on the approved MiniPC contour.
- **#39 — project/security audit**: added `AUDIT.md` with verified findings. Production dependencies audit clean; the dev/peer `zod` advisory and optional-auth/lockfile caveats are recorded as residuals.
- **#82 — Duskriver parity**: all 18 child issues are closed; the parity parent is closed with the evidence index.
- 149 tests.

## 0.5.33 — release 10: admin token and dependency audit

- **#41 — authenticated HTTP routes**: optional owner `adminToken` (profile config or `OPENCODE_ADMIN_TOKEN`). When set, every `/dsh-opencode/*` route requires `x-opencode-token` or a Bearer token with constant-time comparison; forged Host/Origin alone no longer passes. The settings UI prompts for the token and keeps it in this browser.
- **#42 — zod audit**: confirmed `zod` 4.4.3 is pinned by all DSH 0.2.2-rc.1 packages; GHSA-mrhx-c7xc-m3w5 affects `<4.6.6`. No DSH release with the fix exists, this plugin does not bundle zod, and no forced override was added. Residual exposure is documented and must be re-audited after the upstream update.
- 145 tests.

## 0.5.32 — release 9: proxy auth and route switches

- **#71 — authenticated proxy**: `proxyUsername` plus a password stored in the credential service enable Basic auth for HTTP/HTTPS and SOCKS5 proxies. The authenticated URL exists only in memory; `/state` returns the credential-free address and a `configured` flag, never the password.
- **#80 — route switches**: `goEnabled` and `consoleEnabled` are exposed in Settings. Disabling a route removes it from the provider directory, the picker and request handling at runtime; at least one route stays enabled.
- 144 tests.

## 0.5.31 — release 8: command localization

- **#48 — `/opencode` localization**: new `commandLocale` setting (`en` default, `zh`) localizes status, usage, accounts, models, rules and errors. Exposed in Settings → OpenCode.
- **#72 — thinking budgets**: DSH exposes selectable `reasoningEffort` ids only; there is no numeric per-model token-budget seam, and the Anthropic transport uses `output_config.effort`. No synthetic mapping is added; limitation recorded in DESIGN and the issue is closed with evidence.
- 140 tests.

## 0.5.30 — release 7: pricing accuracy

- **#74 — peak/off-peak multipliers**: analytics now reads live gateway `cost.multipliers` and evaluates UTC weekday/hour/date conditions at the session timestamp.
- **#84 — tiered pricing**: live gateway context overrides are normalized into tiers and selected from billed input (`input + cacheRead`) before multipliers. Malformed pricing metadata fails open to the generated flat cost.
- 139 tests.

## 0.5.29 — release 6: catalog refresh and Free-lane decision

- **#77 — catalog refresh**: `catalogRefreshMinutes` (1–10,080, default 10) controls the live `/models` cache; explicit `/models/refresh` still bypasses it. Exposed in Settings.
- **#76 — Free-lane decision**: re-probed keyless `big-pickle` on 2026-11-05; HTTP 429 `FreeUsageLimitError`. No keyless route or header-spoofing lane is added; the keyed Console/Zen path remains supported. Evidence recorded in DESIGN/README.
- 137 tests.

## 0.5.28 — release 5: image policy and preparation timeout

- **#73 — image policy**: `maxImages`, `maxRequestImageBytes`, `requestImagePixelBudget` and `requestImageMaxBytes` are configurable in Settings; defaults preserve the previous 50 images / 24 MiB / 1568px / 1 MiB behavior. Count and pixel policies are covered by tests.
- **#78 — preparation timeout**: `requestPreparationTimeoutMs` (default 60s) bounds image resolution before dispatch, independently of the response-header timeout; caller aborts still win, and timeouts surface as `TIMEOUT`.
- 136 tests.

## 0.5.27 — release 4: catalog freshness

- **#86 — new-model badge**: the live catalog now keeps `release_date` (or `created`) metadata; Settings marks models released within the last seven UTC days with a NEW badge and date tooltip. Dates are dropped safely when the gateway omits or malforms them.
- **#85 — output ceiling**: the default generated-output cap is 65,536 tokens (was 32,768), matching the reference plugin while still respecting each model's own `maxTokens` and explicit caller limits.
- 133 tests.

## 0.5.26 — release 3: quota display and switch notices

- **#75 — quota display modes**: new `usageDisplay` setting with `auto`/`always`/`off` (legacy `showSidebarQuota` maps to `always`); `auto` shows the sidebar card when a Go usage report exists. Exposed in Settings and TUI.
- **#79 — account-switch notice**: routing trace entries now carry the opaque DSH session id; a `conversation.composer.dock` notice shows a non-blocking switch message for the current conversation after rotation or quota fallback. No prompt content or keys are exposed.
- 130 tests.

## 0.5.25 — release 2: stale data

- **#87 — stale usage**: a failed usage refresh now returns the last successful report with `stale: true` and `lastSuccessAt` instead of discarding it. The quota sidebar/panel and Settings label the stale snapshot; an explicit refresh no longer loses the previous reading.
- **#88 — stale analytics**: a failed analytics rescan keeps the previous report and heatmap visible with a stale notice and a retry button instead of blanking the panel; successful rescans clear the stale flag.
- 127 tests.

## 0.5.24 — release 1: account safety

- **#89 — managed credential cleanup**: keys saved through Settings or imported from `auth.json` are recorded in `~/.dsh/storages/dsh-opencode/managed-credentials.json` (refs only, never secrets). Removing an account asks for confirmation and deletes only plugin-managed credentials after the settings save succeeds; external environment/`auth.json` references are left intact. Cleanup failures are reported separately from the account removal.
- **#83 — autoSwitch**: new `autoSwitch` setting (default `true`, preserving prior behavior). When off, the selected/first usable account serves alone; quota/credential failures do not rotate and quota fallback is disabled. Exposed in Settings and TUI.
- 126 tests.

## 0.5.23

- **DSH 0.2.2 support**: compatibility now accepts every `0.2.2` prerelease and final release with `>=0.2.1-rc.2 <0.2.3-0`; `0.2.2-rc.1` is recorded as verified. Dev/typecheck dependencies moved to `@deepseek-ai/*@0.2.2-rc.1`, Cordis 4.1.0 and Schemastery 3.19.0; peer ranges admit both the 0.2.1 and 0.2.2 lines.
- **Host webserver compatibility**: route registration now types handlers against `WebRoute` instead of indexing the new `WebRoute | WebResourceRoute` union, preserving 0.2.1 behavior while compiling on 0.2.2.
- **Verification**: isolated DSH 0.2.2-rc.1 web profile activated both routes, discovered 29 models and completed a real `deepseek-v4.1-flash` request (`OK`); 0.2.1-rc.4 and 0.2.1-rc.2 activation regressions also pass. `npm run check`: 124/124 tests.

## 0.5.22

- **Proxy transport**: one live `proxyUrl` setting (HTTP, HTTPS or SOCKS5) now covers inference, catalog discovery and usage checks. Dispatchers are shared by address and released when the plugin unloads; proxy credentials are rejected so the settings API never returns a secret.
- **Account pool parity**: up to 20 accounts, drag-and-drop priority in Settings, promotion of the account that served the last request (persisted alongside sticky state), and a 5-minute invalid-credential cooldown matching the reference plugin.
- **Per-model overrides**: per-model context window and output caps are now editable per model; `0` omits the output cap. The output override also applies to request construction, not only the model descriptor.
- **Tool-call validation**: numeric/null ids and names from OpenAI Chat, Anthropic, Responses and Google streams are normalized to string fallbacks before emitting `tool-call-delta`; a repeated `id:null` no longer overwrites the id from the first fragment. Six regression tests cover streaming, continuation, non-SSE and all transports (GitHub #2).
- **Docs/TUI**: README/RU/ZH mirrors and the TUI connection section expose the same fields; 124 tests.
- **Not added**: a separate keyless Free route. A live probe returned HTTP 429 `FreeUsageLimitError`; the existing keyed Console/Zen route remains the reliable path.

## 0.5.21

- **Analytics completeness**: projection scans above 5000 files now select the newest files by metadata instead of an arbitrary readdir page; file-limit and unreadable-projection cases set `AnalyticsReport.partial`, surfaced in the dashboard.
- 113 tests.

## 0.5.20

- **CI/reproducibility**: regenerated `package-lock.json` with the normal npm resolver; clean `npm ci --ignore-scripts` now succeeds and `npm run check` passes.
- **Streaming correctness**: SSE parsing now normalizes CRLF/CR across chunk boundaries; all four transports reject streams that end without their protocol terminal event. Pre-aborted caller signals are rejected before provider dispatch.
- **Concurrent settings**: settings saves carry the draft revision and use the settings compare-and-swap; revision conflicts return 409 instead of overwriting another page's changes.
- **UI safety**: removing an account clears unsaved per-row key drafts; clearing a credential asks for confirmation; update checks distinguish registry failure from “up to date”; service status never reports healthy before a successful check.
- **Images**: request budget counts repeated image occurrences and base64 overhead; offloaded images no longer require the attachment service.
- **Docs/tests**: added project `AGENTS.md`; removed the unsafe local engine-matrix script pending the approved DSH test contour (`#55`).

## 0.5.19

- **Per-model soft cooldown**: quota/free-tier/rate-limit rejections now cool only that key+model (`quota` 5m, `rate-limit` 60s); other models on the same account remain usable. Invalid credentials still cool the account. If every key is cooling, the request degrades to the normal candidate list instead of failing before dispatch.
- **Service status**: `/state` exposes the usage check time, latency and error, plus catalog source (`live`/`snapshot`), count and fetch time. Settings shows a compact Service status card.
- 105 tests; engine matrix/install matrix remain green.

## 0.5.18

- **Compatibility range**: `engines.dsh`, DSH peer ranges and `dsh.compatibility.dsh` now use `>=0.2.1-rc.2 <0.2.2-0`; `dshReleases` keeps the tested rc.2/rc.3/rc.4 records. Future `0.2.1` RCs are admitted automatically; the next minor remains excluded.
- **Engine matrix**: added `test:engine` and `test:install`, which install the packed plugin into isolated web profiles for every `dshReleases` version, then boot the host and assert provider activation and a non-empty live catalog.
- **Key status**: `/state` now reports `keyStatus` per account (`ok`, `expired`, `invalid`, `missing`, `unavailable`, `unchecked`); usage 401/403 bodies are classified as expired/invalid. Settings shows the badge and adds a per-account **Check key** action backed by the new `/dsh-opencode/accounts/check` route. A check only reads the usage endpoint and does not send a model request.
- 104 tests.

## 0.5.17

- **DSH 0.2.1-rc.4 compatibility**: added rc.4 to `engines.dsh`, peer ranges and `dsh.compatibility.dshReleases`; rc.2 and rc.3 remain supported. Development/typecheck dependencies moved to `@deepseek-ai/*@0.2.1-rc.4`.
- Verified plugin activation, provider catalog and a real request on an isolated DSH 0.2.1-rc.4 web runtime.
- 102 tests.

## 0.5.16

- **Current DSH core compatibility**: added `0.2.1-rc.3` (the current Desktop runtime) to `engines.dsh`, peer ranges and `dsh.compatibility.dshReleases`, while retaining `0.2.0-rc.2` and `0.2.1-rc.2` for DSH Web 111.
- Development/typecheck dependencies moved to `@deepseek-ai/*@0.2.1-rc.3`; typecheck, build, and 102 tests pass against rc.3.
- 102 tests.

## 0.5.15

- **Write security**: all write endpoints now require a same-origin `Origin` or `Referer` whose host matches `Host`; a request with neither is rejected with 403 instead of being treated as local. Regression tests cover missing headers, Referer fallback and the DSH LAN bridge path.
- **Release tooling**: `prepare` sends tsdown output to stderr, so `npm pack --json` emits parseable JSON for preflight.
- 102 tests.

## 0.5.14

- **DSH WEB compatibility**: same-origin requests from a literal local interface address (for example `192.168.1.111`) are accepted alongside loopback. DNS-rebinding hostnames are still rejected. This restores Settings, sidebar quota, analytics and update status on DSH Web accessed at its trusted LAN URL.
- Config/key writes from that trusted same-origin host are enabled; `Origin` must match `Host`, and cross-site fetch metadata is rejected. Auto-update POST remains loopback-only.
- **UI lifecycle**: the injected style tag now uses the canonical `data-dsh-plugin` marker and lookup.
- 101 tests.

## 0.5.13

- Removed the unused `LEGACY_CONSOLE_PROVIDER` constant and the dead `settings.models.provider-card` slot declaration left by the custom provider-card removal.
- Removed a stray zero-byte `$null` file from the repository root.
- No runtime behavior change; 100 tests, typecheck and build pass.

## 0.5.12

- **Security**: read routes now require a literal loopback Host; `/state` is GET-only, `/health` and `/analytics` reject DNS-rebinding hosts, and updater status GET uses a loopback read guard. Added regression tests.
- **Routing correctness**: sticky selection and the success trace are recorded only after the stream completes; a mid-stream failure now records a failed trace, not a false success.
- **Onboarding**: auth-entry credential refs use injective hex encoding, so entries differing only by punctuation cannot overwrite each other. Added a collision test.
- **Client tests**: added React server-render smoke tests for analytics, heatmap, settings and quota panel; 100 tests.
- Read routes now work only from the local machine; a LAN-exposed web profile can no longer read plugin state (write routes were already loopback-only).

## 0.5.11

- **Usage fetch retry**: the quota reader retries one transient Node/undici network failure before caching `fetch failed`, so a brief connect timeout no longer leaves the quota panel without usage data.
- 91 tests.

## 0.5.10

- **Migration hint**: Settings → OpenCode explains the 0.5.7 provider-id split and why legacy `opencode`/`opencode-go` sessions stay on the built-in pi-ai routes. The analytics hint/empty state also distinguishes plugin routes from legacy traffic.
- 90 tests.

## 0.5.9

- **Analytics provider filter**: after the provider-id split, session model analytics includes only `opencode-direct`/`opencode-go-direct`. Legacy `opencode`/`opencode-go` sessions now belong to the built-in pi-ai catalog and are intentionally excluded, so the plugin no longer mixes built-in traffic into its model analytics.
- 90 tests.

## 0.5.8

- **Free-tier error cooldown**: a `FreeTierError` (free model used with a free/anonymous key) is now a short `RATE_LIMIT`, not `INVALID_CREDENTIAL`. The account rotates to the next key and is cooled for 60s instead of 24h; the key itself is not invalid. Added an adapter regression test.
- 90 tests.

## 0.5.7

- **Provider-id conflict fix**: the plugin now registers `opencode-direct` and `opencode-go-direct` instead of `opencode`/`opencode-go`. The built-in `llm-pi-ai` catalog owns those ids; reusing them triggered `DUPLICATE_DIRECTORY`, dropped the built-in catalog, hid other providers and disabled the add button. Existing sessions recorded under the old ids stay on the built-in routes; select **OpenCode (plugin)** or **OpenCode Go (plugin)** for this plugin's features.
- 89 tests.

## 0.5.6

- **Persistent sticky routing**: the last successful account/model per conversation survives adapter and Desktop restarts. `~/.dsh/storages/dsh-opencode/sticky.json` stores hashed session ids and key fingerprints only (no keys or prompt text), keeps 500 entries for 14 days.
- 88 tests.

## 0.5.5

- **Per-account request stats**: every upstream attempt now records its outcome, latency and TTFT in the local request log; the heatmap adds a per-account table with requests, errors and average latency/TTFT. No prompt or response content is stored.
- 87 tests.

## 0.5.4

- **Sidebar settings**: the quota-card switch moved out of Connection into its own **Sidebar** section in Settings → OpenCode and into the TUI; saving now refreshes the sidebar card immediately instead of waiting for the 60-second poll.
- 85 tests.

## 0.5.3

- **Per-account runway**: the quota panel estimates time to exhaustion for each account from the 5-hour, weekly and monthly burn rate and flags the first window projected to run out before its reset. The estimate is intentionally approximate; only the current percentage and reset time are exposed by the usage endpoint.
- 84 tests.

## 0.5.2

- **Quota fallback**: choose a free model in Settings → OpenCode. A Go quota rejection retries the same request once on Console/Zen with that model; failures surface the original quota error.
- **Sticky account**: the last successful account is preferred for the same conversation; explicit model rules, pinned accounts, and quota fallback still win.
- **Routing trace**: the quota panel shows recent account/model choices (`rule`, `sticky`, `rotation`, `quota-fallback`) without prompts or keys.
- **Per-account heatmap**: the request log records the account label, and the heatmap can be filtered by account.
- **File attachments** are projected to DSH handle text instead of failing; **tool-result images** are inline on Anthropic, OpenAI Responses and Google (OpenAI Chat keeps a placeholder).
- **Account onboarding**: import every OpenCode `auth.json` key into its own credential ref and add matching accounts; **Check all accounts** refreshes quota and health per account.
- TUI exposes `quotaFallbackModel` and `stickySession`; 82 tests.

## 0.5.1

- Remove the non-standard inline key card from Settings → Models. Provider cards stay standard; the key is edited only through **Изменить** on the OpenCode settings page.

## 0.5.0

- **Parity release**: TUI settings section, plan-aware Go picker, request-wide image budget and tool-schema normalization.
- Package identity is now scoped: `@goodandready/dsh-opencode-provider` (unscoped npm name belongs to an unrelated package).
- Custom composer cost pill and custom analytics cost columns removed; cost is shown only by DSH's native display.
- One-click plugin update in Settings → OpenCode: registry status, badge, exact `dsh plugin add`, restart notice, loopback/same-origin POST guard.
- English, Chinese and Russian READMEs and a visual-verification asset ship in the package and GitHub tree.
- **Usage analytics dashboard** in the quota panel: KPI grid, 7/30/90 window, and Models / Days / Sessions tables; success/errors show `—` because the local projection does not expose failed attempts. Cost is not duplicated: DSH's native display is the only cost surface.
- **Tool limit fix**: tools are deduplicated by name and capped at OpenCode's 128-item maximum before every transport, fixing `HTTP 400: maximum number of items is 128` in tool-heavy profiles.
- **Test connection** button in the key card: pick a model, run a minimal real request, see latency and the reply.
- `POST /dsh-opencode/test` Host route with a 60-second budget.
- Sidebar quota bars now change color at 75% (warning) and 90% (critical).
- Write routes require a literal loopback `Host` (not just a loopback socket) in addition to same-origin and JSON checks, closing DNS-rebinding key exfiltration.
- Analytics no longer fabricates `100%` success / `0` errors; the local projection returns `null` and the UI shows `—`.
- Go plan filtering now fails open for models that exist only in the live catalog; known Console models stay hidden.
- Tool truncation at the 128-item provider limit logs a one-time warning instead of failing silently.
- TUI settings refresh after `/config` account changes; analytics requests have an error state and a generation guard against the 7/30/90 race.
- Projection analytics reads run with bounded parallelism; `.commandcode/` is ignored; provider registration logs at boot.
- Tool-result images are replaced with an offload placeholder instead of failing the whole request in every transport.
- Core harness tools (`read`, `write`, `edit`, `bash`, `glob`, `grep`, …) survive the 128-tool cap even when a large MCP set is present.
- `GET /dsh-opencode/health` reports provider registration, account count and model count for startup diagnostics.
- The TUI settings section polls live config, so accounts/allowlist changes made from the terminal refresh without a restart.
- Client colors moved to DSH theme variables; the `zh` dictionary is a real translation; draft/route/widget helpers moved to `settings-draft.ts`, `settings-widgets.tsx`, `routes-public.ts` and `routes-values.ts`; quota triggers expose real `aria-expanded` panel state.
- Tests grew to 84, including TUI polling, health, core-tool preservation and tool-result image placeholders.
- Rotation now also triggers on quota/usage-limit bodies (400/402/403/429), with a 10-minute or `Retry-After` cooldown for quota rejections.
- The last account is marked on rejection as well; account rows expose `mark`/`coolingUntil`, show a cooldown badge, and the active marker follows the first non-cooling key.
- Per-account quota reads: `/state.accounts[].usage` is fetched for each distinct key (`UsageReader` caches per key), the active account drives the sidebar and quota panel, Accounts rows show 5h/week/month chips, and the panel has an accounts table. Verified live: `default` 1/5/2 and `Go #2` 9/4/100 with `rate-limited` monthly until 22 Oct 08:21.
- Request heatmap (Monday-first weekday × local hour) in the quota panel. The adapter appends `{at, provider, model, purpose?}` to `~/.dsh/storages/dsh-opencode/requests.jsonl` and `/analytics` merges the aggregate; prompts, responses and keys are never stored. Live: two `/test` calls produced `Tue 13:00 = 2`.
- Heatmap accuracy: `session-title` / `compaction` calls are excluded and exact duplicate records collapse. Live after two real chat messages: analytics shows 2 OpenCode sessions (`deepseek-v4.1-flash` ≈$0.00079, `beam-free` Free), while the heatmap counts 6 main requests instead of 8 raw records.
- A 24-hour aggregate strip under the heatmap sums the selected window by hour across all days; its bars use the same intensity scale and tooltips.
- Per-model heatmap: `/analytics` returns a `models[]` series (provider/model, total, hours, grid), and the panel offers an **All models / model** selector when more than one model has traffic. Live: `deepseek-v4.1-flash` 2, `minimax-m3.1-flash-free` 1.
- Account cooldowns persist across restarts in `~/.dsh/storages/dsh-opencode/cooldowns.json`, keyed by a SHA-256 fingerprint (raw keys are never written). Expired entries are dropped and the file is capped at 50. Live: after a restart, `Go #2` kept its `quota` mark until 22 Oct 08:21 while the restored default key was active.
- Model → account rules: first matching glob (case-insensitive `*`/`?`) pins a preferred account for that model, with the other accounts kept as fallbacks. Config is normalized and exposed through `/state`; Settings has an editor. Live: `*free* → Go #2` round-tripped through `/config` and `/state`, then cleared.
- Sidebar quota card redesigned to match the clinebot meter: theme-native ring, active account name, highest-window percent, and 5-hour / weekly / monthly rows with remaining quota, reset countdown and thin bars. Uses DSH CSS variables and has a narrow rail variant. The header percentage is right-aligned with the row values.
- Quota panel now has its own vertical scroll (`height: 100%`, viewport max-height, `overflow-y: auto`), so content below the fold is reachable; verified in Desktop by opening the panel and scrolling to **Usage by model**.
- Quota panel polish: the badge now says **Active account** (not "Pinned account" when `activeAccount` is empty), Accounts rows show persisted cooldown / provider rate-limit badges (for example `Quota cooldown · 2d`), and the 5-hour/weekly/monthly bars show date+time with a relative reset (`1% · 20.10, 17:11 (2h)`).
- `/opencode` gained `accounts`, `models`, `rules` and `test [model]`; `status` now includes per-account quotas and rules.
- Request log compaction at 2 MB (newest 5000 lines) and a `npm run check` / `npm run release` workflow plus GitHub Actions CI (`typecheck`, tests, build, pack).
- Live-verified two-account rotation in DSH Desktop: with an invalid default key, `/test` switched to `Go #2` and returned `OK`. A later run found `Go #2` at its monthly limit (98% before the tests) and showed `quota` with the provider's reset.
- `GET /dsh-opencode/analytics` and the **Usage by model** table in the quota panel (7/30/90 days). It aggregates only numeric metadata from the local session projection cache; a session is attributed to its last-used model.
- Verified live in DSH Desktop 0.2.1-rc.2; install there from the packed tarball (a directory path triggers the Desktop CLI's `dsh-desktop-runtime` alias bug).

## 0.4.1

- Accounts card can set each account's key from the page; unconfigured accounts are listed with a missing-key badge.
- Live catalog refresh button (`POST /dsh-opencode/models/refresh`).
- Quota warning banners at 80% and 95% in the settings page.
- Expandable subscription-limits table: per model, Go and Go Plus monthly allowance plus 5h/week/month request estimates.

## 0.4.0

- Per-model OpenCode Go subscription limits: monthly dollar allowance and estimated requests for the 5-hour, weekly and monthly windows, for Go and Go Plus.
- Limits appear in the model picker description and as a badge in the settings model list; hovering shows both plans.
- Added `src/subscription-limits.ts` with the official table and formatting helpers.
- Tests: limits table integrity, formatting, and route-gated model descriptions.

## 0.3.1

- Composer session-cost estimate (`≈`/`≥`/`Free`) from the generated price snapshot and the `tokenUsage`/`modelSelection` projections.
- Model price badges in the settings page; model picker descriptions now include per-1M input/output rates.
- OpenCode auth-entry autocomplete from the entries actually present in `auth.json`.
- Broadened live tool-loop coverage (Grok, Muse, Qwen).

## 0.3.0

- Browser settings page (`Settings → OpenCode`): key management, quota bars, accounts, model allowlist, per-model transport overrides, connection settings.
- Sidebar quota card (opt-in) and the center-column quota panel.
- Host HTTP routes under `/dsh-opencode/*` with same-origin enforcement.
- Key import from OpenCode's `auth.json` through the credentials seam.
- Client bundle built as a `window.__ModuleLoader__` module with React externalized.

## 0.2.0

- Native Anthropic Messages transport (thinking blocks, signatures, tool use).
- Native OpenAI Responses transport.
- Native Google Generative AI transport with `thoughtSignature` replay.
- Image input on every transport, through `ctx.attachments.readImageRequest`.
- Multi-account pool with pre-stream 401/403/429 rotation and per-key cooldowns.
- `/opencode` command with status and quota windows.
- Reasoning-effort mapping and output caps.
- Expanded unit tests and live smoke scripts.

## 0.1.0

- Initial P1 skeleton.
- Registers `opencode` and `opencode-go` routes on the dsh `llm` service.
- OpenAI Chat transport over the Go unified gateway.
- Stable `x-opencode-session` derived from the durable session id.
- Key resolution from config, the credential seam, OpenCode `auth.json`, and the launch environment.
- Live model catalog with a generated `models.dev` fallback.
- Text, reasoning, streamed tool calls, usage, and classified provider errors.
