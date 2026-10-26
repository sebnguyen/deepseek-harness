// The pixel-mark derivation pipeline, shared by pixel-do-loader-gen.mjs and
// pixel-logo-pipeline-check.mjs: the original product logo vector path
// (website/public/favicon.svg) is flattened to polylines, rasterized as
// supersampled even-odd coverage, and each N-by-N window is sampled (coverage
// mean >= threshold, or a single centre pixel = the nearest-neighbour
// no-anti-alias downsample reading) into kept [col,row] cells.

/** Position-based SVG path reader; arc flags are single chars and may touch numbers. */
export function makeReader(src) {
  let i = 0
  const skip = () => { while (i < src.length && /[\s,]/.test(src[i])) i += 1 }
  return {
    number() {
      skip()
      const re = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/y
      re.lastIndex = i
      const m = re.exec(src)
      if (!m) throw new Error('number expected at ' + src.slice(i, i + 12))
      i = re.lastIndex
      return Number(m[0])
    },
    flag() { skip(); const f = src[i] === '1' ? 1 : 0; i += 1; return f },
    command() { skip(); const c = src[i]; if (c === undefined || !/[A-Za-z]/.test(c)) return null; i += 1; return c },
    peekNumber() { skip(); return i < src.length && /[-.0-9]/.test(src[i]) },
  }
}

/** Endpoint->centre arc parameterisation sliced at 90 degrees, one cubic per slice. */
export function arcCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  const rad = (phi * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy
  rx = Math.abs(rx) || 1e-6; ry = Math.abs(ry) || 1e-6
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p))
  const coef = (fa === fs ? -1 : 1) * Math.sqrt(num)
  const cxp = coef * (rx * y1p) / ry, cyp = coef * -(ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dtheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!fs && dtheta > 0) dtheta -= 2 * Math.PI
  if (fs && dtheta < 0) dtheta += 2 * Math.PI
  const slices = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)))
  const delta = dtheta / slices
  const pt = (a) => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos]
  const dv = (a) => [-rx * Math.sin(a), ry * Math.cos(a)]
  const cubics = []
  for (let s = 0; s < slices; s++) {
    const a1 = theta1 + s * delta, a2 = theta1 + (s + 1) * delta
    const t = (4 / 3) * Math.tan((a2 - a1) / 4)
    const [q1x, q1y] = pt(a1); const [d1x, d1y] = dv(a1)
    const [q2x, q2y] = pt(a2); const [d2x, d2y] = dv(a2)
    cubics.push([q1x + t * (d1x * cos - d1y * sin), q1y + t * (d1x * sin + d1y * cos),
      q2x - t * (d2x * cos - d2y * sin), q2y - t * (d2x * sin + d2y * cos), q2x, q2y])
  }
  return cubics
}

