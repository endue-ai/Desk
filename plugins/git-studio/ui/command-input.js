// Arguments that cross the command boundary into Git.

/** @typedef {import("@endue-ai/plugin-sdk").Invocation} Invocation */
/** @typedef {(args: any, invocation?: Invocation) => unknown} Handler */
/** @typedef {(name: string, handler: Handler) => void} Register */

/** @param {Invocation | undefined} invocation */
export const isAgent = (invocation) => invocation?.caller.startsWith("agent:") === true;

/** @param {unknown} value @param {string} label */
export function argument(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trimStart() !== value ||
    value.startsWith("-") ||
    value.includes("\0")
  )
    throw new Error(`Give ${label}.`);
  return value;
}

/** @param {unknown} value */
export function pathInRepo(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    /^(?:[\\/]|[a-z]:)/iu.test(value) ||
    value.split(/[\\/]/u).some((part) => part === ".." || part.toLowerCase() === ".git")
  )
    throw new Error("Give a file path relative to the repository.");
  return value;
}

/** @param {import("./repo.js").Runner} git @param {string} cwd @param {unknown} value */
export async function commitAt(git, cwd, value) {
  const rev = argument(value, "a commit or ref");
  const { stdout } = await git.run(
    ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`],
    { cwd },
  );
  const sha = stdout.trim();
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(sha))
    throw new Error("Git did not return a commit.");
  return sha;
}
