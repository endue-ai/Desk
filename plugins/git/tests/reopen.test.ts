// A start of the desk brings Git back with the repository it had (#160, finding 10): the surface's
// state lives only as long as the desk runs, so a cold start reopens the repository the store's
// recent list holds first, the one opened last. A reload of the surface keeps its own state.
import { describe, expect, it } from "vitest";
import { mount, ROOT, repository } from "./harness";

describe("Git: a start", () => {
  it("opens the repository opened last, without asking", async () => {
    const picks: unknown[] = [];
    const { view, git } = await mount({
      store: { recent: [ROOT, "/Users/me/other"] },
      commands: {
        "desk.palette.pick": (args) => {
          picks.push(args);
          return "";
        },
      },
    });
    expect(git.calls[0]).toMatchObject({ args: ["rev-parse", "--show-toplevel"], cwd: ROOT });
    expect(view.headers.at(-1)?.repo).toEqual({ root: ROOT, name: "Desk" });
    expect(view.statuses.at(-1)?.repo?.root).toBe(ROOT);
    expect(view.shown.at(-1)).toBe("status");
    expect(view.said).toEqual([]);
    expect(picks).toEqual([]);
  });

  it("Git: status after the start shows that repository at once", async () => {
    const { host, view } = await mount({ store: { recent: [ROOT] } });
    await expect(host.command("endue.git.status")).resolves.toBe(ROOT);
    expect(view.headers.at(-1)?.repo?.root).toBe(ROOT);
  });

  it("with nothing remembered it shows the empty state and runs no git", async () => {
    const { view, git } = await mount();
    expect(git.calls).toEqual([]);
    expect(view.statuses.at(-1)?.repo).toBeNull();
    expect(view.shown.at(-1)).toBe("status");
  });

  it("a repository that is gone leaves the empty state and says why", async () => {
    const { view } = await mount({
      store: { recent: ["/Users/me/gone"] },
      script: repository({
        "rev-parse --show-toplevel": { code: 128, stderr: "fatal: not a git repository\n" },
      }),
    });
    expect(view.headers.at(-1)?.repo).toBeNull();
    expect(view.statuses.at(-1)?.repo).toBeNull();
    expect(view.said.at(-1)).toBe("Not a Git repository: /Users/me/gone.");
  });

  it("a reload keeps what the surface had, even no repository", async () => {
    const { git, view } = await mount({
      store: { recent: [ROOT] },
      state: { root: null, view: "status" },
    });
    expect(git.calls).toEqual([]);
    expect(view.headers.at(-1)?.repo).toBeNull();
  });
});
