# Agent Note: Web editor — rendered Markdown display modes and token-bound styling

Status: implemented

## Problem

The `editor` tab type claims Session file addresses at the `builtin` band, ahead of the `text` preview's `fallback` band, so a Markdown file opened from the file tree lands in the raw CodeMirror source view even though the product already owns a full Markdown renderer (`MarkdownText` in `ui-primitives`, used by the read-only preview's `markdown` document renderer). Reading a note in the web UI therefore has no rendered surface, and the editor itself shipped unstyled: `EditorBody.module.css` referenced `--borderColor-default`/`--backgroundColor-warning` variables no theme sheet defines, and CodeMirror ran its default theme in both appearances.

## Decision

One editor body offers two display modes for the Markdown suffixes (`.md`, `.markdown`, the set `languageFor` already claims): the rendered page, the default, and the source editor. The rendered page draws the *current buffer* through the shared `MarkdownText` primitive, so a Markdown file opens rendered and always shows what a save would write, saved or not. Leaving the source display commits the live buffer into the document generation (the `LoadedDocument` the view was built from), so unsaved edits survive the round trip and stay visible as `unsaved` in the status line; entering it again mounts a fresh view over that committed text. A save from the rendered page writes the committed generation under the same version guard, reusing the view path unchanged while the view is mounted. The swap is a segmented Preview/Source control in the footer; non-Markdown files keep the single source display. The editor view wraps long lines (`EditorView.lineWrapping`), matching how the rendered page reads prose in the sidebar column.

The styling half moves the whole editor onto the product design tokens: `EditorBody.module.css` consumes `--dsw-alias-*` aliases (banner on the warn ramp, footer on the panel tone, segmented control on the interactive-hover tone), and two new CodeMirror extensions — `editorTheme()` and `editorHighlight()` in `src/client/editor.ts` — theme the view chrome and grammar tokens through the same aliases. Variable-based colors make light and dark appearances follow `body[data-ds-dark-theme]` without a second theme spec.

`languageFor` and the new `isMarkdownPath` share one suffix parse so the grammar set and the display-mode claim cannot drift apart.

## Alternatives considered

**Release Markdown files to the read-only preview.** The editor's `builtin` band exists so files open editable; trading the save story for rendering would need a viewer menu on the preview side and still leaves no rendered surface in the editor. The two readers stay complementary: the preview renders the buffer inside the editor, the read-only preview keeps its viewer menu and file mentions.

**A second right-Sidebar tab type for rendered Markdown.** The document content is one `dsh-resource://file/…` address; two tab types for it split one document identity across chip stacks and registries for what is a display preference, exactly the situation the document renderer registry inside the `text` preview solves for read-only viewers.

**Render Markdown inside CodeMirror decorations.** A widget/line-decoration renderer would run a second Markdown pipeline beside `MarkdownText`, keep the source view mounted for a decorative page, and re-solve streaming, sanitization, and theming the primitive already owns.

## Consequences

`dsh-client-ui-editor` gains a devDependency edge to `@deepseek-ai/dsh-client-ui-primitives` (baseline external module; tsconfig reference and informational `dsh.client.inject` edge) plus three display entries and the primitive's fence/footnote strings in the `editor` zh/en dictionaries. Behavior tests cover: a Markdown file opening rendered, the swap round-tripping unsaved edits, Mod-S and footer saves from each display guarding the loaded version, and localized fence chrome. The editor's unstyled default and dead CSS variables are gone; grammar tokens ride the state/label/link aliases. The rendered display is deliberately display-only: it carries no file-mention links or viewer menu, which stay with the read-only preview's `markdown` renderer, and it renders the buffer rather than the saved file — so a future "render what is saved" request reads as a decision to revisit, recorded here, not an oversight. The M1 save seam ([web-editor-m1-save-seam](../../implemented/architecture/2026-10-05-web-editor-m1-save-seam.md)) is unchanged; saves still run through the guarded `workspaceFiles.write`.
