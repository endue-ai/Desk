// @vitest-environment jsdom
// Each view keeps its own cursor (#160, finding 10): a log or a diff that opens starts on its first
// row, whatever row the view before it was on; `q` in a commit's diff goes back to the log it came
// from, on the same commit; the status keeps its row across both.
import { describe, expect, it } from "vitest";
import { mountDom } from "./dom-harness";
import { ROOT, repository, z } from "./harness";

const DIRTY = z(
  "# branch.oid 1111111111111111111111111111111111111111",
  "# branch.head main",
  "1 .M N... 100644 100644 100644 1 2 a.txt",
  "1 .M N... 100644 100644 100644 1 2 b.txt",
  "? c.txt",
);

const commit = (sha: string, parent: string) =>
  `${sha}\x1f${parent}\x1fAda\x1f2026-10-30T09:00:00Z\x1f\x1fcommit ${sha}\x1e\n`;

const PATCH = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,2 +1,3 @@",
  " one",
  "-two",
  "+2",
  "+three",
  "",
].join("\n");

const script = repository({
  "status --porcelain": { stdout: DIRTY },
  "log --topo-order": { stdout: commit("e", "d") + commit("d", "c") + commit("c", "b") },
  show: { stdout: PATCH },
  diff: { stdout: PATCH },
});

const selected = () =>
  document.querySelector<HTMLElement>('#view [role="treeitem"][aria-selected="true"]');

function press(value: string) {
  const target = selected() ?? document.getElementById("view");
  target?.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
}

/** Click the status row whose path is `path`. */
function clickPath(path: string) {
  const rows = [...document.querySelectorAll<HTMLElement>("#view .row")];
  const found = rows.find((el) => el.querySelector(".path")?.textContent === path);
  if (!found) throw new Error(`Missing row ${path}`);
  found.click();
}

const shaOf = (el: HTMLElement | null) => el?.querySelector(".sha")?.textContent;

describe("Git: each view's place", () => {
  it("the log opens on its newest commit, whatever row the status was on", async () => {
    const { host, settle } = await mountDom(script, 200);
    await host.command("endue.git.status", { path: ROOT });
    clickPath("b.txt");
    expect(Number(selected()?.dataset.index)).toBeGreaterThan(2);
    press("l");
    await settle();
    expect(document.getElementById("view")?.getAttribute("aria-label")).toBe("Git log");
    expect(shaOf(selected())).toBe("e");
    expect(selected()?.dataset.index).toBe("0");
  });

  it("q in a commit's diff goes back to the log, on that commit; q there goes to the status", async () => {
    const { host, settle } = await mountDom(script, 200);
    await host.command("endue.git.status", { path: ROOT });
    clickPath("b.txt");
    press("l");
    await settle();
    press("ArrowDown");
    expect(shaOf(selected())).toBe("d");
    press("Enter");
    await settle();
    expect(document.getElementById("view")?.getAttribute("aria-label")).toBe("Git diff");
    expect(selected()?.dataset.index).toBe("0");
    press("q");
    await settle();
    expect(document.getElementById("view")?.getAttribute("aria-label")).toBe("Git log");
    expect(shaOf(selected())).toBe("d");
    press("q");
    await settle();
    expect(document.getElementById("view")?.getAttribute("aria-label")).toBe("Git status");
    expect(selected()?.querySelector(".path")?.textContent).toBe("b.txt");
  });

  it("q in a file's diff goes back to the status, on that file", async () => {
    const { host, settle } = await mountDom(script, 200);
    await host.command("endue.git.status", { path: ROOT });
    clickPath("a.txt");
    press("d");
    await settle();
    expect(document.getElementById("view")?.getAttribute("aria-label")).toBe("Git diff");
    expect(selected()?.dataset.index).toBe("0");
    press("q");
    await settle();
    expect(document.getElementById("view")?.getAttribute("aria-label")).toBe("Git status");
    expect(selected()?.querySelector(".path")?.textContent).toBe("a.txt");
  });

  it("a log opened again starts on its newest commit", async () => {
    const { host, settle } = await mountDom(script, 200);
    await host.command("endue.git.status", { path: ROOT });
    clickPath("a.txt");
    press("l");
    await settle();
    press("End");
    press("q");
    await settle();
    press("l");
    await settle();
    expect(shaOf(selected())).toBe("e");
  });
});
