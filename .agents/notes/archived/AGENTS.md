# AGENTS.md — Archived Agent Notes

Archived Agent Notes under the kind directories are frozen historical snapshots, not current authority. Never edit, reformat, repair, delete, or move a sealed artifact; use an active Agent Note or current documentation for new decisions and facts.

Run the [`dsh-archive-agent-notes`](../../skills/dsh-archive-agent-notes/SKILL.md) workflow and append new artifact hashes with `pnpm run verify-archived-agent-notes --write`. The verifier rejects changed seals, unknown kind folders, and invalid archive metadata; sealed entries pruned from disk by a repository-wide rewrite drop out of the manifest on the next `--write`.
