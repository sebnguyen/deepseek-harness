/**
 * Shape of the IDE lane: the manifest row, the resolved twin, the readiness
 * snapshot, the spawn seam, the event uplink, and the artifact errors every
 * refusal rides.
 */

/** One platform's twin pair digests as recorded in the manifest row. */
export interface IdePlatformTwin {
  /** sha256 of the produced REH server artifact. */
  readonly serverSha256: string
  /** sha256 of the produced `vscode-web` client twin. */
  readonly clientSha256: string
}

/**
 * The pinned row in the build-local manifest: the upstream commit the twins were
 * built from, its canonical remote, and one digest pair per platform the lane has
 * produced. The repository carries this row and the overlay, never the payload.
 */
export interface IdeManifestRow {
  /** Full microsoft/vscode commit sha the twins were built from. */
  readonly upstreamSha: string
  /** Canonical upstream remote the build lane fetches the pin from. */
  readonly upstreamUrl: string
  /** Recorded digests per platform key such as `linux-x64`. */
  readonly twins: Readonly<Record<string, IdePlatformTwin>>
}

/** A twin whose digests agreed with the manifest, ready to spawn. */
export interface ResolvedTwin {
  /** Absolute path of the REH server entry. */
  readonly serverPath: string
  /** Absolute path of the `vscode-web` client directory. */
  readonly clientPath: string
  /** The platform key whose digests matched, or the override's label. */
  readonly platform: string
}

/** The readiness observable the `ui-vscode` tab kind's `canOpen` reads. */
export interface IdeStatus {
  /** True once the bridge's hello has crossed the gateway. */
  readonly ready: boolean
  /** The upstream sha of the twin in play, when one is. */
  readonly twinSha: string | undefined
  /** Why the frame is absent, when it is. */
  readonly reason: 'no-twin' | 'spawning' | 'disposed' | undefined
  /** Loopback iframe url with the launch token, once the child reports its port. */
  readonly frameUrl: string | undefined
}

/** One bridge event-uplink record, the projection the outer chrome mirrors. */
export interface IdeReport {
  /** Which surface the frame observed. */
  readonly kind: 'save' | 'activeEditor' | 'diagnostics'
  /** The addressed workspace file, when the event names one. */
  readonly path: string | undefined
  /** Free-form detail carrying the payload the kind implies. */
  readonly detail: string | undefined
}

/** Spawn handle the controller needs from `ctx.subprocess`. */
export interface IdeChildLike {
  /** Settles with the exit code once the REH child is gone. */
  readonly exited: Promise<number | null>
  /** The loopback port the REH picked for `--port 0`, once it reports one. */
  readonly port?: Promise<number>
  /** Ask the child to stop; resolves once it is gone. */
  kill(): Promise<void>
}

/** The `ctx.subprocess` seam narrowed to what the frame spawn needs. */
export interface IdeSpawnLike {
  spawn(options: {
    readonly command: string
    readonly args: readonly string[]
    readonly env: Readonly<Record<string, string>>
  }): IdeChildLike
}

/** Inputs the controller composes from; tests and the Host supply them differently. */
export interface IdeControllerDependencies {
  /** Reads and validates the manifest row; refusals ride their named error. */
  loadRow(): Promise<IdeManifestRow>
  /** Spawn environment, read for the twin override and noverify latch only. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Artifact cache root the lane writes. */
  readonly cacheDir: string
  /** The Host's managed child-process seam; absent means never spawn. */
  readonly subprocess?: IdeSpawnLike | undefined
}

/** Named refusal for every manifest and artifact failure. */
export class IdeArtifactError extends Error {
  constructor(
    readonly code: 'ide/manifest-invalid' | 'ide/twin-incomplete' | 'ide/twin-unrecorded' | 'ide/sha-mismatch',
    message: string,
  ) {
    super(message)
    this.name = 'IdeArtifactError'
  }
}
