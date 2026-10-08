# Agent Note: Web editor — language detection registry and the expanded grammar set

Status: implemented

## Problem

The editor highlighted four languages through one hardcoded `switch` on the file's final suffix in `src/client/editor.ts`: TypeScript/JavaScript, JSON, Markdown, and Python. Go, Rust, YAML, CSS, and HTML files edited as plain text even though the product's own tools and the reference deployment's configured language servers work in them; the suffixless prose files a repository is full of (`README`, `LICENSE`, `ChangeLog`) had no way to be recognized at all; and adding a grammar meant editing the extension assembly and its spec together.

## Decision

`src/client/languages/` owns recognition: a `LanguageRegistry`, one contribution module per shipped language, and the parses they share — `path.ts` (last path segment, dotted suffix) and `shebang.ts` (the interpreter a first line names). `editor.ts` builds one registry at module load, `languageFor(path, text)` delegates to it, and `isMarkdownPath` asks for the Markdown contribution's id rather than re-deriving the suffix set, so the grammar set and the rendered display claim cannot drift apart.

Recognition order is the exact lowercased file name, then the longest dotted suffix a contribution claims, then each contribution's first-line test in registration order. The first-line tests run only when the buffer text is supplied and only after names and suffixes fail, so `a.py` carrying a `#!` line stays Python while an extensionless `tool` script is recognized by its interpreter. Suffixes and names are matched case-insensitively, on either path separator.

The shipped set is css, go, html, javascript, json, markdown, python, rust, and yaml. The JavaScript contribution chooses its TypeScript dialect inside `load(path)` (`.ts`/`.mts`/`.cts`, `.tsx`, `.jsx`, plain JavaScript), the Markdown contribution also claims `readme`, `license`, `changelog`, and `contributing` by name, and the Python and JavaScript contributions recognize `#!` interpreters (`python`/`python2`/`python3`; `node`/`nodejs`/`deno`/`bun`) including the `env` forms `#!/usr/bin/env -S python3 -u` and `#!/usr/bin/env FOO=bar node`. Every grammar is a static import inside its contribution module, so the emitted `lib/client.js` stays a single file.

Registration is atomic and returns a disposer. A repeated id, an extension or file name another language already claims, a key that could never match a lowercased path (no leading dot, uppercase), and a key repeated inside one contribution all throw before the registry changes.

The registry is an internal module, not a Cordis service: every language ships in this package's client bundle, so no other package contributes to it today (see the alternatives for what a cross-package registry would require).

## Alternatives considered

**A client package per language.** Blocked by CodeMirror module identity. `LanguageSupport` extensions and `@lezer/highlight` tags are objects compared by identity, so a grammar package that inlines its own `@codemirror/language` or `@lezer/highlight` builds extensions the editor's copies cannot apply — highlighting would silently stop working. Sharing one copy would require the specifiers in `PLATFORM_MODULES`, and `verify-client-packages` refuses a `packages/client/*` package the `dsh.client.external` request such a dependency needs. The registry is the seam that makes splitting into packages a mechanical move once a shared identity exists.

**`@codemirror/language-data`.** Its `LanguageDescription.load()` methods are dynamic imports; this package emits one bundle, so code splitting buys nothing and the dependency edge covers the same bytes.

**Shell through `@codemirror/legacy-modes`.** The only CodeMirror shell grammar, and it types its parsers against `@codemirror/streamparser`, which `@codemirror/language` only re-exports from 6.13 onward. Both packages were published the day this change was written, so adopting them would have needed a `minimumReleaseAgeExclude` entry to bypass the repository's release-age policy. Shell therefore still edits as plain text; adding it later is one contribution module plus that dependency decision.

**Keeping the suffix switch.** Every added language would keep editing the extension assembly and its spec, and file names and interpreter lines would stay unrecognizable.

## Consequences

The shipped client bundle grows from 1,282,351 to 1,435,724 bytes (+153 KB, +12%), dominated by the Go, Rust, and YAML grammars with their Lezer parsers; the per-language contributions are the unit a future code-split or a trimmed deployment would cut.

Recognition is a pure function of the path and the buffer's first line, so it is covered in the node lane (`tests/languages.client.spec.ts`) and every new `src/client/languages/` file meets the per-file 100% coverage gate. The GitHub-flavored `README` and `LICENSE` case now highlights; `.bashrc`-style dotfiles and shell scripts deliberately do not.

No change reaches the save seam, the tab type, the injection face, or the LSP seams planned in [the editor foundation note](../../proposed/architecture/2026-10-05-web-workbench-editor-foundation.md): the relay carries frames, not grammars. The Markdown display modes note stays current through its own mechanism sentence, which now points here.
