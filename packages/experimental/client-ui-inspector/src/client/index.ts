/** Browser registration for the experimental Cordis Context/Fiber sidebar tab. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-experimental-inspector/client'
import {
  CordisTreeFooterButton,
  CordisTreePanel,
  type CordisTreeFooterInjected,
  type CordisTreePanelInjected,
} from './CordisTreePanel.tsx'
import { en, NS, zh } from './locales.ts'
import { createInspectorTreeSource } from './tree-source.ts'
import { createServicePreview } from './service-preview.ts'

const PANEL_ID = 'cordis-inspector'
const POLL_INTERVAL_MS = 1_000

/** Services used by the global panel and its snapshot source. */
export const inject = ['inspector', 'slots', 'locale', 'layout']

/** Mount the Inspector's read-only global sidebar panel. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-inspector: dictionaries')

  const inspection = createInspectorTreeSource(() => ctx.inspector.cordis.getTree(), POLL_INTERVAL_MS)
  ctx.effect(() => () => { inspection.dispose() }, 'client-ui-inspector: polling')
  const preview = createServicePreview(query => ctx.inspector.cordis.getService(query))
  ctx.effect(() => () => { preview.dispose() }, 'client-ui-inspector: preview')
  const face = (): CordisTreePanelInjected => ({
    hooks: { inspection, preview },
    onRefresh: () => { inspection.refresh() },
    onSelectService: (selection) => { preview.select(selection) },
    onClosePreview: () => { preview.clear() },
  })

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: face,
  }, CordisTreePanel))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: PANEL_ID,
    order: 20,
    locale: NS,
    inject: (): CordisTreeFooterInjected => ({
      open: () => { ctx.layout.selectPanel(PANEL_ID as MainPanelId) },
    }),
  }, CordisTreeFooterButton))
}
