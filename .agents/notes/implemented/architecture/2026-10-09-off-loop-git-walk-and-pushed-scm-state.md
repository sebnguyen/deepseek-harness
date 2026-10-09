# Agent Note: Off-loop git walk with pushed scm state after observed writes

Status: implemented

## Problem

The git seam's `statusMatrix` walk hashes every changed worktree file in pure JavaScript on the Host event loop; on a large workspace one status read stalls boot and every turn for tens of seconds, and badging the explorer polled that walk on queries. The walk cannot move to the composed filesystem's bounds: it must hash files the seam's byte cap exists to protect elsewhere, and isomorphic-git gives no capped read that survives a changed-file walk.

## Decision

`dsh-git-isomorphic` owns a `GitWalkRunner`: one `node:worker_threads` worker per provider that runs the walk over node `fs`, with the runner's worker launch flags derived from the worker source and the engine, and the built face booting a plain-CJS worker entry. A backend whose `processPathFromHostPath` mirrors the session root takes the worker lane; others keep the composed-filesystem walk, whose faults classify into the seam's error frames. The worker reads real stats, so the walk zeroes every stat time field before isomorphic-git sees it, defeating the index stat cache that would otherwise skip same-second rewrites. `dsh-api-workspace-files` adds a `ScmFeed`: each observed write inside a remembered root schedules one debounced re-walk (`scmUpdateDebounceMs`), and the result rides `workspaceFiles/scm-updated` through the typert forwarding allowlist so the explorer applies pushed state without re-asking.

## Consequences

Status reads no longer starve the Host; the explorer badge refreshes once per write burst without polling, and drops a push whose root no longer matches the open session. The push's entries are a record, converted through the same `entriesRecordOf` the pull face uses, so both lanes type one vocabulary. Backends without a host mirror pay the old walk cost as before, and a disposed provider terminates the worker through the fiber's registered effect. The worker's rows bypass the seam's entry cap; the diff read keeps it.

## Alternatives considered

A subprocess `git status` provider: fast, but imports a binary the assembly deliberately lacks and a second git dialect the seam exists to hide. Memoized walks on the Host: keeps the stall and adds staleness the push must still solve. Client-poll refresh: moves the loop stall to a timer and re-walks on every poll instead of on change.
