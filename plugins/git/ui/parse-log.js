// The log: parsing `git log` records and laying the commits out as a graph of lanes, the way gitk
// and most Git front ends draw it. Pure functions: the view only draws what `layoutGraph` returns.

/**
 * @typedef {"head" | "branch" | "remote" | "tag"} RefKind
 * @typedef {{ name: string, kind: RefKind, current: boolean }} Ref
 * @typedef {{ sha: string, parents: string[], author: string, date: string, refs: Ref[], subject: string }} Commit
 * @typedef {{ from: number, to: number }} Join A lane that ends here by bending into another below the dot.
 * @typedef {{ sha: string, lane: number, before: (string | null)[], after: (string | null)[], parentLanes: number[], joins: Join[] }} Row
 */

/** The format `git log` is asked for: fields split by a unit separator, records by a record separator. */
export const LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e";

/**
 * @param {string} text The output of `git log --format=LOG_FORMAT`.
 * @param {string[]} [remotes] Remote names, so `origin/main` is told from a local `feature/x`.
 * @returns {Commit[]}
 */
export function parseLog(text, remotes = []) {
  return text
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record !== "")
    .map((record) => {
      const [sha = "", parents = "", author = "", date = "", decoration = "", subject = ""] =
        record.split("\x1f");
      return {
        sha,
        parents: parents === "" ? [] : parents.split(" "),
        author,
        date,
        refs: parseRefs(decoration, remotes),
        subject,
      };
    });
}

/**
 * `%D`: "HEAD -> main, origin/main, tag: v1" into refs. HEAD alone is a detached head.
 * @param {string} decoration
 * @param {string[]} [remotes]
 * @returns {Ref[]}
 */
export function parseRefs(decoration, remotes = []) {
  if (decoration === "") return [];
  return decoration.split(", ").map((item) => {
    if (item === "HEAD") return { name: "HEAD", kind: "head", current: true };
    const current = item.startsWith("HEAD -> ");
    const name = current ? item.slice("HEAD -> ".length) : item;
    if (name.startsWith("tag: ")) return { name: name.slice(5), kind: "tag", current };
    const remote = remotes.some((r) => name.startsWith(`${r}/`));
    return { name, kind: remote ? "remote" : "branch", current };
  });
}

/**
 * Lay the commits (topological order, newest first) out on lanes. A row's `before` is what each lane
 * waits for above the commit's dot, `after` what it waits for below; lanes waiting for this commit
 * curve into its dot, its parents fan out from the dot to `parentLanes`, and `joins` are lanes to the
 * right that bend into a lane on the left because both wait for the same parent. A shared parent
 * always lives on the leftmost lane, so the first-parent line of a branch runs straight.
 * @param {Pick<Commit, "sha" | "parents">[]} commits
 * @returns {Row[]}
 */
export function layoutGraph(commits) {
  /** @type {(string | null)[]} */
  const lanes = [];
  const free = () => {
    const empty = lanes.indexOf(null);
    return empty < 0 ? lanes.length : empty;
  };
  /** @type {Row[]} */
  const rows = [];
  for (const commit of commits) {
    const before = lanes.slice();
    let lane = lanes.indexOf(commit.sha);
    if (lane < 0) {
      // A tip nobody below waited for: a branch head, or a commit beyond the loaded range.
      lane = free();
    }
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.sha) lanes[i] = null;
    const parentLanes = [];
    /** @type {Join[]} */
    const joins = [];
    const [first, ...rest] = commit.parents;
    if (first !== undefined) {
      const waiting = lanes.indexOf(first);
      if (waiting < 0 || waiting === lane) {
        lanes[lane] = first;
        parentLanes.push(lane);
      } else if (waiting < lane) {
        // The parent is waited for on the left: this lane ends and bends into it.
        parentLanes.push(waiting);
      } else {
        // Waited for on the right: pull that lane over, so this line stays where it is.
        lanes[waiting] = null;
        lanes[lane] = first;
        parentLanes.push(lane);
        joins.push({ from: waiting, to: lane });
      }
    }
    for (const parent of rest) {
      let target = lanes.indexOf(parent);
      if (target < 0) {
        target = free();
        lanes[target] = parent;
      }
      parentLanes.push(target);
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ sha: commit.sha, lane, before, after: lanes.slice(), parentLanes, joins });
  }
  return rows;
}

/** How many lanes the widest row needs. */
export function laneCount(/** @type {Row[]} */ rows) {
  return rows.reduce(
    (most, row) => Math.max(most, row.lane + 1, row.before.length, row.after.length),
    1,
  );
}

/**
 * "just now", "5 min ago", "3 h ago", "2 d ago", or the date for anything older than a month.
 * @param {string} iso
 * @param {number} [now]
 */
export function relativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d ago`;
  return iso.slice(0, 10);
}
