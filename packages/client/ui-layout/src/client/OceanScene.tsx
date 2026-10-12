// Ocean scene — the ambient background layer of the app frame, painted
// behind the floating cards. The god-ray fan, sun halo cluster and dot grid
// render through a layered WebGL2 engine (ocean-shader.ts): sea + instanced
// lights into one quarter-res FBO, one blit, and a device-px dot lattice on
// top — four draw calls per frame, no per-frame buffer uploads — so the whole
// field composites as one GPU texture; when no GL context is available the
// component falls back to the procedural DOM compositor below: god-ray fan
// hinged on a single calculated sun over the frame center, a dot grid, and a
// shine scalar that climbs while the current session's engine is running
// (sessions list's running flag).

import { useEffect, useRef } from 'react'
import css from './OceanScene.module.css'
import { makeRng, mountOceanShader } from './ocean-shader.ts'
import type { OceanShaderHandle } from './ocean-shader.ts'

/** The veil class-combination without a clsx-style join helper (ui-layout
   has no utility dependency: dense layers the deep variant over the base
   veil). */
function veilClass(css: Record<string, string>, dense: boolean): string {
  return dense ? `${css['veil']} ${css['veilDense']}` : (css['veil'] ?? '')
}

/** Props for the ocean scene background layer. */
export interface OceanSceneProps {
  /** Engine state from the session store: climbs the scene's shine cap. */
  running: boolean
  /** Denser readability veil; the transcript phase uses it, the hero does not. */
  dense: boolean
}

/** Ambient ocean scene, generated once per conversation mount.
 * @param props — engine state and veil density, see {@link OceanSceneProps}.
 */
