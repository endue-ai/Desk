// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountDom } from "./dom-harness";
import { ROOT, repository } from "./harness";

const commit = (sha: string, parent: string) =>
  `${sha}\x1f${parent}\x1fAda\x1f2026-10-30T09:00:00Z\x1f\x1fcommit ${sha}\x1e\n`;

const withLog = repository({
  "log --topo-order --max-count=2": ({ args }) => ({
    stdout: args.includes("--skip=2") ? commit("a", "") : commit("c", "b") + commit("b", "a"),
  }),
});

function row(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing row ${selector}`);
  return found;
}

function key(target: HTMLElement, value: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
}

describe("Git status DOM", () => {
  it("does not steal focus from outside the tree during refresh", async () => {
    const { host } = await mountDom();
    await host.command("endue.git.status", { path: ROOT });
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await host.command("endue.git.refresh");
    expect(document.activeElement).toBe(outside);
  });

  it("shows a clean summary when there are no changed files", async () => {
    const { host } = await mountDom();
    await host.command("endue.git.status", { path: ROOT });
    expect(document.querySelector("#view")?.textContent).toContain(
      "nothing to commit, working tree clean",
    );
  });

  it("shows only the empty-state row when no repository is open", async () => {
    await mountDom();
    const rows = [...document.querySelectorAll("#view [role=treeitem]")];
    expect(rows.map((el) => el.textContent)).toEqual([
      "No repository open. Run Git: status in a folder.",
    ]);
  });
});

describe("Git log DOM", () => {
  it.each(["Enter", "click", "dblclick"])(
    "loads more on %s without loading a diff",
    async (event) => {
      const { host, git, settle } = await mountDom(withLog);
      await host.command("endue.git.status", { path: ROOT });
      await host.command("endue.git.log");
      const more = row(".row.more");
      if (event === "Enter") {
        key(row('[role="treeitem"][aria-selected="true"]'), "End");
        key(more, "Enter");
      } else {
        more.dispatchEvent(new MouseEvent(event, { bubbles: true }));
      }
      await settle();
      expect(git.of("log").at(-1)).toContain("--skip=2");
      expect(document.querySelectorAll(".row.commit")).toHaveLength(3);
      expect(git.of("diff")).toHaveLength(0);
      expect(git.of("show")).toHaveLength(0);
    },
  );

  it("does nothing on Enter in an empty log", async () => {
    const { host, git, settle } = await mountDom(
      repository({ "log --topo-order": { stdout: "" } }),
    );
    await host.command("endue.git.status", { path: ROOT });
    await host.command("endue.git.log");
    const empty = row(".row.empty");
    expect(empty.textContent).toBe("No commits yet.");
    const logCalls = git.of("log").length;
    key(empty, "Enter");
    await settle();
    expect(git.of("log")).toHaveLength(logCalls);
    expect(git.of("diff")).toHaveLength(0);
    expect(git.of("show")).toHaveLength(0);
  });

  it("rejects a diff in the log when no commit is selected", async () => {
    const { host, git } = await mountDom(repository({ "log --topo-order": { stdout: "" } }));
    await host.command("endue.git.status", { path: ROOT });
    await host.command("endue.git.log");
    await expect(host.command("endue.git.diff")).rejects.toThrow("Select a commit");
    expect(git.of("diff")).toHaveLength(0);
  });

  it("loads a single page for the events in a double-click", async () => {
    const { host, git, settle } = await mountDom(withLog);
    await host.command("endue.git.status", { path: ROOT });
    await host.command("endue.git.log");
    const more = row(".row.more");
    for (const type of ["click", "click", "dblclick"]) {
      more.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    await settle();
    expect(git.of("log").filter((args) => args.includes("--skip=2"))).toHaveLength(1);
    expect(document.querySelectorAll(".row.commit")).toHaveLength(3);
  });
});
