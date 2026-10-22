# Agent Note: a `surface` tab type owns one record; the address rides navigation

Status: implemented

## Problem

The tab registry's `claim()` answered two questions with one lookup and hard-coded the second:

- **routing** — which registered type draws this address? Answered declaratively by `patterns` + `priority` + `canOpen`, and it works: `vscode` (extension) deterministically outbids `editor` (builtin) and `text` (fallback).
- **identity** — what tab record does opening it produce? Answered nowhere declaratively: `claim()` returned `contentId: address` unconditionally, so the planner's `(kind, contentId)` dedupe minted one tab per file.

That identity rule is a leftover from the native per-file reader. It is wrong for an embedder that owns its own internal tabs: every file click on a VS Code workspace minted another `vscode` tab record for the same single iframe.

How the defect surfaced:

- Clicking 10 files left 10 phantom `vscode` records. Nothing rendered them — the right column hid its tab strip while any `vscode` tab existed — so the dock was invisible whenever the twin was up.
- Each click changed `activeTabId` → new `tab.id` → `<TabSlot key={tab.id}>` remounted the body on every file click.
- Close rules, `canCloseTab`, `soleDockedTab`, and the layout-wide `vsMounted` scan all operated on N records for one document.
- Presentation carried its own copy of the rule: a `kind === 'vscode'` comparison in `SidebarRight.tsx` hid the strip, floated the panel controls, and suppressed the explorer — while the dock stayed mounted and drew behind the workbench.

## Decision

A tab type may declare itself a **surface**: the column's one document. A surface claim still routes by address, but records the type's page address as the identity and lets the real address travel as navigation.

```ts
// ui-sidebar-right/src/client/tab-registry.ts
export interface SidebarRightTabDefinition {
  // …id, kind, patterns, priority, canOpen, title…
  /**
   * This type owns the column's single surface: every address it claims lands on
   * ONE record per session, and the address rides navigation instead of the
   * record. For an embedder that owns its own internal tabs (the VS Code
   * workbench): one document, many files. Omit for a per-address viewer.
   */
  readonly surface?: boolean
}
```

```ts
// claim() settles through one helper
function settleClaim(definition: SidebarRightTabDefinition, address: string): SidebarRightTabClaim {
  if (definition.surface === true) {
    const contentId = pageAddress(definition.kind)
    return { kind: definition.kind, contentId, title: definition.title(contentId), surface: true }
  }
  return { kind: definition.kind, contentId: address, title: definition.title(address), surface: false }
}
```

Three consequences follow without new machinery:

1. **Refocus instead of reopen.** `planOpenContent` already dedupes on `(kind, contentId)`, and `applyFocusTab` sets `activePaneId` to the pane holding the record. With a stable `contentId` the second file click focuses the existing record — across panes — so the body instance and its React key never change.
2. **The address arrives as navigation.** `place()` already called `tabDomain.navigate(sessionId, tabId, { address, params })` with the real address; it was redundant only because the occurrence seed wrote `tab.contentId` into `navigation`. The body now reads `tab.navigation.address` / `tab.navigation.revision`.
3. **Surfaces dedupe column-wide.** `openContent` keeps the per-pane `panePage` lookup for ordinary pages and lets a surface fall through to the kit's cross-pane `findContentTab`, because one document cannot live in two panes.

## The column election

The column's content is a chain seat whose fallback is the dock:

```tsx
{renderSlotChain('rightbar.surface', {
  surface: surfaceKind,
  body: activeTab === undefined ? undefined : renderBody(activeTab),
}, { fallback: dock })}
```

- `surfaceKind` is read from the type in force for the active **docked** tab's declared `surface` flag, through the registry the seat already observes. `ui-sidebar-right` compares no kind name at all.
- The election input is plain owner props, so selectors stay pure, as `ChainSelect` requires. No `overlay`: an election must unmount the dock, not keep it behind the surface.
- An elected entry draws `body` — the surface tab's body. The seat is the only party authorized to dispatch it, since it declares `sidebar.right.pane.tab`, so the body travels as an owner prop rather than the entry reaching for one.
- A floated tab keeps its float layer's body and never elects, so one document is never drawn twice.

So the dock's strip, split controls, and explorer leave the tree instead of being hidden inside it, and the panel's corner controls float over whichever content was elected.

## API changes

`@deepseek-ai/dsh-client-ui-sidebar-right`:

- `SidebarRightTabDefinition` gains optional `surface?: boolean`.
- `SidebarRightTabClaim` gains required `surface: boolean`; `contentId` is the address for a viewer and the type's page address for a surface.
- `OpenContentIntent` gains optional `surface?: boolean`; `openContent` skips the per-pane page dedupe and the forced `revealIfOpened: false` for it.
- `SidebarRightTabNavigation.address` documents both cases: the record's `contentId` for a viewer, the last navigated address for a surface.
- New `rightbar.surface` chain seat (session scope) with `RightbarSurfaceOwnerProps = { surface, body }`, declared as a child of `rightbar.session`.
- `ISidebarRight` is unchanged — callers still pass an address and know nothing about tabs.

`@deepseek-ai/dsh-client-ui-vscode`:

- `vscodeDefinition()` declares `surface: true`.
- Registers a `rightbar.surface` chain entry that elects itself when `surface === VSCODE_KIND` and draws the owner-supplied body.
- `VscodeBody` derives its session and forward address from `tab.navigation.address` instead of `tab.contentId`.
- `useVscodeAddressForward(address, revision, ready, workspaceRoot, send)` takes the navigation revision, so re-opening the same file forwards again instead of being swallowed by the address-only dedupe.

## Deferred

Per-file routing is unchanged: while a `surface` type is registered at the `extension` band it outranks every `builtin`/`fallback` viewer for every address, because band is the first sort key. A native viewer can take a subset only by declining in its own `canOpen`, or by registering in the `extension` band with a longer matched pattern. That is a routing question, not an identity one.

## Alternatives considered

- **Keep per-file records and simply hide the strip** (the status quo): the screen looked right, but N records for one document still drove body remounts, made every close rule operate on phantoms, and left the dock's tab model contradicting what it drew.
- **Make the dock itself a chain entry instead of the fallback:** it would have to declare and render `sidebar.right.pane.tab` and `sidebar.right.explorer` itself, because a slot entry may only render the children its own registration declared. Keeping the dock as the owner's fallback preserves that ownership and still gives the election its whole point — the dock leaves the tree.
- **Conditionally register either the dock or the surface into the column:** slots have no registration predicate; an entry renders from registration until disposal. Conditional *routing* is a chain selector, which is what shipped.
- **Add a `surface` flag to the planner input and special-case identity there:** the planner is deliberately address-agnostic (`kind` and `contentId` are opaque), and identity is a routing decision, so the flag belongs to the claim rather than to the kit.

## Consequences

- Bought: one record per surface, so file clicks refocus instead of remounting the body; navigation's `revision` makes "open the same file again" actually forward; the layout's model matches what the column draws; the dock is unmounted rather than hidden while a surface owns the column, so no strip, split, or explorer code runs behind it; and `ui-sidebar-right` no longer names any package's kind.
- Cost: `contentId` and `navigation.address` now genuinely diverge, so any consumer that read `contentId` as "the current file" had to move to navigation — the accessor is easy to get wrong and only the type catches the absent field. A surface cannot be duplicated into a second pane (by design), and its chip title is its page basename, which is inert only because the strip is not drawn while it is mounted.
