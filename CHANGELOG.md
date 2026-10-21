# Changelog

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
