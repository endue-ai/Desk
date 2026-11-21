// Who waits for whom, from each session's blockers (pg_blocking_pids) and the locks: a tree whose
// roots block others without waiting themselves, each waiter under every session it waits for,
// with the lock it waits on and what its blocker holds on the same object. The longest wait comes
// first; a session already on the path (a cycle, a deadlock about to be broken) is drawn once more
// without its children. Without a lock's wait start (PostgreSQL 13) the waiting statement's age
// stands for its wait. No DOM.

/**
 * @typedef {import("./model.js").Session} Session
 * @typedef {{
 *   pid: number, type: string, mode: string, granted: boolean, database: string | null,
 *   target: string, waitMs: number | null,
 * }} Lock
 *   `target` names what it is on: a relation (with its page and tuple), a transaction, or its type.
 * @typedef {{
 *   pid: number, session: Session | undefined, lock: Lock | undefined, held: Lock | undefined,
 *   waitMs: number | null, longest: number, children: TreeNode[], again: boolean,
 * }} TreeNode
 *   `longest` is the longest wait in it and under it; `again`, a session already on its path.
 */

/** A lock in words: "ShareLock on transaction 731". */
export const lockText = (/** @type {Lock} */ lock) => `${lock.mode} on ${lock.target}`;

const longestFirst = (/** @type {TreeNode} */ a, /** @type {TreeNode} */ b) =>
  b.longest - a.longest || a.pid - b.pid;

/**
 * @param {Session[]} sessions
 * @param {Lock[]} locks
 * @returns {TreeNode[]}
 */
export function blockingTree(sessions, locks) {
  const byPid = new Map(sessions.map((s) => [s.pid, s]));
  const waiting = sessions.filter((s) => s.blockedBy.length > 0);
  if (waiting.length === 0) return [];
  /** @type {Set<number>} */
  const reached = new Set();

  /** @returns {TreeNode} */
  const build = (
    /** @type {number} */ pid,
    /** @type {number | undefined} */ blocker,
    /** @type {Set<number>} */ path,
  ) => {
    reached.add(pid);
    const session = byPid.get(pid);
    const waits = (session?.blockedBy.length ?? 0) > 0;
    const lock = waits ? locks.find((l) => l.pid === pid && !l.granted) : undefined;
    const held =
      lock && blocker !== undefined
        ? locks.find(
            (l) =>
              l.pid === blocker && l.granted && l.type === lock.type && l.target === lock.target,
          )
        : undefined;
    const again = path.has(pid);
    const next = new Set(path).add(pid);
    const children = again
      ? []
      : waiting
          .filter((w) => w.blockedBy.includes(pid))
          .map((w) => build(w.pid, pid, next))
          .sort(longestFirst);
    const waitMs = waits ? (lock?.waitMs ?? session?.queryMs ?? null) : null;
    const longest = Math.max(waitMs ?? 0, ...children.map((c) => c.longest));
    return { pid, session, lock, held, waitMs, longest, children, again };
  };

  const heads = [...new Set(waiting.flatMap((w) => w.blockedBy))]
    .filter((pid) => !byPid.get(pid)?.blockedBy.length)
    .sort((a, b) => a - b);
  const roots = heads.map((pid) => build(pid, undefined, new Set()));
  for (const w of waiting) if (!reached.has(w.pid)) roots.push(build(w.pid, undefined, new Set()));
  return roots.sort(longestFirst);
}
