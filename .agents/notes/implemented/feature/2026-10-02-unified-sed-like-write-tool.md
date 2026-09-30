---
status: implemented
kind: feature
date: 2026-10-02
title: One sed-like write tool replaces write+edit
owners: packages/fs/tool-fs
---

# One sed-like write tool replaces write+edit

The model-facing mutation surface is a single `write` tool whose `edits` array
carries sed-style hunks (literal, JavaScript regex, inclusive line-range,
insert-after-line) alongside the whole-file `content` arm, with `overwrite`
as the explicit clobber flag and `dry_run` as the preview. The separate `edit`
tool, the `TOOL_EDIT` guidance slot, and the `fs/edit-intent` event are retired;
the `fs/write-intent` waterfall gains a `'content' | 'program'` mode argument so a
loaded `fs-observation-policy` can impose its strict read-before-mutation flavor
on programs while content arms keep the historical create/replace semantics.

## Why the tool owns the default gate

Users asked for a CLI-feeling surface: denials must be explicit and actionable,
not memory tests. The tool-owned `gate.ts` records `fs/observed` state exactly as
the policy plugin does and supplies the waterfall default: observed-present
commits at the observed version, observed-absent creates (or `FS_NOT_FOUND` for a
program with nothing to patch), unobserved content writes need `overwrite: true`
(`FS_OVERWRITE_DENIED` otherwise), and unobserved programs patch at a fresh stat
basis — match-and-preserve can never blind-clobber. The provider's per-target
lock plus staged publication remain the commit engine; programs fold to one
`writeText` call, so a batch is one atomic CAS transaction with all-or-nothing
semantics enforced by throwing before the commit.

## Why no sed-text parser

Entries are structured JSON; the repo schema DSL's closed oneOf branches enforce
the four field tuples before `execute` runs, and JavaScript's RegExp is the regex
engine. A sed-locale text parser would add a quoting and portability layer
(GNU/BSD differences, shell nesting) that no owned code needs; the fold over the
four forms in `program.ts` is the only new machine and it is I/O-free.

## Migration surface absorbed in the change

`edit.ts` deleted; `str_replace_editor` dispatches the new write-intent arity;
base bundle drops `fs-observation-policy` (package stays as the opt-in strict
flavor; its README says so); system-prompt retires `TOOL_EDIT` and reflows
`TOOL_GLOB`/`TOOL_GREP`; snapshot sidecars and generated catalogs (tool-catalog,
cordis surface, doc graphs) regenerated; READMEs and subsystem docs re-phrased in
both languages with pairing hashes re-recorded. Keyed `test:snapshot:record`
remains a follow-up where recorded model-visible bodies embed old text.
