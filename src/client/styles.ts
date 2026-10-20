export const CSS_ID = 'dsh-opencode-provider'

export const CSS = `
:where(.oc-page, .oc-panel, .oc-card, .oc-foot, .oc-railButton) {
  --oc-border: var(--dsw-alias-border-l3, rgba(127,127,127,0.25));
  --oc-border-strong: var(--dsw-alias-border-l3, rgba(127,127,127,0.35));
  --oc-border-soft: var(--dsw-alias-border-l3, rgba(127,127,127,0.18));
  --oc-fill: var(--dsw-alias-settings-card-fill, rgba(127,127,127,0.06));
  --oc-fill-soft: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08));
  --oc-fill-hover: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12));
  --oc-text: var(--dsw-alias-label-primary, #e6e6e6);
  --oc-text-secondary: var(--dsw-alias-label-secondary, #a0a0a0);
  --oc-text-tertiary: var(--dsw-alias-label-tertiary, #7a7a7a);
  --oc-accent: var(--dsw-alias-state-business-primary, #508cff);
  --oc-accent-soft: color-mix(in srgb, var(--oc-accent) 16%, transparent);
  --oc-accent-border: color-mix(in srgb, var(--oc-accent) 55%, transparent);
  --oc-success: var(--dsw-alias-state-success-primary, #4fbf86);
  --oc-success-border: color-mix(in srgb, var(--oc-success) 50%, transparent);
  --oc-warning: var(--dsw-alias-state-warning-primary, #d9a24a);
  --oc-warning-border: color-mix(in srgb, var(--oc-warning) 50%, transparent);
  --oc-danger: var(--dsw-alias-state-error-primary, #e07a7a);
  --oc-danger-soft: color-mix(in srgb, var(--oc-danger) 12%, transparent);
  --oc-danger-border: color-mix(in srgb, var(--oc-danger) 35%, transparent);
  --oc-focus: var(--dsw-focus-ring-color, var(--oc-accent));
}
.oc-page { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 24px; color: inherit; }
.oc-head { display: flex; flex-direction: column; gap: 4px; }
.oc-title { font-size: 18px; font-weight: 650; margin: 0; }
.oc-hint { font-size: 12px; opacity: 0.72; line-height: 1.5; margin: 0; }
.oc-card { border: 1px solid var(--oc-border); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; background: var(--oc-fill); }
.oc-card-title { font-size: 13px; font-weight: 650; margin: 0; display: flex; align-items: center; gap: 8px; }
.oc-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.oc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.oc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-label { font-size: 12px; font-weight: 550; opacity: 0.86; }
.oc-input, .oc-select { font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 7px; border: 1px solid var(--oc-border-strong); background: var(--oc-fill-soft); color: inherit; min-width: 0; }
.oc-input:focus, .oc-select:focus { outline: 2px solid var(--oc-focus); outline-offset: 1px; }
.oc-button { font: inherit; font-size: 13px; padding: 6px 11px; border-radius: 7px; border: 1px solid var(--oc-border-strong); background: var(--oc-fill-hover); color: inherit; cursor: pointer; }
.oc-button:hover:not(:disabled) { background: var(--oc-fill-hover); }
.oc-button:disabled { opacity: 0.5; cursor: default; }
.oc-button-primary { border-color: var(--oc-accent-border); background: var(--oc-accent-soft); }
.oc-button-danger { border-color: var(--oc-danger-border); color: var(--oc-danger); }
.oc-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--oc-border-strong); background: var(--oc-fill-hover); }
.oc-badge-ok { border-color: var(--oc-success-border); color: var(--oc-success); }
.oc-badge-warn { border-color: var(--oc-warning-border); color: var(--oc-warning); }
.oc-badge-bad { border-color: var(--oc-danger-border); color: var(--oc-danger); }
.oc-heat-wrap { display: flex; flex-direction: column; gap: 8px; }
.oc-analytics-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.oc-tabs { display: flex; gap: 4px; }
.oc-tab { border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--oc-text-secondary); padding: 4px 11px; font: inherit; font-size: 12px; cursor: pointer; }
.oc-tab:hover { background: var(--oc-fill-hover); color: var(--oc-text); }
.oc-tab-active { border-color: var(--oc-border); background: var(--oc-fill-soft); color: var(--oc-text); }
.oc-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.oc-kpi { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 10px 12px; border: 1px solid var(--oc-border); border-radius: var(--dsw-radius-md, 8px); background: var(--oc-fill); }
.oc-kpi-value { overflow: hidden; color: var(--oc-text); font-size: 18px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.oc-kpi-label { color: var(--oc-text-tertiary); font-size: 11px; line-height: 16px; }
.oc-table-scroll { overflow-x: auto; }
@media (max-width: 720px) { .oc-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.oc-heat-scroll { overflow-x: auto; padding-bottom: 4px; }
.oc-heat { display: grid; grid-template-columns: 32px repeat(24, minmax(12px, 1fr)); gap: 2px; align-items: center; min-width: 600px; }
.oc-heat-hour { font-size: 9px; color: var(--oc-text-tertiary); text-align: center; }
.oc-heat-day { font-size: 10px; color: var(--oc-text-secondary); }
.oc-heat-cell { height: 14px; border-radius: 3px; }
.oc-heat-legend { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--oc-text-tertiary); }
.oc-heat-swatch { width: 12px; height: 12px; border-radius: 2px; }
.oc-hour-strip-head { margin: 10px 0 0; font-size: 10px; color: var(--oc-text-tertiary); }
.oc-hour-strip { display: grid; grid-template-columns: 32px repeat(24, minmax(12px, 1fr)); gap: 2px; align-items: end; height: 30px; min-width: 600px; }
.oc-hour-col { display: flex; align-items: flex-end; height: 100%; }
.oc-hour-bar { display: block; width: 100%; min-height: 2px; border-radius: 2px 2px 0 0; }
.oc-hour-labels { display: grid; grid-template-columns: 32px repeat(24, minmax(12px, 1fr)); gap: 2px; font-size: 9px; color: var(--oc-text-tertiary); text-align: center; min-width: 600px; }
.oc-bars { display: flex; flex-direction: column; gap: 8px; }
.oc-bar-row { display: grid; grid-template-columns: 72px 1fr auto; gap: 10px; align-items: center; font-size: 12px; }
.oc-bar { height: 8px; border-radius: 999px; background: var(--oc-fill-hover); overflow: hidden; }
.oc-bar-fill { height: 100%; border-radius: 999px; background: currentColor; opacity: 0.65; }
.oc-bar-fill-warn { background: var(--oc-warning); opacity: 1; }
.oc-bar-fill-bad { background: var(--oc-danger); opacity: 1; }
.oc-models { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow: auto; padding-right: 4px; }
.oc-model { display: grid; grid-template-columns: 22px minmax(0,1fr) 120px; gap: 8px; align-items: center; font-size: 12px; padding: 3px 0; }
.oc-model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-model-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; color: var(--oc-text-secondary); font-size: 11px; }
.oc-model-legend > span { display: inline-flex; align-items: center; gap: 5px; }
.oc-model-section { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--oc-border-soft); }
.oc-model-section:first-child { border-top: 0; padding-top: 0; }
.oc-model-section-head { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; font-weight: 650; }
.oc-model-section-head .oc-badge { padding: 0 6px; font-size: 10px; }
.oc-model-section .oc-hint { margin: 0 0 4px; }
.oc-account { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) auto; gap: 8px; align-items: center; }
.oc-account-block { display: flex; flex-direction: column; gap: 6px; padding: 9px; border: 1px solid var(--oc-border-soft); border-radius: 8px; background: var(--oc-fill); }
.oc-notice { font-size: 12px; padding: 7px 10px; border-radius: 7px; background: var(--oc-accent-soft); border: 1px solid var(--oc-accent-border); }
.oc-error { font-size: 12px; padding: 7px 10px; border-radius: 7px; background: var(--oc-danger-soft); border: 1px solid var(--oc-danger-border); color: var(--oc-danger); }
[class*="_footerActions"]:has(.oc-foot), [class*="_footerActions"]:has(.oc-railButton) { flex-direction: column; }
.oc-foot { box-sizing: border-box; flex: 1 1 auto; width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 6px; margin: 0 0 4px; padding: 8px; border: 0.5px solid transparent; border-radius: var(--dsw-radius-md, 8px); background: transparent; color: var(--oc-text-secondary); font: inherit; text-align: left; cursor: pointer; }
.oc-foot:hover { color: var(--oc-text); background: var(--oc-fill-hover); border-color: var(--oc-border); }
.oc-foot:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--oc-focus); outline-offset: -2px; }
.oc-footTop { display: flex; align-items: center; gap: 8px; min-width: 0; }
.oc-footName { min-width: 0; overflow: hidden; color: var(--oc-text); font-size: 14px; font-weight: 400; line-height: 20px; white-space: nowrap; text-overflow: ellipsis; }
.oc-footPct { flex: none; width: 34px; margin-left: auto; color: var(--oc-text-secondary); text-align: right; font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
.oc-footPctWarn { color: var(--oc-warning); }
.oc-footPctBad { color: var(--oc-danger); }
.oc-footRow { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.oc-footHead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.oc-footLabel { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--oc-text-tertiary); text-overflow: ellipsis; white-space: nowrap; font-size: 12px; line-height: 16px; }
.oc-footAmount { flex: 0 0 auto; max-width: 68%; overflow: hidden; color: var(--oc-text-secondary); text-align: right; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; }
.oc-footBar { display: block; height: 4px; border-radius: var(--dsw-radius-xs, 3px); background: var(--oc-fill-hover); overflow: hidden; }
.oc-footFill { display: block; height: 100%; border-radius: var(--dsw-radius-xs, 3px); background: var(--oc-success); transition: width 0.3s ease; }
.oc-footFillWarn { background: var(--oc-warning); }
.oc-footFillBad { background: var(--oc-danger); }
.oc-footMessage { color: var(--oc-text-tertiary); font-size: 11px; line-height: 16px; }
.oc-railButton { box-sizing: border-box; flex: none; display: inline-flex; justify-content: center; align-items: center; width: 36px; height: 36px; margin: 0 0 4px; padding: 0; border: 0.5px solid transparent; border-radius: var(--dsw-radius-md, 8px); background: transparent; color: var(--oc-text-secondary); cursor: pointer; }
.oc-railButton:hover { color: var(--oc-text); background: var(--oc-fill-hover); }
.oc-railButton:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--oc-focus); outline-offset: -2px; }
.oc-ring { flex: none; display: inline-flex; }
.oc-panel { display: flex; flex-direction: column; gap: 14px; padding: 18px; max-width: 760px; margin: 0 auto; height: 100%; max-height: calc(100vh - 56px); min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.oc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.oc-limits { margin-top: 8px; }
.oc-limits summary { cursor: pointer; font-size: 12px; font-weight: 600; padding: 4px 0; }
.oc-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.oc-table th, .oc-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--oc-border-soft); vertical-align: top; }
.oc-table th { font-weight: 600; opacity: 0.8; }
`
