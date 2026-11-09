# Design Contract — dsh-opencode-provider

- **Package**: `@goodandready/dsh-opencode-provider`
- **Target DSH**: `>=0.2.1-rc.2 <0.2.3-0`
- **Domain**: OpenCode Inference Provider & Quota Management
- **Date**: 2026-11-09

## 1. Product Identity & Purpose

`dsh-opencode-provider` provides native DeepSeek Harness integration for the OpenCode inference platform across two distinct provider IDs:
1. `opencode`: Console pay-as-you-go inference.
2. `opencode-go`: Subscription-based Go & Go Plus tiers with automated quota tracking, runway estimation, and multi-account rotation.

The design goal is to deliver seamless native integration inside DSH while strictly respecting user interface tranquility: zero intrusive badges, zero unsolicited popups, and zero ambient background network load when features are disabled.

---

## 2. User Surfaces

The plugin registers components into 4 DSH slots:

### 2.1 Settings Section (`settings.section`)
- **Slot ID**: `opencode` (order: 20)
- **Component**: `OpenCodeSettingsPage`
- **Purpose**: Centralized administration of credentials, multi-account rotation rules, quota limits, proxy configurations, and UI appearance toggles.
- **Sections**:
  - Connection & Credentials (API key, default provider, proxy setup)
  - Accounts & Key Pool (Multi-account slots, auto-switch, sticky session)
  - Quota Runway & Display (Usage display mode, switch notices)
  - Model Overrides & Visibility (Context windows, output limits, model whitelist)
  - Usage Analytics & Heatmap

### 2.2 Main Layout Panel (`main`)
- **Key**: `opencode-panel`
- **Component**: `QuotaPanel`
- **Purpose**: Full-view analytical dashboard opened from the sidebar quota card or via the `/opencode` command. Displays comprehensive 5-hour, weekly, and monthly quota windows, runway projections, account quotas, and request heatmaps.

### 2.3 Sidebar Footer Action (`sidebar.footer.action`)
- **Slot ID**: `opencode-quota` (order: 1)
- **Component**: `QuotaCard`
- **Purpose**: Compact runway indicator directly above the Settings icon. In rail mode (`wide === false`), renders a minimal circular progress ring (`MiniRing`). In expanded mode (`wide === true`), displays account label, percentage remaining, and reset countdown.
- **Default State**: **DISABLED (`usageDisplay: 'off'`)**.

### 2.4 Composer Dock Notice (`conversation.composer.dock`)
- **Slot ID**: `opencode-switch-notice` (order: 80)
- **Component**: `SwitchNotice`
- **Purpose**: Non-intrusive ambient badge below the chat input indicating when an automatic account rotation or quota fallback occurred.
- **Default State**: **DISABLED (`showSwitchNotice: false`)**.

---

## 3. Components and States

Each user surface supports the following canonical states:

| State | QuotaCard / Panel | Settings Page | Composer Notice |
|---|---|---|---|
| **Loading** | Inline skeleton / placeholder bar | Inputs preserved, spinner on actions | Hidden |
| **Empty** | "No usage data" message | Default configuration shown | Hidden |
| **Ready** | Live quota runway with semantic colors | Synchronized with active DSH settings | Renders switch badge (if enabled) |
| **Error** | Graceful degradation, error tooltip | Inline banner with actionable text | Hidden (never disturbs chat) |
| **Disabled** | Returns `null` (zero DOM footprint) | Toggles shown in "Off" state | Polling stopped, returns `null` |
| **Conflict** | N/A | Compare-and-swap banner with 3-way merge | N/A |

---

## 4. Locked Design Decisions

1. **Zero Default Screen Clutter (2026-11-09)**:
   All visual indicators (`usageDisplay`, `showSidebarQuota`, `showSwitchNotice`) MUST be disabled (`'off'` / `false`) by default. Visual surfaces only appear after explicit user opt-in in settings.
2. **Strict Native Token Usage (2026-11-09)**:
   All component styling must use semantic DSH tokens (`--dsw-alias-bg-layer-*`, `--dsw-alias-label-*`, `--dsw-alias-state-*`, `--dsw-alias-interactive-*`). Hardcoded dark-only colors are prohibited to ensure fidelity in light and high-contrast themes.
3. **Zero Polling When Disabled (2026-11-09)**:
   When an ambient surface is disabled by configuration (e.g. `showSwitchNotice === false`), background interval polling must cease immediately. Polling resumes only upon receiving `dsh-opencode-config-changed`.
4. **Motion Hierarchy & Choreography (2026-11-09)**:
   Transitions must remain under 300ms (`ease`). Heavy external animation runtimes (GSAP, Framer Motion) are forbidden.