/** Flatten an SVG path string (M/L/H/V/C/S/Q/T/A/Z, abs+rel) into closed polylines over the 24x24 viewBox. */
export function flattenPath(src) {
  const rd = makeReader(src)
  const polys = []
  let seg = []
  let x = 0, y = 0, sx = 0, sy = 0
  let prev = ''
  let cubicCtrl = [0, 0]
  let quadCtrl = [0, 0]
  const push = (nx, ny) => { seg.push([nx, ny]); x = nx; y = ny }
  const cubicTo = (bx, by, c1x, c1y, c2x, c2y, ex, ey) => {
    for (let s = 1; s <= 24; s++) {
      const t = s / 24, u = 1 - t
      push(
        u * u * u * bx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
        u * u * u * by + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
      )
    }
  }
  const quadTo = (bx, by, cx, cy, ex, ey) => {
    for (let s = 1; s <= 24; s++) {
      const t = s / 24, u = 1 - t
      push(u * u * bx + 2 * u * t * cx + t * t * ex, u * u * by + 2 * u * t * cy + t * t * ey)
    }
  }
  const close = () => { if (seg.length) { push(sx, sy); polys.push(seg); seg = [] } }
  let cmd = rd.command()
  while (cmd !== null) {
    const thisCmd = cmd
    switch (cmd) {
      case 'M': close(); sx = rd.number(); sy = rd.number(); seg = [[sx, sy]]; x = sx; y = sy; cmd = 'L'; break
      case 'm': close(); sx = x + rd.number(); sy = y + rd.number(); seg = [[sx, sy]]; x = sx; y = sy; cmd = 'l'; break
      case 'L': push(rd.number(), rd.number()); break
      case 'l': push(x + rd.number(), y + rd.number()); break
      case 'H': push(rd.number(), y); break
      case 'h': push(x + rd.number(), y); break
      case 'V': push(x, rd.number()); break
      case 'v': push(x, y + rd.number()); break
      case 'c': {
        const a = [rd.number(), rd.number(), rd.number(), rd.number(), rd.number(), rd.number()]
        const c2 = [x + a[2], y + a[3]]
        cubicTo(x, y, x + a[0], y + a[1], c2[0], c2[1], x + a[4], y + a[5])
        cubicCtrl = c2
        break
      }
      case 'C': {
        const a = [rd.number(), rd.number(), rd.number(), rd.number(), rd.number(), rd.number()]
        cubicTo(x, y, a[0], a[1], a[2], a[3], a[4], a[5])
        cubicCtrl = [a[2], a[3]]
        break
      }
      case 's': {
        const a = [rd.number(), rd.number(), rd.number(), rd.number()]
        const c1 = ['C', 'c', 'S', 's'].includes(prev) ? [2 * x - cubicCtrl[0], 2 * y - cubicCtrl[1]] : [x, y]
        const c2 = [x + a[0], y + a[1]]
        cubicTo(x, y, c1[0], c1[1], c2[0], c2[1], x + a[2], y + a[3])
        cubicCtrl = c2
        break
      }
      case 'S': {
        const a = [rd.number(), rd.number(), rd.number(), rd.number()]
        const c1 = ['C', 'c', 'S', 's'].includes(prev) ? [2 * x - cubicCtrl[0], 2 * y - cubicCtrl[1]] : [x, y]
        cubicTo(x, y, c1[0], c1[1], a[0], a[1], a[2], a[3])
        cubicCtrl = [a[0], a[1]]
        break
      }
      case 'q': {
        const a = [rd.number(), rd.number(), rd.number(), rd.number()]
        const c = [x + a[0], y + a[1]]
        quadTo(x, y, c[0], c[1], x + a[2], y + a[3])
        quadCtrl = c
        break
      }
      case 'Q': {
        const a = [rd.number(), rd.number(), rd.number(), rd.number()]
        quadTo(x, y, a[0], a[1], a[2], a[3])
        quadCtrl = [a[0], a[1]]
        break
      }
      case 't': {
        const ex = rd.number(), ey = rd.number()
        const c = ['Q', 'q', 'T', 't'].includes(prev) ? [2 * x - quadCtrl[0], 2 * y - quadCtrl[1]] : [x, y]
        quadTo(x, y, c[0], c[1], x + ex, y + ey)
        quadCtrl = c
        break
      }
      case 'T': {
        const ex = rd.number(), ey = rd.number()
        const c = ['Q', 'q', 'T', 't'].includes(prev) ? [2 * x - quadCtrl[0], 2 * y - quadCtrl[1]] : [x, y]
        quadTo(x, y, c[0], c[1], ex, ey)
        quadCtrl = c
        break
      }
      case 'A': case 'a': {
        const arx = rd.number(), ary = rd.number(), rot = rd.number(), fa = rd.flag(), fs = rd.flag()
        let ex = rd.number(), ey = rd.number()
        if (cmd === 'a') { ex += x; ey += y }
        for (const c of arcCubics(x, y, arx, ary, rot, fa, fs, ex, ey)) cubicTo(x, y, c[0], c[1], c[2], c[3], c[4], c[5])
        break
      }
      case 'Z': case 'z': close(); x = sx; y = sy; break
      default: throw new Error('unsupported path command ' + cmd)
    }
    prev = thisCmd
    // implicit repetition: a bare number keeps the current command going
    if (rd.peekNumber()) {
      if (cmd === 'M') cmd = 'L'
      else if (cmd === 'm') cmd = 'l'
      continue
    }
    cmd = rd.command()
  }
  close()
  return polys
}

/** Supersampled even-odd raycast raster: per-supersample alpha over the 24x24 viewBox. */
export function rasterCoverage(polys, S) {
  const alpha = new Float64Array(S * S)
  for (let row = 0; row < S; row++) {
    const py = (row + 0.5) * 24 / S
    for (let col = 0; col < S; col++) {
      const px = (col + 0.5) * 24 / S
      let inside = false
      for (const poly of polys) {
        for (let e = 0; e < poly.length - 1; e++) {
          const [x1, y1] = poly[e]
          const [x2, y2] = poly[e + 1]
          if ((y1 > py) === (y2 > py)) continue
          const xint = x1 + ((py - y1) / (y2 - y1)) * (x2 - x1)
          if (xint > px) inside = !inside
        }
      }
      if (inside) alpha[row * S + col] = 1
    }
  }
  return alpha
}

/** Keep an N-by-N cell when the window's mean alpha crosses thr (the x-by-x window sample). */
export function coverageCells(alpha, S, N, thr) {
  const cells = []
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const x0 = Math.floor(c * S / N), x1 = Math.floor((c + 1) * S / N)
    const y0 = Math.floor(r * S / N), y1 = Math.floor((r + 1) * S / N)
    let sum = 0
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += alpha[yy * S + xx]
    if (sum / ((x1 - x0) * (y1 - y0)) >= thr) cells.push([c, r])
  }
  return cells
}

/** Keep an N-by-N cell when the single centre supersample crosses thr (the nearest-neighbour reading). */
export function nearestCells(alpha, S, N, thr) {
  const cells = []
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const xx = Math.floor((c + 0.5) * S / N), yy = Math.floor((r + 0.5) * S / N)
    if (alpha[yy * S + xx] >= thr) cells.push([c, r])
  }
  return cells
}

/** Derive the kept cells of one N-by-N grid straight from the logo path. */
export function deriveCells(pathD, N, thr = 0.5) {
  const S = N * 16
  return coverageCells(rasterCoverage(flattenPath(pathD), S), S, N, thr)
}
