// The repository's branches as `git for-each-ref` lists them, for the switch pick (actions.js) and
// the palette's Branches group (contributes.paletteProviders, specs/plugin/v0). A pick in the
// palette runs endue.git.checkout with the branch, the same switch as `b`: git's own refusal to
// overwrite uncommitted changes is what stands in the way, as it does there. No DOM.

/**
 * @typedef {import("./run.js").Outcome} Outcome
 * @typedef {(args: string[]) => Promise<Outcome>} Git
 * @typedef {{ name: string, remote: boolean, detail: string }} Branch
 */

/** How many results the palette gets when it does not say, and the most it may ask for. */
const LIMIT = 8;
const MOST = 50;

/**
 * Local branches, then remote ones, by name; a remote's HEAD is not a branch to switch to.
 * @param {Git} git
 * @returns {Promise<Branch[]>}
 */
export async function listBranches(git) {
  const remotes = (await git(["remote"])).stdout.split("\n").filter((line) => line !== "");
  const { stdout } = await git([
    "for-each-ref",
    "--format=%(refname:short)%1f%(objectname:short)%1f%(upstream:short)",
    "refs/heads",
    "refs/remotes",
  ]);
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [name = "", sha = "", upstream = ""] = line.split("\x1f");
      const remote = remotes.some((r) => name.startsWith(`${r}/`));
      return { name, remote, detail: upstream ? `${sha} → ${upstream}` : sha };
    })
    .filter((branch) => !branch.name.endsWith("/HEAD"));
}

/**
 * endue.git.branches: a PaletteQuery answered with the open repository's branches whose name (or
 * the repository's) holds every typed word; none without a repository or words.
 * @param {unknown} args
 * @param {{ name: string } | null} repo
 * @param {() => Promise<Branch[]>} list
 * @param {string | null} current The branch HEAD is on.
 */
export async function findBranches(args, repo, list, current) {
  const { query, limit } = /** @type {{ query?: unknown, limit?: unknown }} */ (args ?? {});
  const words = typeof query === "string" ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
  if (!repo || words.length === 0) return { results: [] };
  const n = typeof limit === "number" && Number.isInteger(limit) ? limit : LIMIT;
  const results = (await list())
    .filter((b) => {
      const text = `${b.name} ${repo.name} branch`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .slice(0, Math.min(Math.max(n, 1), MOST))
    .map((b) => ({
      id: b.name,
      title: b.name,
      detail: [repo.name, b.detail, ...(!b.remote && b.name === current ? ["current"] : [])].join(
        " · ",
      ),
      kind: "branch",
      actions: [
        {
          command: "endue.git.checkout",
          title: b.remote ? "Track the branch and switch" : "Switch to the branch",
          args: { ref: b.name },
        },
      ],
    }));
  return { results };
}
