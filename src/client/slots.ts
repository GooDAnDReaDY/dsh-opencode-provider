/**
 * SlotMap merges for the two seats this plugin occupies besides
 * `settings.section` (declared by dsh-client-ui-settings):
 *
 * - `main` — the layout's keyed center-column panel.
 * - `sidebar.footer.action` — the list rendered directly above Settings.
 *
 * Neither package is a dependency of this bundle, so the declarations are
 * restated structurally. They must stay compatible with upstream's specs; a
 * drift is a compile error at the register site.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'main': { kind: 'keyed'; scope: 'root' }
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: { wide?: boolean } }
    'conversation.composer.dock': { kind: 'list'; scope: 'session' }
    'settings.models.provider-card': { kind: 'keyed'; scope: 'root' }
  }
}

export {}
