// The surface's DOM wired as index.html lays it out, on a fake document (no jsdom): the keys go to
// where the focus is, the overview's lines lead somewhere, marks show their bar, the toolbar sets
// the query, the pane opens beside the list with its tabs, and resource use patches the rows.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detailExtras, firstOf, inspectModel } from "../ui/inspect.js";
import { hints } from "../ui/keys.js";
import { overviewModel } from "../ui/overview.js";
import { parseStats, parseVersion } from "../ui/parse-engine.js";
import { parseContainers, parseProjects } from "../ui/parse-list.js";
import { createHistory, parseStatsLine } from "../ui/stats.js";
import { createView } from "../ui/view.js";
import { documentOf, type FakeNode } from "./fake-dom";
import { DB_ID, INSPECT, PROJECTS, PS, STATS, VERSION } from "./fixtures";
import { STATS_STREAM } from "./fixtures-more";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const prefs = { query: "", sort: { key: "name", desc: false } };

function surface() {
  const doc = documentOf(html);
  const acts: unknown[][] = [];
  const view = createView(doc, (...args) => acts.push(args));
  for (const name of ["containers", "compose", "images", "volumes", "networks"])
    view.prefs(name, prefs);
  const byId = (id: string) => doc.getElementById(id) as unknown as FakeNode;
  const cursor = () => byId("view").querySelector("div.is-cursor");
  return { doc, view, acts, byId, cursor };
}

