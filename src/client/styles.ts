export const CSS_ID = 'dsh-opencode-provider'

export const CSS = `
.oc-page { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 24px; color: inherit; }
.oc-head { display: flex; flex-direction: column; gap: 4px; }
.oc-title { font-size: 18px; font-weight: 650; margin: 0; }
.oc-hint { font-size: 12px; opacity: 0.72; line-height: 1.5; margin: 0; }
.oc-card { border: 1px solid rgba(127,127,127,0.25); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; background: rgba(127,127,127,0.06); }
.oc-card-title { font-size: 13px; font-weight: 650; margin: 0; display: flex; align-items: center; gap: 8px; }
.oc-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.oc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.oc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-label { font-size: 12px; font-weight: 550; opacity: 0.86; }
.oc-input, .oc-select { font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 7px; border: 1px solid rgba(127,127,127,0.35); background: rgba(127,127,127,0.08); color: inherit; min-width: 0; }
.oc-input:focus, .oc-select:focus { outline: 2px solid rgba(80,140,255,0.5); outline-offset: 1px; }
.oc-button { font: inherit; font-size: 13px; padding: 6px 11px; border-radius: 7px; border: 1px solid rgba(127,127,127,0.35); background: rgba(127,127,127,0.1); color: inherit; cursor: pointer; }
.oc-button:hover:not(:disabled) { background: rgba(127,127,127,0.18); }
.oc-button:disabled { opacity: 0.5; cursor: default; }
.oc-button-primary { border-color: rgba(80,140,255,0.6); background: rgba(80,140,255,0.18); }
.oc-button-danger { border-color: rgba(220,80,80,0.5); color: #e07a7a; }
.oc-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(127,127,127,0.3); background: rgba(127,127,127,0.1); }
.oc-badge-ok { border-color: rgba(60,180,110,0.5); color: #4fbf86; }
.oc-badge-warn { border-color: rgba(220,160,60,0.5); color: #d9a24a; }
.oc-badge-bad { border-color: rgba(220,80,80,0.5); color: #e07a7a; }
.oc-heat-wrap { display: flex; flex-direction: column; gap: 8px; }
.oc-analytics-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.oc-tabs { display: flex; gap: 4px; }
.oc-tab { border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary, #a0a0a0); padding: 4px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.oc-tab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12)); color: var(--dsw-alias-label-primary, #e6e6e6); }
.oc-tab-active { border-color: var(--dsw-alias-border-l3, rgba(127,127,127,0.3)); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.15)); color: var(--dsw-alias-label-primary, #e6e6e6); }
.oc-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.oc-kpi { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-settings-card-stroke, rgba(127,127,127,0.22)); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-settings-card-fill, rgba(127,127,127,0.06)); }
.oc-kpi-value { overflow: hidden; color: var(--dsw-alias-label-primary, #e6e6e6); font-size: 18px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.oc-kpi-label { color: var(--dsw-alias-label-tertiary, #7a7a7a); font-size: 11px; line-height: 16px; }
.oc-table-scroll { overflow-x: auto; }
@media (max-width: 720px) { .oc-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.oc-heat-scroll { overflow-x: auto; padding-bottom: 4px; }
.oc-heat { display: grid; grid-template-columns: 32px repeat(24, minmax(12px, 1fr)); gap: 2px; align-items: center; min-width: 600px; }
.oc-heat-hour { font-size: 9px; color: rgba(127,127,127,0.75); text-align: center; }
.oc-heat-day { font-size: 10px; color: rgba(127,127,127,0.9); }
.oc-heat-cell { height: 14px; border-radius: 3px; }
.oc-heat-legend { display: flex; align-items: center; gap: 4px; font-size: 10px; color: rgba(127,127,127,0.8); }
.oc-heat-swatch { width: 12px; height: 12px; border-radius: 2px; }
.oc-hour-strip-head { margin: 10px 0 0; font-size: 10px; color: rgba(127,127,127,0.8); }
.oc-hour-strip { display: grid; grid-template-columns: 32px repeat(24, minmax(12px, 1fr)); gap: 2px; align-items: end; height: 30px; min-width: 600px; }
.oc-hour-col { display: flex; align-items: flex-end; height: 100%; }
.oc-hour-bar { display: block; width: 100%; min-height: 2px; border-radius: 2px 2px 0 0; }
.oc-hour-labels { display: grid; grid-template-columns: 32px repeat(24, minmax(12px, 1fr)); gap: 2px; font-size: 9px; color: rgba(127,127,127,0.7); text-align: center; min-width: 600px; }
.oc-bars { display: flex; flex-direction: column; gap: 8px; }
.oc-bar-row { display: grid; grid-template-columns: 72px 1fr auto; gap: 10px; align-items: center; font-size: 12px; }
.oc-bar { height: 8px; border-radius: 999px; background: rgba(127,127,127,0.2); overflow: hidden; }
.oc-bar-fill { height: 100%; border-radius: 999px; background: currentColor; opacity: 0.65; }
.oc-bar-fill-warn { background: #d9a24a; opacity: 1; }
.oc-bar-fill-bad { background: #d95a5a; opacity: 1; }
.oc-models { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow: auto; padding-right: 4px; }
.oc-model { display: grid; grid-template-columns: 22px minmax(0,1fr) 120px; gap: 8px; align-items: center; font-size: 12px; padding: 3px 0; }
.oc-model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-model-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; color: rgba(127,127,127,0.8); font-size: 11px; }
.oc-model-legend > span { display: inline-flex; align-items: center; gap: 5px; }
.oc-model-section { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid rgba(127,127,127,0.18); }
.oc-model-section:first-child { border-top: 0; padding-top: 0; }
.oc-model-section-head { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; font-weight: 650; }
.oc-model-section-head .oc-badge { padding: 0 6px; font-size: 10px; }
.oc-model-section .oc-hint { margin: 0 0 4px; }
.oc-account { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) auto; gap: 8px; align-items: center; }
.oc-account-block { display: flex; flex-direction: column; gap: 6px; padding: 9px; border: 1px solid rgba(127,127,127,0.2); border-radius: 8px; background: rgba(127,127,127,0.035); }
.oc-notice { font-size: 12px; padding: 7px 10px; border-radius: 7px; background: rgba(80,140,255,0.12); border: 1px solid rgba(80,140,255,0.3); }
.oc-error { font-size: 12px; padding: 7px 10px; border-radius: 7px; background: rgba(220,80,80,0.12); border: 1px solid rgba(220,80,80,0.35); color: #e07a7a; }
[class*="_footerActions"]:has(.oc-foot), [class*="_footerActions"]:has(.oc-railButton) { flex-direction: column; }
.oc-foot { box-sizing: border-box; flex: 1 1 auto; width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 6px; margin: 0 0 4px; padding: 8px; border: 0.5px solid transparent; border-radius: var(--dsw-radius-md, 8px); background: transparent; color: var(--dsw-alias-label-secondary, #a0a0a0); font: inherit; text-align: left; cursor: pointer; }
.oc-foot:hover { color: var(--dsw-alias-label-primary, #e6e6e6); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12)); border-color: var(--dsw-alias-border-l3, rgba(127,127,127,0.3)); }
.oc-foot:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4fbf86)); outline-offset: -2px; }
.oc-footTop { display: flex; align-items: center; gap: 8px; min-width: 0; }
.oc-footName { min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary, #e6e6e6); font-size: 14px; font-weight: 400; line-height: 20px; white-space: nowrap; text-overflow: ellipsis; }
.oc-footPct { flex: none; width: 34px; margin-left: auto; color: var(--dsw-alias-label-secondary, #a0a0a0); text-align: right; font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
.oc-footPctWarn { color: #d9a24a; }
.oc-footPctBad { color: var(--dsw-alias-state-error-primary, #e07a7a); }
.oc-footRow { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-footHead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.oc-footLabel { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-tertiary, #7a7a7a); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; }
.oc-footAmount { flex: 0 0 auto; max-width: 68%; overflow: hidden; color: var(--dsw-alias-label-secondary, #a0a0a0); text-align: right; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; }
.oc-footBar { display: block; height: 4px; border-radius: var(--dsw-radius-xs, 3px); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.2)); overflow: hidden; }
.oc-footFill { display: block; height: 100%; border-radius: var(--dsw-radius-xs, 3px); background: var(--dsw-alias-brand-primary, #4fbf86); transition: width 0.3s ease; }
.oc-footFillWarn { background: #d9a24a; }
.oc-footFillBad { background: var(--dsw-alias-state-error-primary, #e07a7a); }
.oc-footMessage { color: var(--dsw-alias-label-tertiary, #7a7a7a); font-size: 11px; line-height: 16px; }
.oc-railButton { box-sizing: border-box; flex: none; display: inline-flex; justify-content: center; align-items: center; width: 36px; height: 36px; margin: 0 0 4px; padding: 0; border: 0.5px solid transparent; border-radius: var(--dsw-radius-md, 8px); background: transparent; color: var(--dsw-alias-label-secondary, #a0a0a0); cursor: pointer; }
.oc-railButton:hover { color: var(--dsw-alias-label-primary, #e6e6e6); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12)); }
.oc-railButton:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4fbf86)); outline-offset: -2px; }
.oc-ring { flex: none; display: inline-flex; }
.oc-panel { display: flex; flex-direction: column; gap: 14px; padding: 18px; max-width: 760px; margin: 0 auto; height: 100%; max-height: calc(100vh - 56px); min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.oc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.oc-dock-cost { font-size: 11px; opacity: 0.78; padding: 1px 6px; border-radius: 999px; border: 1px solid rgba(127,127,127,0.25); white-space: nowrap; }
.oc-limits { margin-top: 8px; }
.oc-limits summary { cursor: pointer; font-size: 12px; font-weight: 600; padding: 4px 0; }
.oc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.oc-table th, .oc-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid rgba(127,127,127,0.18); vertical-align: top; }
.oc-table th { font-weight: 600; opacity: 0.8; }
`
