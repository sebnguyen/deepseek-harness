---
description: "File-anchored durable knowledge notes: one JSON note per source file under the harness home, a read-time pointer, and read_note/upsert_note authoring tools. For users and maintainers choosing, configuring, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-notes

## Summary

This package records, per source file, the one non-obvious fact a reader needs before changing it. A **note** is a small JSON document under the harness home — never in the repository, so it never enters `git status` — keyed by the file's absolute path. When a noted file is read, the model receives one pointer line naming the file and the note's state; the note body is one `read_note` call away. Notes are authored with `upsert_note`, which stamps the target's current content hash so a writer never computes one, and removes a note when the claim is the empty string. A turn that changed a noted file receives one turn-boundary notice asking it to re-check the note.

The store is per-machine local state and is not session state: the pointer, the notice, and every tool result are ordinary session log records, so replay never reads a note file.

## Table of Contents

- [Use this package](#use-this-package)
- [Model experience](#model-experience)
- [Store layout](#store-layout)
- [Freshness](#freshness)

## Use this package

Mount the plugin in a profile or patch layer:

```yaml
plugins:
  - id: knowledge-notes
    name: '@deepseek-ai/dsh-knowledge-notes'
```

The package injects the `fs`, `tools`, `systemPrompt`, and `sessionProjections` services and registers everything itself. The only configuration is `dshHome`, an override of the harness home the store lives under (`<home>/knowledge/notes`); deployments almost always leave it unset.

## Model experience

Reading a noted file attaches one pointer line as injected context, rendered as a collapsed context-injection row in the Web transcript:

- `Note for <file> (current): <note path>` — the note matches the file.
- `Note for <file> is stale — ...` — the file changed after the note was written.
- `Note for <file> is orphaned — ...` — the described file no longer exists.

`read_note { target }` fetches the body with its state; `upsert_note { target, claim }` writes or updates and an empty `claim` removes. Every pointer and the single per-turn refresh notice are derived from the session log, so a plugin reload or session resume can neither lose nor double-count an obligation.

## Store layout

One file per note at `<home>/knowledge/notes/<absolute-target-path>.json`, the leading separator dropped. The layout is private: no tool argument, tool result, or prompt text ever names a note path. The store is the only writer of note files and writes unconditionally through the `fs` capability, so the write tool's observed-version policy never sees a note file.

## Freshness

`upsert_note` hashes the target's content after normalizing line endings, trailing whitespace, and blank-line runs — the two meaning-preserving changes, a formatter run and an editor round-trip — and nothing else. A note is live when the hash matches, stale when the target changed, and orphaned when the target is gone. Normalization is deliberately tier-1 only: an identifier is semantic content. Renames are not normalized; a moved file reports orphaned.