export function OceanScene(props: OceanSceneProps) {
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const raysHostRef = useRef<HTMLDivElement | null>(null)
  const boostHostRef = useRef<HTMLDivElement | null>(null)
  const gridspaceRef = useRef<HTMLDivElement | null>(null)
  const reducedRef = useRef(false)
  const runningRef = useRef(props.running)
  const shaderRef = useRef<OceanShaderHandle | null>(null)
  useEffect(() => {
    runningRef.current = props.running
    shaderRef.current?.setRunning(props.running)
    /* Reduced-motion sessions skip the shine loop; the boost layer still
       answers the engine state, as a static on/off layer. */
    const host = boostHostRef.current
    if (!reducedRef.current || host === null) return
    host.style.opacity = props.running ? '0.8' : '0'
  }, [props.running])

  useEffect(() => {
    const scene = sceneRef.current
    const host = raysHostRef.current
    if (scene === null || host === null) return

    /* Test DOMs expose no matchMedia; treat them as full-motion. */
    const reduced = typeof window.matchMedia === 'function'
      /* v8 ignore next -- reduced-motion query only reached in real browsers */
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    reducedRef.current = reduced

    /* GL first: one fragment pass replaces the per-frame DOM opacity writes.
       No context (jsdom, blocked software GL) keeps the DOM compositor. */
    const shader = mountOceanShader(canvasRef.current, { reduced: reducedRef.current, running: runningRef.current })
    shaderRef.current = shader
    if (shader !== null) {
      return () => {
        shaderRef.current = null
        shader.dispose()
      }
    }

    const rand = makeRng()
    const RCOLORS = [
      'var(--dsh-ocean-ray-a)',
      'var(--dsh-ocean-ray-b)',
      'var(--dsh-ocean-ray-c)',
    ]

    /* One sun, but not one point: light leaks through a soft source
       region high overhead — every shaft hinges on its own spot inside
       that region, and the halo reads as a cluster, not a lamp. */
    const sunY = -(52 + rand() * 20)
    interface Halo { el: HTMLElement; dxf: number; dyf: number; base: number }
    const halos: Halo[] = []
    const sun = document.createElement('div')
    sun.className = css.suncore ?? ''
    sun.style.top = `${sunY.toFixed(2)}vh`
    host.appendChild(sun)
    halos.push({ el: sun, dxf: 0, dyf: 0, base: 0.45 })
    const SAT_N = 2 + Math.round(rand() * 2)
    for (let i = 0; i < SAT_N; i++) {
      const sat = document.createElement('div')
      sat.className = css.suncore ?? ''
      const size = 90 + rand() * 90
      sat.style.width = `${size.toFixed(0)}px`
      sat.style.height = `${size.toFixed(0)}px`
      sat.style.filter = 'blur(26px)'
      sat.style.left = '0'
      sat.style.top = `${sunY.toFixed(2)}vh`
      host.appendChild(sat)
      halos.push({
        el: sat,
        dxf: (rand() - 0.5) * 0.22,
        dyf: (rand() - 0.5) * 10,
        base: 0.25 + rand() * 0.2,
      })
    }

    /* Few broad shafts, stratified across a ~64° cone with jitter */
    interface Ray { el: HTMLElement; w: number; f: number; ph: number; g: number; boost?: boolean; dxf: number }
    const rays: Ray[] = []
    /* The inferencing punch is an ALPHA stack, not a luminance bloom:
       one extra blue shaft per base ray, whose collective opacity rides the
       shine scalar — color deepens instead of clipping to white. */
    const boostHost = boostHostRef.current
    const RAY_N = typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 900px)').matches ? 5 : 8
    for (let i = 0; i < RAY_N; i++) {
      const el = document.createElement('i')
      el.className = css.ray ?? ''
      const w = 190 + rand() * 300
      /* hand-fan from the middle: hinges stratified across the full frame
         width (with a local jitter), and each shaft's tilt follows its
         offset from center — very slight, ±5° at the far edges, dead
         vertical through the middle */
      const dxf = ((i + 0.5) / RAY_N - 0.5) + (rand() - 0.5) * (1 / RAY_N) * 0.5
      const ang = dxf * 10 + (rand() - 0.5) * 1.5
      const dyf = (rand() - 0.5) * 14
      el.style.top = `${(sunY + dyf).toFixed(2)}vh`
      el.style.width = `${w.toFixed(0)}px`
      el.style.setProperty('--r', `${ang.toFixed(2)}deg`)
      el.style.setProperty('--sw', `${(22 + rand() * 14).toFixed(2)}s`)
      el.style.animationDelay = `${(-rand() * 30).toFixed(2)}s`
      el.style.background =
        'linear-gradient(180deg, '
        + `${RCOLORS[i % 3]} 0%, `
        + `color-mix(in srgb, ${RCOLORS[i % 3]} 55%, transparent) ${(48 + rand() * 8).toFixed(0)}%, `
        + `transparent ${(88 + rand() * 10).toFixed(0)}%)`
      el.style.filter = `blur(${(9 + rand() * 10).toFixed(0)}px)`
      host.appendChild(el)
      if (boostHost !== null) {
        const boost = document.createElement('i')
        boost.className = css.boostRay ?? ''
        boost.style.top = `${(sunY + dyf).toFixed(2)}vh`
        boost.style.marginLeft = `${(-w / 2).toFixed(0)}px`
        boost.style.width = `${w.toFixed(0)}px`
        boost.style.setProperty('--r', `${ang.toFixed(2)}deg`)
        boost.style.setProperty('--sw', `${(22 + rand() * 14).toFixed(2)}s`)
        boost.style.animationDelay = `${(-rand() * 30).toFixed(2)}s`
        boost.style.filter = 'blur(26px)'
        boostHost.appendChild(boost)
        rays.push({
          el: boost,
          w: 0,
          f: 0,
          ph: 0,
          g: 0,
          boost: true,
          dxf,
        })
      }
      rays.push({
        el,
        w,
        f: 0.14 + rand() * 0.3,
        ph: rand() * Math.PI * 2,
        g: (0.8 + rand() * 0.4) * (1 - Math.abs(ang) / 22 * 0.5),
        dxf,
      })
    }

    /* The light source is calculated, not placed: the whole fan hinges on
       the scene column's horizontal center and follows resizes. */
    const positionSun = () => {
      const width = scene.getBoundingClientRect().width
      const cx = width / 2
      for (const h of halos) {
        h.el.style.left = `${(cx + h.dxf * width).toFixed(0)}px`
        if (h.dyf !== 0) h.el.style.top = `${(sunY + h.dyf).toFixed(2)}vh`
      }
      for (const r of rays) {
        const hinge = cx + r.dxf * width
        if (r.boost === true) {
          r.el.style.left = `${hinge.toFixed(0)}px`
        } else {
          r.el.style.left = `${(hinge - r.w / 2).toFixed(0)}px`
        }
      }
    }
    positionSun()
    const observer = new ResizeObserver(positionSun)
    observer.observe(scene)

    /* shine: one eased scalar. The min/max swing is the drama knob:
       idle breathes 0.06→0.50 (rays nearly vanish at trough), inferencing
       swings 0.36→1.0. Dot grid also drifts slowly upward while
       inferencing, with its velocity eased both ways so it never snaps. */
    const floorAt = (s: number) => 0.06 + 0.3 * s
    const capAt = (s: number) => 0.5 + 0.5 * s
    let shine = 0
    /* gridspace: a single static reference grid — no travel, no cycling,
       nothing per-frame; just a resonance floor under the rays' glow */
    const gridspaceHost = gridspaceRef.current
    if (gridspaceHost !== null) {
      const el = document.createElement('div')
      el.className = css.glayerA ?? ''
      el.style.opacity = '0.32'
      gridspaceHost.appendChild(el)
    }
    let raf = 0
    let prev = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000)
      prev = now
      const target = runningRef.current ? 1 : 0
      /* faster attack than release: the swell announces inference, the
         fade-out drifts back to idle */
      shine += (target - shine) * Math.min(1, dt * (target > shine ? 1.4 : 1.1))
      const lo = floorAt(shine)
      const cap = capAt(shine)
      const t = now / 1000
      for (const r of rays) {
        if (r.boost === true) continue
        const wave = 0.5 + 0.5 * Math.sin(t * r.f * Math.PI * 2 + r.ph)
        r.el.style.opacity = ((lo + (cap - lo) * wave) * r.g).toFixed(3)
      }
      host.style.setProperty('--raySat', (1 + 0.2 * shine).toFixed(3))
      if (boostHost !== null) {
        boostHost.style.opacity = (shine * 0.9).toFixed(3)
      }
      for (const h of halos) {
        h.el.style.opacity = (h.base + 0.4 * shine).toFixed(3)
      }
      raf = requestAnimationFrame(frame)
    }
    if (reduced) {
      for (const r of rays) {
        r.el.style.opacity = (0.42 * r.g).toFixed(3)
      }
      for (const h of halos) {
        h.el.style.opacity = h.base.toFixed(3)
      }
    } else {
      raf = requestAnimationFrame(frame)
    }

    return () => {
      observer.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
      host.replaceChildren()
      boostHostRef.current?.replaceChildren()
      gridspaceRef.current?.replaceChildren()
    }
  }, [])

  return (
    <div ref={sceneRef} className={css.scene} aria-hidden="true">
      <canvas ref={canvasRef} className={css.gl} />
      <div ref={raysHostRef} className={css.rays} />
      <div ref={boostHostRef} className={css.boost} />
      <div ref={gridspaceRef} className={css.gs} />
      <div className={css.fades} />
      <div className={veilClass(css, props.dense)} />
    </div>
  )
}
