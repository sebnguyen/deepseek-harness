/**
 * vscode-modules: the vscode web client's composition registry. Its host
 * face owns the Service writing each spawn's manifest; its vscode face is
 * the resolver the seat feeds to `loader.internal` — both reading the same
 * declared rows from its manifest.
 * @module @deepseek-ai/dsh-vscode-modules
 */
export * from './manifest.ts'
export * from './registry.ts'
export * from './vscode/index.ts'
