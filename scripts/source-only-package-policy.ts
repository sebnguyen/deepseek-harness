/** Directory roots retained for development without root builds or publication. */
export const SOURCE_ONLY_PACKAGE_DIRECTORY_ROOTS = [
  'packages/coral',
  'packages/client/ui-orchestration',
] as const

/**
 * Whether a repository-relative package directory belongs to the source-only set.
 * @param directory - Repository-relative package directory using POSIX separators.
 * @returns Whether root builds and publication paths exclude the package.
 */
export function isSourceOnlyPackageDirectory(directory: string): boolean {
  return SOURCE_ONLY_PACKAGE_DIRECTORY_ROOTS.some(root => directory === root || directory.startsWith(`${root}/`))
}
