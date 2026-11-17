// Staging, unstaging and discarding a hunk or chosen lines, against the real git program in a
// temporary repository: the patch reaches `git apply -` on stdin, which closes (ADR 0248).
import { afterEach, describe, expect, it } from "vitest";
import type { Item } from "../ui/actions.js";
import { mount } from "./harness";
import { type RealGit, realGit, type TempRepo, tempRepo } from "./real-git";

const LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
const text = (lines: string[]) => `${lines.join("\n")}\n`;
/** Lines 2 and 3 changed near the top, line 18 near the bottom: two hunks. */
const CHANGED = LINES.map((line, i) =>
  i === 1 || i === 2 || i === 17 ? line.toUpperCase() : line,
);

let repo: TempRepo | undefined;
afterEach(() => repo?.remove());

const open = async (answer: { pick: string } = { pick: "yes" }) => {
  repo = tempRepo({ "a.txt": text(LINES) });
  repo.write("a.txt", text(CHANGED));
  const git: RealGit = realGit();
  const invoked: Array<{ args: unknown; result: unknown }> = [];
  const mounted = await mount({
    handlers: git.handlers,
    commands: {
      "desk.palette.pick": () => answer.pick,
      // The desk runs the plugin's own command and keeps it for cmd.undo.
      "endue.git.discard-patch": async (args) => {
        const result = await mounted.host.command("endue.git.discard-patch", args);
        invoked.push({ args, result });
        return result;
      },
    },
  });
  git.attach(mounted.host);
  await mounted.host.command("endue.git.status", { path: repo.root });
  return { ...mounted, real: git, repo, invoked };
};

type Opened = Awaited<ReturnType<typeof open>>;

const showDiff = async (m: Opened, staged = false) => {
  await m.host.command("endue.git.diff", { path: "a.txt", ...(staged ? { staged } : {}) });
  const diff = m.view.diffs.at(-1);
  if (!diff) throw new Error("no diff");
  return diff;
};

/** The marked range of the first hunk whose lines hold `from` and `to`. */
const linesOf = async (m: Opened, staged: boolean, from: string, to: string): Promise<Item> => {
  const diff = await showDiff(m, staged);
  const lines = diff.files[0]?.hunks[0]?.lines ?? [];
  const a = lines.findIndex((l) => l.text === from);
  const b = lines.findIndex((l) => l.text === to);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThanOrEqual(0);
  return { kind: "lines", path: "a.txt", index: 0, from: Math.min(a, b), to: Math.max(a, b) };
};

describe("a hunk", () => {
  it("is staged on its own, and unstaged again", async () => {
    const m = await open();
    const before = (await showDiff(m)).files[0]?.hunks.length;
    expect(before).toBe(2);
    m.view.selected = { kind: "hunk", path: "a.txt", index: 0 };
    const diffs = m.view.diffs.length;
    await m.app.stage();
    expect(m.view.said.at(-1)).toBe("Staged a hunk of a.txt.");
    const cached = m.repo.git("diff", "--cached");
    expect(cached).toContain("+LINE 2");
    expect(cached).not.toContain("LINE 18");
    expect(m.real.writes.at(-1)?.close).toBe(true);
    expect(m.view.diffs.length).toBeGreaterThan(diffs);
    expect(m.view.diffs.at(-1)?.files[0]?.hunks.length).toBe(1);
    expect(m.git.calls).toHaveLength(0);

    await showDiff(m, true);
    m.view.selected = { kind: "line", path: "a.txt", index: 0, line: 0 };
    const statuses = m.view.statuses.length;
    await m.app.unstage();
    expect(m.view.said.at(-1)).toBe("Unstaged a hunk of a.txt.");
    expect(m.repo.git("diff", "--cached")).toBe("");
    expect(m.view.statuses.length).toBeGreaterThan(statuses);
  });

  it("is discarded after asking, and the desk's undo puts it back", async () => {
    const answer = { pick: "no" };
    const m = await open(answer);
    await showDiff(m);
    m.view.selected = { kind: "hunk", path: "a.txt", index: 1 };
    await m.app.discard();
    expect(m.params("cmd.invoke").length).toBeGreaterThan(0);
    expect(m.repo.read("a.txt")).toBe(text(CHANGED));
    expect(m.invoked).toHaveLength(0);

    answer.pick = "yes";
    await m.app.discard();
    expect(m.view.said.at(-1)).toBe("Discarded a hunk of a.txt.");
    const now = m.repo.read("a.txt");
    expect(now).toContain("LINE 2");
    expect(now).not.toContain("LINE 18");
    expect(m.invoked).toHaveLength(1);

    await m.host.command("endue.git.restore-patch", m.invoked[0]);
    expect(m.repo.read("a.txt")).toBe(text(CHANGED));
    expect(m.view.said.at(-1)).toBe("Put back a hunk of a.txt.");
  });

  it("says in git's words why a patch did not apply", async () => {
    const m = await open();
    await showDiff(m);
    m.repo.write("a.txt", text(LINES.map((l) => `${l}!`)));
    m.repo.git("add", "a.txt");
    m.view.selected = { kind: "hunk", path: "a.txt", index: 0 };
    await m.app.stage();
    const said = m.view.said.at(-1) ?? "";
    expect(said).toMatch(/patch/);
    expect(said).not.toMatch(/^(error|fatal):/);
  });
});

describe("chosen lines", () => {
  // The first hunk reads: line 1, -line 2, -line 3, +LINE 2, +LINE 3, line 4, line 5.
  const without23 = LINES.filter((_, i) => i !== 1 && i !== 2);

  it("are staged without the rest of their hunk", async () => {
    const m = await open();
    m.view.selected = await linesOf(m, false, "line 2", "line 3");
    await m.app.stage();
    expect(m.view.said.at(-1)).toBe("Staged 2 lines of a.txt.");
    expect(m.repo.git("show", ":a.txt")).toBe(text(without23));
  });

  it("are unstaged without the rest of their hunk", async () => {
    const m = await open();
    m.repo.git("add", "a.txt");
    m.view.selected = await linesOf(m, true, "LINE 2", "LINE 3");
    await m.app.unstage();
    expect(m.view.said.at(-1)).toBe("Unstaged 2 lines of a.txt.");
    const index = m.repo.git("show", ":a.txt");
    expect(index).toBe(text(CHANGED.filter((_, i) => i !== 1 && i !== 2)));
  });

  it("are discarded from the worktree alone, after asking", async () => {
    const m = await open();
    m.view.selected = await linesOf(m, false, "line 2", "line 3");
    await m.app.discard();
    expect(m.view.said.at(-1)).toBe("Discarded 2 lines of a.txt.");
    const back = [...LINES.slice(0, 3), "LINE 2", "LINE 3", ...CHANGED.slice(3)];
    expect(m.repo.read("a.txt")).toBe(text(back));
    expect(m.params("cmd.invoke").length).toBeGreaterThan(0);
  });
});
