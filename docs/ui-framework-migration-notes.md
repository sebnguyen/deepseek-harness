# UI Framework Migration Notes (React 18 → Preact/Solid)

Date: 2025-10-19. Status: analysis only, no code changed. Scope investigated: the web UI
(`apps/web` + `packages/client/*`) in this repo copy. The workspace has four near-identical
sibling tree copies (`deepseek-harness-twintwin-*`, `-turn-finish`, `-clamp-reminder`);
all findings below were verified against `deepseek-harness` only.

## Current state (verified facts)

- React 18 + TypeScript + CSS Modules, built with Vite (`apps/web`) / tsdown (client packages);
  tests on Vitest 4 + jsdom.
- `apps/web` is a trivial shell (`src/main.ts` ~6 lines, `AppWebEntry`); all UI code lives in
  **61 packages under `packages/client/` (51 are `ui-*`) totalling ~111k LOC, ~765 src files**
  (`packages/client/*/src`).
- Store engine is framework-free: `packages/client/store` uses `zustand/vanilla` + immer +
  `subscribeWithSelector`. No router, no react-query/swr/axios; data flows over the custom
  `/api` HTTP+WebSocket RPC in `packages/client/connection`.
- Architectural React coupling is concentrated, not spread: `packages/client/ui-renderer` +
  `ui-slots` materialize slot bindings into React hooks via `useSyncExternalStore` (60 sites)
  and 3 `createContext`s (`packages/client/ui-renderer/src/client/bindings.tsx`).
- Hook census over `packages/client`: useState 433, useRef 330, useEffect 295, useMemo 182,
  useCallback 144, useLayoutEffect 64, useSyncExternalStore 60, useId 21, useContext 4,
  useReducer 2, forwardRef/useImperativeHandle 0. Exactly one class component:
  `SlotErrorBoundary` in `ui-renderer/src/client/scoped-slots.tsx`.
- **Compat-clean surface:** no Suspense/lazy, no useTransition/startTransition/useDeferredValue,
  no React-ecosystem library deps (only react/react-dom in package.json). `react-dom/client`
  used in ~3 files (`packages/client/web/src/seed.ts`, `platform.ts`, `ui-renderer/src/client/index.ts`).
- Escape hatches needing per-site attention in any port: 17 `createPortal` call sites,
  58 `.innerHTML` writes + 4 `dangerouslySetInnerHTML`, and imperative embeds of
  CodeMirror 6, mermaid, KaTeX, shiki, pdfjs-dist.
- Tests: ~407 spec files under `packages/client`, ~178 importing `@testing-library/react`;
  coverage gate explicitly exempts large UI areas (see `vitest.config.ts` `TODO(gui)` block) →
  behavior gaps will surface during any migration.

## Options and rough cost

| Tier | Scope | Estimate |
| --- | --- | --- |
| 1. Tune React in place | Selector granularity, memoize hot re-renders | Days |
| 2. **Preact compat (the "easy migration")** | `@preact/preset-vite` in `apps/web`, jsx-runtime config in shared tsdown setup, mechanical `react`→`preact` package.json swaps across ~60 packages, swap 3 `createRoot` sites, point 178 RTL suites at `@preact/testing-library` | 2–3 engineer-weeks, largely scriptable |
| 3. Preact + `@preact/signals` (signal rendering where it matters) | Rewrite `ui-slots` hook materialization on signals first (this is the load-bearing layer — 60 useSyncExternalStore sites hang off it), then convert hot screens (TrajectoryTable, ChatView, WorkspaceBrowser) incrementally | +2–4 weeks, shippable in slices |
| 4. Solid rewrite | Rewrite renderer core as signals/stores; port 111k LOC including portals, raw-HTML, WebGL, imperative widgets; port 178 test suites | 4–6 engineer-months |

## Recommendation (agreed in conversation)

Tier 2 first, then tier 3 where profiles justify it. Rationale: the codebase's state layer is
already framework-free and its React-specific API usage is near zero, so compat migration is
mechanical, while the slot-subscription layer (`ui-slots`) is the one place where real
architectural (signal) work pays off — likely the source of most re-render cost.

Caveat: Preact out of the box is a lighter VDOM diff engine, not a signal renderer;
signal-based rendering requires adopting `@preact/signals` (tier 3). If the goal is fine-grained
reactive rendering *everywhere*, only tier 4 (Solid) delivers that.

## Open scope questions (verify before committing)

- Do `ui-vscode` / embedded-frame / VS Code surfaces share these client packages, and are they
  in migration scope? Same compat check must run there.
- Which repo tree copy is canonical for the change (five sibling copies exist in the workspace).
- Is `OceanScene` (WebGL) a shippable feature to preserve or an experiment.
- How many of the 178 RTL suites assert React-specific timing (act/portal/portal-event-bubbling)
  vs pure behavior.
