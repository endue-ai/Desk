// The conflict tool's model against the real git: a merge that conflicts in two places is read into
// chunks, a choice per conflict composes the file, and saving writes it, stages it and clears the
// conflict, all without touching the file system directly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compose, createConflicts, hasMarkers, parseMerged } from "../ui/conflict.js";
import { createHistoryOps } from "../ui/ops-history.js";
import { loadSnapshot } from "../ui/repo.js";
import { realGit, tempRepo } from "./real-git";

const MERGED = [
  "top",
  "<<<<<<< ours",
  "mine",
  "||||||| base",
  "old",
  "=======",
  "yours",
  ">>>>>>> theirs",
  "end",
  "",
].join("\n");

describe("parseMerged and compose", () => {
  it("splits diff3 output into agreed lines and conflicts", () => {
    const { chunks, conflicts } = parseMerged(MERGED);
    expect(conflicts).toBe(1);
    expect(chunks).toEqual([
      { kind: "same", lines: ["top"] },
      { kind: "conflict", index: 0, ours: ["mine"], base: ["old"], theirs: ["yours"] },
      { kind: "same", lines: ["end"] },
    ]);
  });

  it("composes each choice, and keeps markers for an unchosen conflict", () => {
    const parsed = parseMerged(MERGED);
    const file = {
      path: "x",
      mode: "100644",
      stages: { 1: undefined, 2: undefined, 3: undefined },
      binary: false,
      ...parsed,
    };
    expect(compose(file, new Map([[0, "theirs"]]))).toBe("top\nyours\nend\n");
    expect(compose(file, new Map([[0, "both"]]))).toBe("top\nmine\nyours\nend\n");
    expect(compose(file, new Map([[0, "both-theirs-first"]]))).toBe("top\nyours\nmine\nend\n");
    expect(compose(file, new Map([[0, "none"]]))).toBe("top\nend\n");
    expect(compose(file, new Map(), new Map([[0, ["merged by hand"]]]))).toBe(
      "top\nmerged by hand\nend\n",
    );
    expect(hasMarkers(compose(file, new Map()))).toBe(true);
  });
});

describe("a real conflict", () => {
  let repo: Awaited<ReturnType<typeof tempRepo>>;
  beforeEach(async () => {
    repo = await tempRepo();
    repo.write("a.txt", "1\nsame\n2\nsame\n3\n");
    await repo.git("commit", "-q", "-am", "Base");
    const ops = createHistoryOps(realGit, repo.root);
    await ops.createBranch("side", "HEAD", { checkout: true });
    repo.write("a.txt", "1 side\nsame\n2\nsame\n3 side\n");
    await repo.git("commit", "-q", "-am", "Side");
    await ops.switchTo("main");
    repo.write("a.txt", "1 main\nsame\n2\nsame\n3 main\n");
    await repo.git("commit", "-q", "-am", "Main");
    await ops.merge("side").catch(() => {});
  });
  afterEach(() => repo.done());

  it("reads two conflicts, saves a resolution and stages it", async () => {
    const conflicts = createConflicts(realGit, repo.root);
    const file = await conflicts.load("a.txt");
    expect(file.conflicts).toBe(2);
    expect(file.mode).toBe("100644");
    const blocks = file.chunks.filter((c) => c.kind === "conflict");
    expect(blocks.map((c) => (c.kind === "conflict" ? [c.ours, c.theirs] : null))).toEqual([
      [["1 main"], ["1 side"]],
      [["3 main"], ["3 side"]],
    ]);
    const text = compose(
      file,
      new Map([
        [0, "ours"],
        [1, "theirs"],
      ]),
    );
    await conflicts.save(file, text);
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("1 main\nsame\n2\nsame\n3 side\n");
    const s = await loadSnapshot(realGit, repo.root);
    expect(s.status.conflicts).toEqual([]);
    expect(s.status.staged.map((f) => f.path)).toEqual(["a.txt"]);
    expect(s.operation).toBe("merge");
    await createHistoryOps(realGit, repo.root).proceed("merge", "continue");
    expect((await loadSnapshot(realGit, repo.root)).operation).toBeNull();
  });
});
