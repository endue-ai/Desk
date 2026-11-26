// Reflog recovery shared by the keyboard and command registry.
import { h } from "./dom.js";
import { shortSha } from "./format.js";
import { createHistoryOps } from "./ops-history.js";
import { confirm } from "./overlay.js";

/** @param {import("./app.js").App} app @param {HTMLElement} layer */
export function createUndoActions(app, layer) {
  /** @type {Map<string, { before: string, after: string }[]>} */
  const stack = new Map();
  const code = (/** @type {string} */ text) => h("code", null, text);
  const checkIndex = async (/** @type {string} */ cwd) => {
    const staged = await app.git.run(["diff", "--cached", "--quiet", "--"], { cwd, ok: [1] });
    if (staged.code !== 0)
      throw new Error("Unstage or commit the staged changes before moving HEAD.");
  };
  const stackKey = async (/** @type {string} */ cwd) => {
    const ref = await app.git.run(["symbolic-ref", "--quiet", "HEAD"], { cwd, ok: [1] });
    return `${cwd}\0${ref.stdout.trim()}`;
  };

  return {
    async undo({ agent = false } = {}) {
      const cwd = app.get().repo;
      if (!cwd) throw new Error("No repository is open in Git Studio.");
      const ops = createHistoryOps(app.git, cwd);
      const [now, before] = await ops.reflog(2).catch(() => []);
      if (!now || !before) {
        if (agent) throw new Error("Nothing to undo.");
        return app.say("Nothing to undo.");
      }
      const moved = /^checkout: moving from (\S+) to (\S+)$/.exec(now.message);
      const back = moved?.[1];
      if (
        !agent &&
        !(await confirm(layer, {
          title: back ? "Undo the switch?" : "Undo the last change?",
          icon: "undo",
          body: back
            ? h("span", null, "Switch back to ", code(back), ".")
            : h(
                "span",
                null,
                "Last: ",
                code(now.message),
                ". HEAD goes back to ",
                code(shortSha(before.sha)),
                "; uncommitted changes stay.",
              ),
          confirm: "Undo",
        }))
      )
        return;
      return app.act(
        back ? `Switched back to ${back}` : `Undid “${now.message}”`,
        async () => {
          const [current, previous] = await ops.reflog(2);
          if (
            app.get().repo !== cwd ||
            current?.sha !== now.sha ||
            current.message !== now.message ||
            previous?.sha !== before.sha
          )
            throw new Error("The repository's reflog changed.");
          if (back) {
            await ops.switchTo(back);
            const { stdout } = await app.git.run(["rev-parse", "HEAD"], { cwd });
            return { head: stdout.trim() };
          }
          await checkIndex(cwd);
          const key = await stackKey(cwd);
          await ops.reset(before.sha, "keep");
          const entries = stack.get(key) ?? [];
          entries.push({ before: before.sha, after: now.sha });
          stack.set(key, entries);
          return { head: before.sha };
        },
        { propagate: agent },
      );
    },
    async redo({ agent = false } = {}) {
      const cwd = app.get().repo;
      if (!cwd) throw new Error("No repository is open in Git Studio.");
      const entries = stack.get(await stackKey(cwd));
      const entry = entries?.at(-1);
      if (!entry) {
        if (agent) throw new Error("Nothing to redo.");
        return app.say("Nothing to redo.");
      }
      return app.act(
        `Redid: HEAD is at ${shortSha(entry.after)} again`,
        async () => {
          const { stdout } = await app.git.run(["rev-parse", "HEAD"], { cwd });
          if (stdout.trim() !== entry.before) throw new Error("HEAD moved after Undo.");
          await checkIndex(cwd);
          await createHistoryOps(app.git, cwd).reset(entry.after, "keep");
          entries?.pop();
          return { head: entry.after };
        },
        { propagate: agent },
      );
    },
  };
}
