// Ocean scene WebGL2 renderer — the ambient background behind the floating
// cards. One quarter-res FBO holds the sea gradient, the sun halo cluster,
// the swaying god-ray fan, the boost bell and per-ray hues; a blit brings it
// to the canvas and a device-px dot grid is drawn on top at full res. The
// lights are one instanced draw per frame (4 draw calls, zero per-frame
// buffer uploads), and only a handful of scalar uniforms move. The DOM ray
// stack this replaces rewrote inline opacity on large blurred layers every
// frame and flickered as the compositor re-merged them. Returns null when no
// WebGL2 context or shader compile is available (jsdom, blocked software GL),
// and OceanScene then mounts its DOM compositor fallback.
import * as twgl from 'twgl.js';
/** Deterministic per-mount PRNG so each page paints a stable composition. */
export function makeRng() {
    let seed = (Date.now() % 2147483646) + 1;
    return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
/** Parse the hex/rgb()/rgba() color notations the theme sheet emits for the
 * ocean tokens; computed values in other notations yield null and the
 * renderer keeps its per-theme defaults. @param value — raw CSS color string.
 * @returns channels in 0..1, or null when the notation is unsupported. */
export function parseCssColor(value) {
    const v = value.trim();
    if (v.startsWith('#')) {
        let hex = v.slice(1);
        if (hex.length === 3)
            hex = hex.split('').map(c => c + c).join('');
        if (hex.length !== 6)
            return null;
        const n = Number.parseInt(hex, 16);
        if (Number.isNaN(n))
            return null;
        return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
    }
    const m = /^rgba?\(([^)]+)\)$/u.exec(v);
    if (m === null)
        return null;
    const parts = (m[1] ?? '').split(/[\s,/]+/u).filter(p => p !== '');
    if (parts.length < 3)
        return null;
    const channel = (p) => p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p) / 255;
    const alpha = (p) => p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p);
    const c0 = parts[0] ?? '0';
    const c1 = parts[1] ?? '0';
    const c2 = parts[2] ?? '0';
    const parsed = {
        r: channel(c0),
        g: channel(c1),
        b: channel(c2),
        a: parts.length > 3 ? alpha(parts[3] ?? '1') : 1,
    };
    if ([parsed.r, parsed.g, parsed.b, parsed.a].some(Number.isNaN))
        return null;
    return parsed;
}
/* Render pose, locked after mock tuning: 12 rays on wide canvases (6 under
   900px viewport width), 1.75× shaft width, 0.75× glow, full breathing, 0.6
   edge blur, dome radius 1.0 at 0.1 strength, quarter-res FBO. */
const POSE = {
    raysWide: 12,
    raysNarrow: 6,
    narrowPx: 900,
    widthMul: 1.75,
    glowMul: 0.75,
    breatheMul: 1,
    blurMul: 0.6,
    radScale: 1,
    radStr: 0.1,
    scale: 0.25,
    /* idle darkness: breathing window at shine=0 (DOM scene ran 0.06/0.5) */
    dimLo: 0.06,
    dimCap: 0.4,
};
/* Instance stream: one 16-float record per light, laid out as four vec4s
   (iA hinge/geometry, iB angle/sway/kind, iC breath/gain/palette,
   iE gradient window). One buffer, one divisor attribute, one draw. */
