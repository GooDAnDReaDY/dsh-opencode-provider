import type { Context } from '@deepseek-ai/cordis'
// Type-only: client-service augmentations (`slots`, `locale`) and the
// `settings.section` SlotMap entry.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: SlotMap merges for `main` and `sidebar.footer.action`.
import type {} from './slots.ts'

import { dictionaries, NS } from './locales.ts'
import { QuotaCard, QuotaPanel } from './quota-card.tsx'
import { OpenCodeSettingsPage } from './settings-page.tsx'
import { CSS, CSS_ID } from './styles.ts'

interface LayoutSeam {
  selectPanel(id: string | null): void
}

interface LooseSlots {
  inject(name: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

function injectCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`style[data-dsh-plugin="${CSS_ID}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.dshPlugin = 'dsh-opencode-provider'
  tag.dataset.pluginCss = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}

export const inject = ['slots', 'locale']

/**
 * Browser half: the OpenCode settings section, a quota card at the bottom of
 * the sidebar, and the center panel it opens.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, 'en', dictionaries.en), 'dsh-opencode-provider: en copy')
  ctx.effect(() => ctx.locale.register(NS, 'zh', dictionaries.zh), 'dsh-opencode-provider: zh copy')
  ctx.effect(() => injectCss(), 'dsh-opencode-provider: styles')

  const t = ctx.locale.bind(NS)
  const slots = ctx.slots as unknown as LooseSlots

  ctx.slots.inject('settings.section', () => slots.register({
    name: 'settings.section',
    id: 'opencode',
    order: 20,
    label: () => t('nav'),
    locale: NS,
  }, OpenCodeSettingsPage))

  // The center-column panel the sidebar card opens. `main` is declared by
  // dsh-client-ui-layout; when that slot is absent this inject never fires.
  ctx.slots.inject('main', () => slots.register({
    name: 'main',
    key: 'opencode-panel',
    locale: NS,
    inject: () => ({
      close: () => (ctx.get('layout') as LayoutSeam | undefined)?.selectPanel(null),
    }),
  }, QuotaPanel))

  // The card sits directly above the Settings seat. It is gated on the
  // `layout` service because opening the panel is its only action.
  ctx.inject(['layout'], (layoutCtx) => {
    const layoutSlots = layoutCtx.slots as unknown as LooseSlots
    layoutCtx.slots.inject('sidebar.footer.action', () => layoutSlots.register({
      name: 'sidebar.footer.action',
      id: 'opencode-quota',
      order: 1,
      locale: NS,
      inject: () => ({
        open: () => (ctx.get('layout') as LayoutSeam | undefined)?.selectPanel('opencode-panel'),
      }),
    }, QuotaCard))
  })

}
