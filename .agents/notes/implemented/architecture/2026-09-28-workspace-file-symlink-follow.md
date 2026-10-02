# Agent Note: Workspace file reads follow symbolic links

Status: implemented

## Problem

The [workspace file service](2026-09-05-workspace-files-service.md) probed a requested path with `lstat` and refused any final component that was a symbolic link, wherever it pointed. The [read-authority decision](2026-09-09-workspace-file-read-authority.md) later gave `read`, `readBytes`, `readAll`, `readRelated`, and `stat` the Session filesystem backend's read authority, so an absolute path or a `..` path outside the workspace became readable — while a link to the same outside file stayed refused. Containing file reads was no longer what the refusal did.

In the Web client the refusal also contradicted the directory tree. `list` reports a link child as the type it resolves to, so the tree draws a link to a regular file as an ordinary openable row; opening it failed with `workspace-file/not-regular-file`, and the preview replaced the content with `Not a regular file, nothing to display.` Repositories carry such links as a matter of course — `CLAUDE.md` beside `AGENTS.md` is the common one — so the file a reader picked from the tree was the file the reader could not open.

## Decision

Every operation resolves the requested path through the composed filesystem, following its final component, and then requires the resolved target to be the kind the method needs. A file method refuses a directory or any other non-regular target with `workspace-file/not-regular-file`; `list` refuses a non-directory with `workspace-file/not-directory`. A link whose target is missing resolves to no entry and is `workspace-file/not-found`.

`list` then applies its workspace-containment check to the resolved target, so a directory reached through a link inside the session workspace is listed and a link whose target lies outside the root is `workspace-file/outside-workspace`. Directory navigation stays inside the workspace; file reads keep the backend's read authority, exactly as an explicit path to the same target would.

The result's `absolutePath` stays canonical — the target's path in the filesystem's execution world — so a link and its target share one identity and one change-feed binding, and the preview of a link follows the target's versions.

`dsh-fs` keeps `lstat` as its no-follow probe for consumers whose rule really is about the path entry. `tool-present` uses it to refuse a final symbolic link in a model's deliverable declaration, and the native-open route of `ui-deliverables`, which hands a presented path to the Host desktop, checks it the same way before it resolves or opens. Both refusals are unchanged. The workspace-file error details drop the now-unreachable `symlink` kind, because `FsInfo` reports only `file`, `directory`, or `other`: `workspace-file/not-regular-file` carries `directory` or `other`, and `workspace-file/not-directory` carries `file` or `other`.

## Alternatives considered

**Keep the refusal and mark link rows unopenable in the tree.** The tree's `other` row already draws as a greyed, non-focusable entry with a tooltip, but a link to a regular file reaches the client as `file`, so this route needs `list` to report the link itself rather than its target — a new entry kind on the wire. It still denies a preview of a file the reader picked, which is the defect being fixed, and the containment argument that motivated the refusal no longer covers file reads.

**Follow links only when the target stays inside the workspace.** This would apply to file reads a containment rule the service deliberately dropped, and it would keep refusing a link to a shared file outside the root — for example a repository whose `AGENTS.md` links a checkout elsewhere — while permitting that same target by absolute path.

**Follow links for the file methods but keep `list` refusing them.** The tree would still fail to expand a linked directory, leaving the same visible wart one row down, and the containment check on the resolved directory is what makes following `list` safe.

**Let the native-open route follow a link as the service now does.** Rejected: that route hands the path to the Host desktop, which opens it with the machine's own applications, so a link planted at a declared path would open a file the Session never declared. It carries its own path-entry check instead.

**Keep `lstat` as a presence probe in front of the `stat`.** Once the kind decision belongs to the resolved target, the second probe has no owner: it costs one filesystem call per read, and its only remaining effect was reporting a race after the probe as `workspace-file/not-found` or `workspace-file/not-regular-file` instead of the backend's own `FS_NOT_FOUND` or `FS_NOT_REGULAR_FILE`.

## Consequences

A file or directory reached through a symbolic link opens in the Web client like any other, including the `CLAUDE.md`-beside-`AGENTS.md` case, and a link put in front of a target by a deployment works without the deployment restructuring its tree.

A file that vanishes or changes kind between the service's one stat and the backend's read now surfaces the backend's `FS_NOT_FOUND` or `FS_NOT_REGULAR_FILE` rather than a `workspace-file/*` code; the client's generic failure line carries its message.

Directory listing through links is bounded by resolved containment, not by the spelling of the path, so a link that leaves the workspace reports `outside-workspace` and the tree keeps offering only the workspace. File reads gain no authority: the link resolves to a target the backend would have read by explicit path.

A consumer that must not follow a link keeps its own check. The native-open route of `ui-deliverables`, which the [present decision](../feature/2026-09-08-present-workspace-source-files.md) owns, carries the path-entry check the service no longer performs, so a presented file replaced by a link is refused with 404 and the Host desktop is never asked to open its target.

## Testing

`packages/api/workspace-files/tests/read.spec.ts` pins reading through a link to a workspace file, reading a link whose target is outside the workspace, and reporting a dangling link as `not-found`, alongside the single-probe race cases. `read-all.spec.ts` pins `readRelated` following a link; `stat.spec.ts` pins a link reporting its target's identity and a dangling link as `not-found`; `list.spec.ts` pins listing a linked directory inside the workspace and `outside-workspace` for one whose target leaves it. The file-tree and preview specs of `ui-sidebar-files` and `ui-sidebar-documentpreview` cover the client side of the failure codes, which are unchanged. `packages/client/ui-deliverables/tests/present-open.host.spec.ts` pins the native-open route refusing a final link and still opening an outside regular file.
