import { afterEach, describe, expect, it } from "vitest";
import { mount, repository } from "./harness";
import { realGit, type TempRepo, tempRepo } from "./real-git";

const repos: TempRepo[] = [];
const add = (files: Record<string, string>) => {
  const repo = tempRepo(files);
  repos.push(repo);
  return repo;
};
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});

async function opened(repo: TempRepo) {
  const git = realGit();
  const m = await mount({ handlers: git.handlers, script: repository() });
  git.attach(m.host);
  await m.host.command("endue.git.status", { path: repo.root });
  return m;
}

describe("Git agent tools", () => {
  it("reads commits, branch data and diff text without opening another buffer", async () => {
    const repo = add({ "a.txt": "old\n" });
    repo.git("branch", "feature");
    repo.write("a.txt", "new\n");
    const m = await opened(repo);
    const openedViews = [...m.view.shown];
    await expect(
      m.host.command("endue.git.commits", { count: 1, skip: 0, all: true }),
    ).resolves.toMatchObject([{ subject: "start" }]);
    const branches = await m.host.command("endue.git.branches", {});
    expect(branches).toEqual(
      expect.arrayContaining([{ name: "feature", remote: false, detail: expect.any(String) }]),
    );
    await expect(m.host.command("endue.git.diff-text", { path: "a.txt" })).resolves.toMatchObject({
      text: expect.stringContaining("+new"),
      truncated: false,
    });
    expect(m.view.shown).toEqual(openedViews);
  });

  it("reads another repository without moving the window or storing a recent path", async () => {
    const first = add({ "one.txt": "first\n" });
    const second = add({ "two.txt": "second\n" });
    second.git("switch", "-c", "other");
    const m = await opened(first);
    const initial = m.host.state;
    const recent = m.store.recent;
    const shown = [...m.view.shown];
    const stored = [...m.params("store.set")];
    await expect(m.host.command("endue.git.state", { path: second.root })).resolves.toMatchObject({
      branch: "other",
    });
    expect(m.host.state).toEqual(initial);
    expect(m.store.recent).toEqual(recent);
    expect(m.params("store.set")).toEqual(stored);
    expect(m.view.shown).toEqual(shown);
  });

  it("makes and pops a named stash, then drops a specified stash", async () => {
    const repo = add({ "a.txt": "old\n" });
    const m = await opened(repo);
    repo.write("a.txt", "new\n");
    await expect(
      m.host.command("endue.git.stash", { message: "work steered by the agent" }),
    ).resolves.toMatchObject({ ref: "stash@{0}" });
    expect(repo.read("a.txt")).toBe("old\n");
    await m.host.command("endue.git.stash-pop", { ref: "stash@{0}" });
    expect(repo.read("a.txt")).toBe("new\n");
    await m.host.command("endue.git.stash", { message: "later" });
    await m.host.command("endue.git.stash-drop", { ref: "stash@{0}" });
    expect(repo.git("stash", "list")).toBe("");
  });
});
