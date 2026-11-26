import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "./harness";
import { realGit, type TempRepo, tempRepo } from "./real-git";

const repos: TempRepo[] = [];
const add = () => {
  const repo = tempRepo({ "work.txt": "the base\n", "index.txt": "index base\n" });
  repos.push(repo);
  return repo;
};
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});

async function opened(repo: TempRepo, pick: { answer: string }) {
  const real = realGit();
  const m = await mount({
    handlers: real.handlers,
    commands: {
      "desk.palette.pick": () => pick.answer,
    },
  });
  real.attach(m.host);
  await m.host.command("endue.git.status", { path: repo.root });
  return {
    ...m,
    get entries() {
      const args = m.ran("endue.git.discard-files").at(-1);
      return (m.params("cmd.answer") as Array<{ result?: { token?: string } }>).flatMap(
        ({ result }) => (result?.token ? [{ args, result }] : []),
      );
    },
  };
}

describe("reversible whole-file discard", () => {
  it("keeps a refusal, then restores exactly the original repository without changing its index", async () => {
    const repo = add();
    const other = add();
    repo.write("work.txt", "staged copy\n");
    repo.git("add", "--", "work.txt");
    repo.write("work.txt", "working copy\n");
    const pick = { answer: "no" };
    const m = await opened(repo, pick);
    await m.host.command("endue.git.discard", { path: "work.txt" });
    expect(repo.read("work.txt")).toBe("working copy\n");
    expect(m.entries).toHaveLength(0);
    pick.answer = "yes";
    await m.host.command("endue.git.discard", { path: "work.txt" });
    expect(m.ran("desk.palette.pick")).toHaveLength(2);
    expect(repo.read("work.txt")).toBe("staged copy\n");
    expect(m.entries).toHaveLength(1);
    await m.host.command("endue.git.status", { path: other.root });
    await m.host.command("endue.git.restore-files", m.entries[0]);
    expect(repo.read("work.txt")).toBe("working copy\n");
    expect(repo.git("show", ":work.txt")).toBe("staged copy\n");
    expect(other.read("work.txt")).toBe("the base\n");
  });

  it("recovers an untracked binary file without overwriting a path reused after discard", async () => {
    const repo = add();
    const path = join(repo.root, "sample.bin");
    const original = Buffer.from([0, 1, 4, 255]);
    writeFileSync(path, original);
    const m = await opened(repo, { answer: "yes" });
    await m.host.command("endue.git.discard", { path: "sample.bin" });
    expect(existsSync(path)).toBe(false);
    expect(m.entries).toHaveLength(1);
    writeFileSync(path, Buffer.from([0, 19, 23]));
    await expect(m.host.command("endue.git.restore-files", m.entries[0])).rejects.toThrow();
    expect(readFileSync(path)).toEqual(Buffer.from([0, 19, 23]));
    repo.git("clean", "-fq", "--", "sample.bin");
    await m.host.command("endue.git.restore-files", m.entries[0]);
    expect(readFileSync(path)).toEqual(original);
  });

  it("discards and restores a selected group of untracked files as one undo entry", async () => {
    const repo = add();
    repo.write("extra.txt", "spare text\n");
    repo.write("another.txt", "other text\n");
    const m = await opened(repo, { answer: "yes" });
    m.view.selected = { kind: "section", section: "untracked" };
    await m.host.command("endue.git.discard");
    expect(repo.git("ls-files", "--others", "--exclude-standard")).toBe("");
    expect(m.entries).toHaveLength(1);
    expect(m.ran("desk.palette.pick")).toHaveLength(1);
    await m.host.command("endue.git.restore-files", m.entries[0]);
    expect(repo.read("extra.txt")).toBe("spare text\n");
    expect(repo.read("another.txt")).toBe("other text\n");
  });
});
