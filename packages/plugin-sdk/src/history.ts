// A file's history (ADR 0076): every fs.write over a file keeps the bytes it replaces, and a plugin
// lists those versions with fs.history and writes one back with fs.restore, which keeps what it
// replaces in turn.
import type {
  FsReadPermission,
  FsRestoreResult,
  FsVersion,
  FsWritePermission,
} from "@endue-ai/bridge";
import type { PluginContext } from "./sdk";

export type { FsRestoreResult, FsVersion } from "@endue-ai/bridge";

export interface FileHistoryOptions {
  /** The newest versions to list at most; all the desk keeps when absent. */
  limit?: number;
}

/**
 * The versions the desk kept of `file`, newest first: each is what one write replaced, with when it
 * ran (`at`), whose write it was (`caller`), `size` and `sha256`. Needs an `fs:read` scope.
 */
export async function fileHistory(
  ctx: Pick<PluginContext, "bridge">,
  file: { path: string; scope: FsReadPermission },
  options: FileHistoryOptions = {},
): Promise<FsVersion[]> {
  const limit = options.limit === undefined ? {} : { limit: options.limit };
  const { versions } = await ctx.bridge.call("fs.history", {
    path: file.path,
    ...limit,
    scope: file.scope,
  });
  return versions;
}

/**
 * Write version `version` of `file` back. Answers the bytes written and the version that keeps what
 * the restore replaced. Needs an `fs:write` scope; an unknown version rejects with `not_found`.
 */
export function restoreFile(
  ctx: Pick<PluginContext, "bridge">,
  file: { path: string; scope: FsWritePermission },
  version: string,
): Promise<FsRestoreResult> {
  return ctx.bridge.call("fs.restore", { path: file.path, version, scope: file.scope });
}
