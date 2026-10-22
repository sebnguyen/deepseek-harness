// Ocean scene — the ambient background layer of the app frame, painted
// behind the floating cards: the sea gradient, the depth-attenuation fades
// and the readability veil are static CSS, and the dot lattice is one tiled
// sheet that never repaints. The animated band (the layered WebGL2 engine and
// its DOM ray compositor) is switched off everywhere: it re-damaged a
// full-viewport canvas on every frame, which measured ~27 ms per screen
// megapixel on software-composited displays (WSL, remote desktop, VMs) and
// made large work screens unusable on the same page a GPU-composited laptop
// absorbed at 60 fps.

import css from './OceanScene.module.css'

/** The veil class-combination without a clsx-style join helper (ui-layout
   has no utility dependency: dense layers the deep variant over the base
   veil). */
function veilClass(css: Record<string, string>, dense: boolean): string {
  return dense ? `${css['veil']} ${css['veilDense']}` : (css['veil'] ?? '')
}

/** Props for the ocean scene background layer. */
export interface OceanSceneProps {
  /** Denser readability veil; the transcript phase uses it, the hero does not. */
  dense: boolean
}

/** Ambient ocean scene: a static dot lattice over the sea gradient.
 * @param props — veil density, see {@link OceanSceneProps}.
 */
export function OceanScene(props: OceanSceneProps) {
  return (
    <div className={css.scene} aria-hidden="true">
      <div className={css.gs}>
        <div className={css.glayerA} />
      </div>
      <div className={css.fades} />
      <div className={veilClass(css, props.dense)} />
    </div>
  )
}
