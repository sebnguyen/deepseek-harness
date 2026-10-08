# Agent Note: Checkpoint frontier keeps the stat snapshot

Status: implemented

## Problem

A checkpoint scan skips reading a file only when the in-memory table already holds that file's `mtimeMs` and `size`. `frontier.json` stored the content digest alone, and a resumed process rebuilt the table as empty, so the first tool call of every process read every kept file before the tool result returned. The digest was already on disk; the fact the diff consults was not. The owning capture record is [workspace snapshot timeline](../feature/2026-10-07-workspace-snapshot-timeline.md).

## Decision

Each frontier row stores `digest`, `mtimeMs`, and `size`. `loadFrontier` restores both the digest map and the stat map, and `saveFrontier` writes them together after every scan. A row whose value is a digest string, the form written before this change, still supplies the digest and supplies no stat, so that path is read once and then stored with its stat. A row with a digest and a non-finite mtime or a negative size keeps the digest and drops the stat. A missing or malformed frontier file is still an empty cache.

## Alternatives considered

**A second `stat.json` beside the frontier.** The scan already rewrites the frontier on every call. Two files can be observed apart after a crash between the writes, and the digest file would still be unable to skip a read on its own.

**Skip the read whenever a digest is present.** A resumed process would then ignore a file that changed while the process was down. The stat pair is what makes the skip safe.

## Consequences

The store still loads and saves a frontier that carries digest plus mtime and size. Capture no longer walks the workspace, so the service does not load or save that frontier; a committed write supplies its own before and after text ([write-tool snapshots](../architecture/2026-10-08-checkpoint-snapshots-write-tool-files.md)).