describe("the surface", () => {
  it("opens on the overview: Enter on a line opens a list filtered, or runs its action", () => {
    const { view, acts, byId, cursor } = surface();
    const containers = parseContainers(PS);
    view.show("overview", hints("overview"));
    view.list(
      "overview",
      overviewModel({
        containers,
        projects: parseProjects(PROJECTS),
        version: parseVersion(VERSION),
      }),
    );
    expect(byId("toolbar").hidden).toBe(true);
    expect(byId("tab-overview").attributes["aria-selected"]).toBe("true");
    expect(cursor()?.textContent).toMatch(/Docker 29\.8\.1/);
    cursor()?.focus();
    cursor()?.key("Enter");
    expect(acts.at(-1)).toEqual(["refresh"]);
    for (let i = 0; i < 2; i++) cursor()?.key("ArrowDown");
    cursor()?.key("Enter");
    expect(acts.at(-1)).toEqual(["goto", "containers", "is:running"]);
    cursor()?.key("c");
    expect(acts.at(-1)).toEqual(["switchContext"]);
    cursor()?.key("4");
    expect(acts.at(-1)).toEqual(["images"]);
    // Mod chords are the desk's.
    const chord = cursor()?.fire("keydown", {
      key: "k",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    });
    expect(chord?.defaultPrevented).toBe(false);
  });

  it("marks containers with Space, shows the marks bar, and searches from the toolbar", () => {
    const { doc, view, acts, byId, cursor } = surface();
    view.show("containers", hints("containers"));
    view.list("containers", {
      containers: parseContainers(PS),
      stats: parseStats(STATS),
      all: true,
    });
    expect(byId("toolbar").hidden).toBe(false);
    expect(byId("chips").children.map((c) => c.textContent.trim())).toEqual([
      "All",
      "Running",
      "Unhealthy",
      "Stopped",
    ]);
    cursor()?.focus();
    cursor()?.key("ArrowDown");
    cursor()?.key(" ");
    cursor()?.key(" ");
    expect(view.marked().map((i) => (i.kind === "container" ? i.name : ""))).toEqual([
      "shop-db-1",
      "shop-web-1",
    ]);
    expect(byId("marks").hidden).toBe(false);
    expect(byId("marks-count").textContent.trim()).toBe("2 marked");
    expect(byId("marks-actions").children.map((b) => b.dataset.act)).toEqual([
      "start",
      "stop",
      "restart",
      "togglePause",
      "remove",
    ]);
    byId("marks-actions").children[1]?.fire("click");
    expect(acts.at(-1)).toEqual(["stop"]);
    cursor()?.key("Escape");
    expect(view.marked()).toEqual([]);
    expect(byId("marks").hidden).toBe(true);
    const search = byId("search");
    search.value = "is:running";
    search.fire("input");
    expect(acts.at(-1)).toEqual(["query", "is:running"]);
    byId("chips").children[3]?.fire("click");
    expect(acts.at(-1)).toEqual(["query", "is:stopped"]);
    cursor()?.key("/");
    expect(doc.activeElement).toBe(search);
  });

  it("opens the pane beside the list, switches its tabs, and patches resource use in place", () => {
    const { doc, view, acts, byId } = surface();
    view.show("containers", hints("containers"));
    view.list("containers", { containers: parseContainers(PS), stats: new Map(), all: true });
    const json = firstOf(INSPECT);
    const detail = { ...inspectModel(json), ...detailExtras(json) };
    const item = {
      kind: "container",
      id: DB_ID,
      name: "shop-db-1",
      state: "running",
      project: "shop",
    } as const;
    const tabs = ["info", "logs", "stats", "env", "ports", "json", "files"];
    view.pane({
      kind: "container",
      key: `container:${DB_ID}`,
      title: "shop-db-1",
      subtitle: "postgres:17",
      state: "running",
      tab: "env",
      tabs,
      item,
      detail,
      files: null,
    });
    view.show("inspect", hints("inspect"));
    expect(byId("pane").hidden).toBe(false);
    expect(byId("split").classList.contains("with-pane")).toBe(true);
    expect(byId("pane-tabs").children.map((t) => t.textContent.trim())).toEqual([
      "Info",
      "Logs",
      "Stats",
      "Env",
      "Ports",
      "Inspect",
      "Files",
    ]);
    expect(byId("pane-body").textContent).toMatch(/POSTGRES_PASSWORD\s+••••••/);
    expect(byId("pane-actions").children.map((b) => b.dataset.act)).toEqual([
      "stop",
      "restart",
      "shell",
      "remove",
    ]);
    const row = byId("pane-body").querySelector("div.is-cursor");
    row?.focus();
    row?.key("]");
    expect(acts.at(-1)).toEqual(["paneTab", "ports"]);
    expect(acts).toContainEqual(["focused", "pane"]);
    byId("pane-tabs").children[0]?.fire("click");
    expect(acts.at(-1)).toEqual(["paneTab", "info"]);
    row?.key("q");
    expect(acts.at(-1)).toEqual(["back"]);
    // A click on the pane's Stop (which WebKit does not focus) acts on the pane's container.
    byId("view").querySelector("div.is-cursor")?.focus();
    byId("pane-actions").children[0]?.fire("click");
    expect(acts.slice(-2)).toEqual([["focused", "pane"], ["stop"]]);
    const history = createHistory({ spacing: () => 1000 });
    for (const raw of STATS_STREAM) {
      const sample = parseStatsLine(raw);
      if (sample) history.feed(sample, 0);
    }
    view.stats(
      Object.assign((id: string) => history.snapshot(id), { latest: () => history.latest() }),
    );
    const db = byId("view")
      .all("div.container")
      .find((r) => r.textContent.includes("postgres:17"));
    expect(db?.querySelector("span.cpu")?.textContent.trim()).toBe("50%");
    expect(db?.querySelector("svg")?.attributes.class).toBe("spark cpu");
    view.pane(null);
    expect(byId("pane").hidden).toBe(true);
    void doc;
  });

  it("says what is wrong with a way to try again, on the overview's card or the banner", () => {
    const { view, acts, byId } = surface();
    view.show("overview", hints("overview"));
    view.list("overview", overviewModel({ version: parseVersion(VERSION) }));
    view.header({ context: "build", engine: "", problem: "Docker is not running.", live: false });
    // The overview says it in its engine card; the banner would say it twice.
    expect(byId("problem").hidden).toBe(true);
    expect(byId("view").querySelector("div.desk-error")?.textContent).toMatch(
      /Docker is not running/,
    );
    view.show("images", hints("images"));
    expect(byId("problem").hidden).toBe(false);
    expect(byId("problem-text").textContent.trim()).toBe("Docker is not running.");
    expect(byId("context").hidden).toBe(false);
    byId("problem").querySelector("button")?.fire("click");
    expect(acts.at(-1)).toEqual(["refresh"]);
    view.logs({
      title: "docker logs: web",
      target: { kind: "container", id: "w", name: "web" },
      lines: [{ n: 0, stream: "stderr", time: "", source: "", text: "boom" }],
      first: 0,
      follow: true,
      running: true,
      ended: "",
      generation: 1,
      timestamps: false,
      filter: "",
    });
    expect(byId("log-lines").children[0]?.className).toBe("line stderr");
    expect(byId("log-follow").attributes["aria-pressed"]).toBe("true");
  });
});
