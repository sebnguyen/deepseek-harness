/**
 * Public surface of the frame bridge: the tested glues the ext-host entry and
 * any outer tooling consume. The activation entry stays out of this index —
 * it boots only inside the twin's extension host.
 */
export * from './bridge.ts'
export * from './gutter.ts'
export * from './notes.ts'
export * from './theme.ts'
export * from './timeline.ts'