const STRIDE = 16;
const VS_FULL = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FS_SEA = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec3 uSea0; uniform vec3 uSea1; uniform vec3 uSea2;
void main(){
  float t = clamp(1.0 - vUv.y, 0.0, 1.0);
  vec3 col = mix(uSea0, uSea1, smoothstep(0.0, 0.46, t));
  col = mix(col, uSea2, smoothstep(0.46, 1.0, t));
  o = vec4(col, 1.0);
}`;
const FS_GRID = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uRes; uniform float uOn;
uniform vec3 uGrid; uniform float uAlpha; uniform float uPitch;
void main(){
  vec2 px = vUv * uRes;
  vec2 g = mod(px + uPitch * 0.5, uPitch) - uPitch * 0.5;
  float c = (1.0 - smoothstep(0.7, 1.9, length(g))) * uAlpha;
  o = vec4(uGrid * c, c) * uOn;
}`;
const VS_LIGHT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 iA;
layout(location = 2) in vec4 iB;
layout(location = 3) in vec4 iC;
layout(location = 4) in vec4 iE;
uniform float uTime; uniform float uShine; uniform float uAspect; uniform vec2 uRes; uniform float uCssH; uniform float uBreath;
uniform vec3 uRayCol[3]; uniform float uRayA[3];
uniform vec3 uBoostCol; uniform float uBoostA;
uniform vec3 uHaloCol; uniform float uHaloA;
uniform float uVis; uniform float uBlur; uniform float uDimLo; uniform float uDimCap;
out vec2 vUv; out vec3 vColor; out float vAlpha; out float vKind; out float vGradS; out float vGradE; out float vBlurStart; out float vAsp;
void main(){
  float kind = iB.w;
  float lo = uDimLo + (0.43 - uDimLo) * uShine;
  float cap = uDimCap + (1.0 - uDimCap) * uShine;
  float theta = radians(iB.x) + radians(1.4) * sin(uTime * 6.28318 / iB.y + iB.z);
  if (kind > 1.5) theta = 0.0;
  float ct = cos(theta), st = sin(theta);
  float wu = iA.z * 100.0 / uCssH;
  float lu = kind > 1.5 ? iA.w * 100.0 / uCssH : iA.w;
  float lx = (aCorner.x - 0.5) * wu;
  float ly = aCorner.y * lu;
  float X = iA.x * uAspect * 100.0 + lx * ct + ly * st;
  float Y = iA.y + ly * ct - lx * st;
  gl_Position = vec4((X / (100.0 * uAspect)) * 2.0 - 1.0, 1.0 - 2.0 * Y / 100.0, 0.0, 1.0);
  vUv = aCorner;
  int pal = int(iC.w + 0.5);
  vec3 col = uRayCol[0]; float base = uRayA[0];
  if (pal == 1) { col = uRayCol[1]; base = uRayA[1]; }
  else if (pal == 2) { col = uRayCol[2]; base = uRayA[2]; }
  if (kind > 0.5 && kind < 1.5) { col = uBoostCol; base = uBoostA; }
  if (kind > 1.5) { col = uHaloCol; base = uHaloA; }
  vColor = col;
  float wave = 0.5 + 0.5 * sin(uTime * iC.x * 6.28318 + iC.y);
  float amp = (lo + (cap - lo) * wave);
  float mid = (lo + cap) * 0.5;
  amp = mid + (amp - mid) * uBreath;
  vAlpha = uVis * base * (kind < 0.5 ? amp * iC.z
         : kind < 1.5 ? 0.55 * uShine * uShine * iC.z
         : (iC.z + 0.4 * uShine) * (0.7 + 0.3 * uShine));
  vKind = kind;
  vGradS = iE.x;
  vGradE = iE.y;
  vBlurStart = mix(0.95, 0.05, uBlur);
  vAsp = wu / lu;
}`;
const FS_LIGHT = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vColor; in float vAlpha; in float vKind; in float vGradS; in float vGradE; in float vBlurStart; in float vAsp;
uniform float uRadScale; uniform float uRadStr;
out vec4 o;
void main(){
  float m;
  if (vKind < 0.5) {
    float r = length(vec2((vUv.x - 0.5) * vAsp, 1.0 - vUv.y));
    float radial = smoothstep(vGradS * uRadScale, vGradE * uRadScale, r);
    float linear = 1.0 - smoothstep(vGradS, vGradE, vUv.y);
    float tipFade = mix(linear, radial, uRadStr);
    m = (1.0 - smoothstep(vBlurStart, 0.995, abs(vUv.x * 2.0 - 1.0))) * tipFade;
  } else if (vKind < 1.5) {
    float u2 = vUv.x * 2.0 - 1.0;
    m = exp(-u2 * u2 * 5.0)
      * (1.0 - smoothstep(vGradS, vGradE, vUv.y));
  } else {
    m = 1.0 - smoothstep(0.3, 0.78, length(vUv - 0.5) * 2.0);
  }
  float a = clamp(vAlpha * m, 0.0, 1.0);
  o = vec4(vColor * a, a);
}`;
const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
void main(){ o = texture(uTex, vUv); }`;
/** Per-theme fallback palette, mirroring ui-theme's ocean-scene sheet. */
const DEFAULT_PALETTES = {
    light: {
        sea0: '#FFFFFF', sea1: 'rgb(247,248,248)', sea2: 'rgb(243,249,251)',
        rays: ['rgba(0,99,248,.18)', 'rgba(38,145,234,.26)', 'rgba(96,165,175,.16)'],
        boost: 'rgba(0,99,248,.32)', grid: 'rgba(31,97,174,.62)',
    },
    dark: {
        sea0: 'rgb(23,27,29)', sea1: 'rgb(14,18,20)', sea2: 'rgb(7,9,11)',
        rays: ['rgba(38,145,234,.22)', 'rgba(97,200,249,.24)', 'rgba(96,165,175,.22)'],
        boost: 'rgba(97,200,249,.32)', grid: 'rgba(145,159,158,.7)',
    },
};
function parseColorOr(css, fallback) {
    return (css === null ? null : parseCssColor(css)) ?? parseCssColor(fallback) ?? { r: 0, g: 0, b: 0, a: 1 };
}
/** One instance = one light: ray shaft (0), boost bell (1) or halo blob (2). */
function buildInstances(rng, rayCount) {
    const sunY = -(52 + rng() * 20);
    const spec = [];
    for (let i = 0; i < 16; i++) {
        spec.push({
            rj: rng() - 0.5, rAng: rng() - 0.5, rdyf: rng() - 0.5, rw: rng(),
            rg: rng(), rgS: rng(), rgE: rng(), sp: rng(), sph: rng(),
            bf: rng(), bp: rng(),
        });
    }
    const haloSpec = [0, 1, 2, 3].map(() => ({ x: rng(), y: rng(), r: rng(), c: rng() }));
    const count = rayCount + 1 + 4;
    const data = new Float32Array(count * STRIDE);
    let k = 0;
    const push = (xf, cy, w, len, ang, swayP, swayPh, kind, f, ph, gain, pal, gS, gE) => {
        data.set([xf, cy, w, len, ang, swayP, swayPh, kind, f, ph, gain, pal, gS, gE, 0, 0], k);
        k += STRIDE;
    };
    for (let i = 0; i < rayCount; i++) {
        const s = spec[i];
        if (s === undefined)
            continue;
        const dxf = ((i + 0.5) / rayCount - 0.5) + s.rj * (1 / rayCount) * 0.5;
        const ang = dxf * 10 + s.rAng * 1.5;
        const dyf = s.rdyf * 14;
        const w = (190 + s.rw * 300) * POSE.widthMul;
        const g = (0.8 + s.rg * 0.4) * (1 - Math.abs(ang) / 22 * 0.5);
        const gS = (40 + s.rgS * 8) / 100;
        const gE = (62 + s.rgE * 10) / 100;
        const swayP = 22 + s.sp * 14;
        const swayPh = -s.sph * 30;
        push(0.5 + dxf, sunY + dyf, w, 190, ang, swayP, swayPh, 0, 0.14 + s.bf * 0.3, s.bp * 6.28, g, i % 3, gS, gE);
    }
    /* ONE boost instance: a Gaussian bell spanning the fan horizontally,
       shine-gated quadratically so it is invisible at idle. */
    push(0.5, sunY + 8, 4000, 190, 0, 1, 0, 1, 0, 0, 1, 0, 0.3, 0.85);
    haloSpec.forEach((h, j) => {
        const r = j === 0 ? 110 : (90 + h.r * 90) / 2;
        push(j === 0 ? 0.5 : 0.5 + (h.x - 0.5) * 0.22, j === 0 ? sunY : sunY + (h.y - 0.5) * 10, r * 2, r * 2, 0, 1, 0, 2, 0, 0, j === 0 ? 0.45 : 0.25 + h.c * 0.2, 0, 0, 1);
    });
    return data;
}
function resolveTheme(dark, token) {
    const fallback = dark ? DEFAULT_PALETTES.dark : DEFAULT_PALETTES.light;
    const s0 = parseColorOr(token('--dsh-ocean-sea-0'), fallback.sea0);
    const s1 = parseColorOr(token('--dsh-ocean-sea-1'), fallback.sea1);
    const s2 = parseColorOr(token('--dsh-ocean-sea-2'), fallback.sea2);
    const rays = [0, 1, 2].map(ii => parseColorOr(token(`--dsh-ocean-ray-${'abc'[ii] ?? 'a'}`), fallback.rays[ii] ?? '#fff'));
    const boost = parseColorOr(token('--dsh-ocean-boost'), fallback.boost);
    const grid = parseColorOr(token('--dsh-ocean-grid-a'), fallback.grid);
    const rayB = rays[1] ?? rays[0] ?? boost;
    return {
        sea: {
            uSea0: [s0.r, s0.g, s0.b],
            uSea1: [s1.r, s1.g, s1.b],
            uSea2: [s2.r, s2.g, s2.b],
        },
        raysCol: new Float32Array(rays.flatMap(r => [r.r, r.g, r.b])),
        raysA: new Float32Array(rays.map(r => r.a)),
        boostCol: [boost.r, boost.g, boost.b],
        boostA: boost.a,
        haloCol: [rayB.r, rayB.g, rayB.b],
        haloA: rayB.a,
        gridCol: [grid.r, grid.g, grid.b],
        /* DOM dots alpha-scaled 0.42→0.62 per theme via the grid token; .6× keeps
           the dot lattice sub-threshold at full-res over the lit scene. */
        gridA: grid.a * 0.6,
        gridPitch: 32,
        vis: dark ? 2.2 : 3.0,
    };
}
/** Mount the layered ocean scene onto a canvas. @param canvas — the scene's
 * GL layer. @param options — reduced-motion and initial engine state.
 * @returns a live handle, or null when WebGL2 is unavailable. */
export function mountOceanShader(canvas, options) {
    if (canvas === null)
        return null;
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
    });
    if (gl === null)
        return null;
    const makeProgram = (vsSrc, fsSrc) => {
        try {
            return twgl.createProgramInfo(gl, [vsSrc, fsSrc]);
        }
        catch {
            return null;
        }
    };
    const pSea = makeProgram(VS_FULL, FS_SEA);
    const pGrid = makeProgram(VS_FULL, FS_GRID);
    const pLight = makeProgram(VS_LIGHT, FS_LIGHT);
    const pBlit = makeProgram(VS_FULL, FS_BLIT);
    if (pSea === null || pGrid === null || pLight === null || pBlit === null)
        return null;
    const rng = makeRng();
    const rayCount = typeof window !== 'undefined' && window.innerWidth <= POSE.narrowPx ? POSE.raysNarrow : POSE.raysWide;
    const instances = buildInstances(rng, rayCount);
    const instanceCount = instances.length / STRIDE;
    const slot = (lo) => instances.filter((_, idx) => idx % STRIDE >= lo && idx % STRIDE < lo + 4);
    const lightBuf = twgl.createBufferInfoFromArrays(gl, {
        aCorner: { data: [0, 0, 1, 0, 0, 1, 1, 1], numComponents: 2 },
        iA: { numComponents: 4, divisor: 1, data: slot(0) },
        iB: { numComponents: 4, divisor: 1, data: slot(4) },
        iC: { numComponents: 4, divisor: 1, data: slot(8) },
        iE: { numComponents: 4, divisor: 1, data: slot(12) },
    });
    const FBO_OPTS = [{ min: gl.LINEAR, mag: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE }];
    const fbi = twgl.createFramebufferInfo(gl, FBO_OPTS, 2, 2);
    /* Palette from the ui-theme ocean tokens; attribute flips re-resolve so the
       theme switch recolors the renderer the same frame the DOM flips. */
    let theme = resolveTheme(document.body.hasAttribute('data-ds-dark-theme'), () => null);
    const readPalette = () => {
        const cs = typeof getComputedStyle === 'function' ? getComputedStyle(document.body) : null;
        const token = (name) => cs === null ? null : (cs.getPropertyValue(name).trim() || null);
        theme = resolveTheme(document.body.hasAttribute('data-ds-dark-theme'), token);
    };
    readPalette();
    const dprCap = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5);
    const resize = () => {
        const w = Math.max(2, Math.round(canvas.clientWidth * dprCap));
        const h = Math.max(2, Math.round(canvas.clientHeight * dprCap));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        const fw = Math.max(2, Math.round(w * POSE.scale));
        const fh = Math.max(2, Math.round(h * POSE.scale));
        twgl.resizeFramebufferInfo(gl, fbi, FBO_OPTS, fw, fh);
    };
    let running = options.running;
    let shine = options.running ? 1 : 0;
    const drawFrame = (time, breath) => {
        resize();
        const aspect = fbi.width / fbi.height;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbi.framebuffer);
        gl.viewport(0, 0, fbi.width, fbi.height);
        gl.disable(gl.BLEND);
        gl.useProgram(pSea.program);
        twgl.setUniforms(pSea, theme.sea);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(pLight.program);
        twgl.setBuffersAndAttributes(gl, pLight, lightBuf);
        twgl.setUniforms(pLight, {
            uTime: time,
            uShine: shine,
            uAspect: aspect,
            uRes: [fbi.width, fbi.height],
            uCssH: canvas.clientHeight,
            uRayCol: theme.raysCol,
            uRayA: theme.raysA,
            uBoostCol: theme.boostCol,
            uBoostA: theme.boostA,
            uHaloCol: theme.haloCol,
            uHaloA: theme.haloA,
            uVis: theme.vis * POSE.glowMul,
            uBreath: breath,
            uBlur: POSE.blurMul,
            uRadScale: POSE.radScale,
            uRadStr: POSE.radStr,
            uDimLo: POSE.dimLo,
            uDimCap: POSE.dimCap,
        });
        twgl.drawBufferInfo(gl, lightBuf, gl.TRIANGLE_STRIP, 4, 0, instanceCount);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.BLEND);
        gl.useProgram(pBlit.program);
        twgl.setUniforms(pBlit, { uTex: fbi.attachments[0] });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(pGrid.program);
        twgl.setUniforms(pGrid, {
            uRes: [canvas.width, canvas.height],
            uOn: 1,
            uPitch: theme.gridPitch * dprCap,
            uGrid: theme.gridCol,
            uAlpha: theme.gridA,
        });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const drawStatic = () => {
        shine = running ? 1 : 0;
        drawFrame(9.5, 0);
    };
    const themeObserver = new MutationObserver(() => { readPalette(); if (options.reduced)
        drawStatic(); });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    const sizeObserver = new ResizeObserver(() => { resize(); if (options.reduced)
        drawStatic(); });
    sizeObserver.observe(canvas);
    resize();
    let raf = 0;
    let prev = performance.now();
    const frame = (now) => {
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        const target = running ? 1 : 0;
        shine += (target - shine) * Math.min(1, dt * (target > shine ? 1.4 : 1.1));
        drawFrame(now / 1000, POSE.breatheMul);
        raf = requestAnimationFrame(frame);
    };
    const start = () => {
        if (options.reduced || raf !== 0)
            return;
        prev = performance.now();
        raf = requestAnimationFrame(frame);
    };
    const stop = () => {
        if (raf !== 0)
            cancelAnimationFrame(raf);
        raf = 0;
    };
    const onVisibility = () => {
        if (document.hidden)
            stop();
        else
            start();
    };
    if (options.reduced) {
        drawStatic();
    }
    else {
        start();
        document.addEventListener('visibilitychange', onVisibility);
    }
    return {
        setRunning(next) {
            running = next;
            if (options.reduced)
                drawStatic();
        },
        dispose() {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
            themeObserver.disconnect();
            sizeObserver.disconnect();
        },
    };
}
