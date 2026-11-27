// Keep a bounded inverse patch for a discard in its original repository.
import { GitError } from "./run.js";

/** @typedef {import("./run.js").RunOptions} RunOptions */
/** @typedef {import("./run.js").Outcome} Outcome */
/** @typedef {{ root: string, path: string, untracked: boolean, all: boolean }} Target */
/** @typedef {{ root: string, patch: string, label: string, bytes: number, restoring: boolean }} Inverse */

const MAX_PATCH_BYTES = 1024 * 1024;
const MAX_HISTORY_BYTES = 8 * MAX_PATCH_BYTES;
const MAX_UNTRACKED_FILES = 256;
const APPLY = ["apply", "--binary", "--whitespace=nowarn"];
const PATCH = ["--binary", "--full-index", "--no-ext-diff", "--no-textconv"];
const countBytes = (/** @type {string} */ text) => new TextEncoder().encode(text).byteLength;

/** @param {unknown} input */
function relativePath(input) {
  if (
    typeof input !== "string" ||
    !input ||
    input.includes("\0") ||
    input.includes("\\") ||
    input.startsWith("/") ||
    /^[A-Za-z]:/u.test(input) ||
    input.split("/").some((part) => part === ".." || part.toLowerCase() === ".git")
  )
    throw new Error("Give a path within the open repository.");
  return input;
}

/**
 * @param {{
 *   git(args: string[], options?: RunOptions): Promise<Outcome>, root(): string,
 *   confirm(question: string, action: string): Promise<boolean>,
 *   done(message: string): Promise<void>, cancelled(message: string): Error,
 * }} deps
 */
export function createDiscard({ git, root, confirm, done, cancelled }) {
  /** @type {Map<string, Inverse>} */
  const inverses = new Map();
  let retained = 0;

  const discardFiles = async (/** @type {Partial<Target>} */ args) => {
    const cwd = root();
    if (args.root !== cwd) throw new Error("The open repository changed before discard.");
    const path = relativePath(args.path);
    const all = args.all === true && path === ".";
    const untracked = args.untracked === true;
    if (path === "." && !all) throw new Error("Select a group to discard all its files.");
    const label = untracked
      ? all
        ? "the untracked files"
        : path
      : all
        ? "the unstaged changes"
        : `the changes to ${path}`;
    const question = untracked
      ? all
        ? "Delete every untracked file?"
        : `Delete ${path}?`
      : all
        ? "Discard every unstaged change?"
        : `Discard the changes to ${path}?`;
    if (
      !(await confirm(question, untracked ? (all ? "Delete them" : "Delete it") : "Discard them"))
    )
      throw cancelled(`Kept ${label}.`);
    if (root() !== cwd) throw new Error("The open repository changed before discard.");

    let patch = "";
    if (untracked) {
      const { stdout } = await git(
        ["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", path],
        { cwd },
      );
      const paths = stdout.split("\0").filter(Boolean).map(relativePath);
      if (paths.length > MAX_UNTRACKED_FILES)
        throw new Error("Too many untracked files to keep for Undo. Select a smaller group.");
      for (const entry of paths) {
        const result = await git(["diff", "--no-index", ...PATCH, "--", "/dev/null", entry], {
          cwd,
          ok: [1],
        });
        patch += result.stdout;
        if (countBytes(patch) > MAX_PATCH_BYTES)
          throw new Error("The selected changes are too large to keep for Undo.");
      }
    } else {
      const result = await git(
        ["--literal-pathspecs", "diff", ...PATCH, "--ignore-submodules=all", "--", path],
        { cwd },
      );
      patch = result.stdout;
    }
    if (!patch) throw cancelled("There are no changes to discard.");
    const bytes = countBytes(patch);
    if (bytes > MAX_PATCH_BYTES)
      throw new Error("The selected changes are too large to keep for Undo.");
    const token = globalThis.crypto.randomUUID();

    await git([...APPLY, "--reverse", "-"], { cwd, input: patch });
    inverses.set(token, { root: cwd, patch, label, bytes, restoring: false });
    retained += bytes;
    for (const [id, old] of inverses) {
      if (retained <= MAX_HISTORY_BYTES) break;
      if (old.restoring) continue;
      inverses.delete(id);
      retained -= old.bytes;
    }
    await done(`${(untracked ? "Deleted " : "Discarded ") + label}.`);
    return { token };
  };

  const restoreFiles = async (/** @type {{ result?: { token?: unknown } }} */ args) => {
    const token = args?.result?.token;
    const inverse = typeof token === "string" ? inverses.get(token) : undefined;
    if (!inverse || typeof token !== "string")
      throw new Error("The saved Git changes are no longer available.");
    if (inverse.restoring) throw new Error("The saved Git changes are already being restored.");
    inverse.restoring = true;
    try {
      await git([...APPLY, "-"], { cwd: inverse.root, input: inverse.patch });
      inverses.delete(token);
      retained -= inverse.bytes;
    } catch (error) {
      if (error instanceof GitError) {
        throw new Error(`The saved changes no longer apply: ${error.message}`);
      }
      throw error;
    } finally {
      inverse.restoring = false;
    }
    await done(`Put back ${inverse.label}.`);
  };

  return { discardFiles, restoreFiles };
}
