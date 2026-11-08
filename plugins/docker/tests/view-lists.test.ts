import { describe, expect, it } from "vitest";
import { overviewModel } from "../ui/overview.js";
import { parseDiskUse, parseStats, parseVersion } from "../ui/parse-engine.js";
import {
  parseContainers,
  parseImages,
  parseNetworks,
  parseProjects,
  parseVolumes,
} from "../ui/parse-list.js";
import { fillMetrics } from "../ui/sparkline.js";
import { createHistory, parseStatsLine } from "../ui/stats.js";
import { createTree } from "../ui/tree.js";
import { renderJson } from "../ui/view-json.js";
import { renderCompose, renderContainers, renderImages, renderNetworks } from "../ui/view-lists.js";
import { renderOverview } from "../ui/view-overview.js";
import { renderFiles } from "../ui/view-panels.js";
import { type FakeNode, fakeDocument, texts } from "./fake-dom";
import {
  DB_ID,
  DISK,
  IMAGES,
  NETWORKS,
  PROJECTS,
  PS,
  STATS,
  VERSION,
  VOLUMES,
  WEB_ID,
} from "./fixtures";
import { STATS_STREAM } from "./fixtures-more";

const doc = fakeDocument();
const prefs = (query = "", key = "name", desc = false) => ({ query, sort: { key, desc } });
const containers = { containers: parseContainers(PS), stats: parseStats(STATS), all: true };

describe("the list renderers", () => {
  it("group containers by Compose project by service, with ports as links, the rest last", () => {
    const { rows, nodes } = renderContainers(doc, containers, prefs(), new Set());
    expect(texts(rows)).toEqual([
      "▾ shop 2/2",
      "db postgres:17 127.0.0.1:5432→5432 Up 6 hours (healthy)",
      "web node:22-bookworm-slim 8080→80 Up 6 hours",
      "▾ Other containers 0/1",
      "scratch alpine:3.20 Exited (137) 2 days ago",
    ]);
    // A column header with a sort button per sortable column comes first.
    const head = nodes[0] as unknown as FakeNode;
    expect(head.all("button").map((b) => b.attributes["data-sort"])).toEqual([
      "name",
      "image",
      "cpu",
      "memory",
      "uptime",
    ]);
    expect(rows[1]?.item).toMatchObject({ kind: "container", name: "shop-db-1", project: "shop" });
    expect(rows[1]?.markable).toBe(true);
    expect(rows[0]?.group).toEqual([`container:${DB_ID}`, `container:${WEB_ID}`]);
    const link = (rows[2]?.el as unknown as FakeNode | undefined)?.querySelector("a");
    expect(link?.attributes).toMatchObject({ href: "http://localhost:8080/", "data-port": "8080" });
    const dot = (rows[1]?.el as unknown as FakeNode | undefined)?.children[0];
    expect(dot?.attributes["aria-label"]).toBe("running, healthy");
    expect(
      texts(renderContainers(doc, containers, prefs(), new Set(["project:shop"])).rows),
    ).toHaveLength(3);
    expect(texts(renderContainers(doc, containers, prefs("is:stopped"), new Set()).rows)).toEqual([
      "▾ Other containers 0/1",
      "scratch alpine:3.20 Exited (137) 2 days ago",
    ]);
    expect(texts(renderContainers(doc, containers, prefs("zzz"), new Set()).rows)).toEqual([
      "Nothing matches “zzz”. Esc clears the search.",
    ]);
    expect(
      texts(
        renderContainers(doc, { ...containers, containers: [], all: false }, prefs(), new Set())
          .rows,
      ),
    ).toEqual(["No running containers. a shows the stopped ones too."]);
  });

  it("show Compose projects with their services, images with a size bar, and networks", () => {
    const compose = {
      projects: parseProjects(PROJECTS),
      containers: parseContainers(PS).filter((c) => c.project),
    };
    const projects = texts(renderCompose(doc, compose, prefs(), new Set()).rows);
    expect(projects[0]).toBe("▾ old-demo exited(4), running(1) /Users/me/demo/compose.yaml");
    expect(projects.slice(1).map((t) => t.split(" ")[0])).toEqual(["▾", "db", "web"]);
    const images = renderImages(doc, { images: parseImages(IMAGES) }, prefs("", "size", true)).rows;
    expect(texts(images)).toEqual([
      expect.stringMatching(
        /^ghcr\.io\/acme\/api@sha256:4f53cda18c2b… e45cdcfd2c0e 1\.2GB 2026-10-30/,
      ),
      "postgres:17 9431865c385c 438MB 2026-10-20 13:38:33 1 container",
      "<none> 0e4a9e06ad09 394MB 2026-10-31 09:29:36 unused",
    ]);
    const fill = (images[1]?.el as unknown as FakeNode | undefined)?.querySelector("span.fill");
    expect(fill?.style.width).toBe("37%");
    expect(texts(renderNetworks(doc, { networks: parseNetworks(NETWORKS) }, prefs()).rows)).toEqual(
      [
        "bridge bridge local built in",
        "backplane bridge local internal",
        "shop_default bridge local shop",
      ],
    );
  });

  it("fill a row's metric cells with sparklines from the stats stream", () => {
    const history = createHistory({ spacing: () => 1000 });
    let now = 0;
    for (const raw of STATS_STREAM) {
      const sample = parseStatsLine(raw);
      if (sample) history.feed(sample, now);
      else now += 1000;
    }
    const cells = {
      cpu: doc.createElement("span"),
      mem: doc.createElement("span"),
      net: doc.createElement("span"),
    };
    fillMetrics(doc, cells, history.snapshot(DB_ID));
    const cpu = cells.cpu as unknown as FakeNode;
    expect(cpu.textContent.trim()).toBe("50%");
    expect(cpu.children[0]?.attributes).toMatchObject({
      class: "spark cpu",
      "aria-label": "CPU 50%",
    });
    expect(cpu.children[0]?.children.map((c) => c.tag)).toEqual(["polygon", "polyline"]);
    expect((cells.mem as unknown as FakeNode).textContent.trim()).toBe("64MiB");
    expect((cells.net as unknown as FakeNode).textContent.trim()).toBe("0 B/s");
  });
});

describe("the overview's cards", () => {
  const model = overviewModel({
    containers: parseContainers(PS),
    projects: parseProjects(PROJECTS),
    images: parseImages(IMAGES),
    volumes: parseVolumes(VOLUMES),
    networks: parseNetworks(NETWORKS),
    disk: parseDiskUse(DISK),
    version: parseVersion(VERSION),
  });

  it("make every line that leads somewhere a row of one cursor", () => {
    const { rows, nodes } = renderOverview(doc, model);
    const cards = (nodes[0] as unknown as FakeNode).all("section").map((s) => s.className);
    expect(cards).toEqual([
      "card desk-card engine",
      "card desk-card containers",
      "card desk-card stacks",
      "card desk-card busiest",
      "card desk-card disk",
      "card desk-card objects",
    ]);
    const goes = rows.flatMap((r) =>
      r.item?.kind === "goto" ? [`${r.item.list} ${r.item.query}`.trim()] : [],
    );
    expect(goes.slice(0, 7)).toEqual([
      "@refresh",
      "@switchContext",
      "containers is:running",
      "containers is:unhealthy",
      "containers is:paused",
      "containers is:stopped",
      "containers project:old-demo",
    ]);
    expect(goes).toContain("@pruneSystem");
    expect(goes).toContain("images is:dangling");
    expect(texts(rows.slice(2, 6))).toEqual([
      "2 Running",
      "0 Unhealthy",
      "0 Paused or restarting",
      "1 Stopped",
    ]);
  });

  it("say what is wrong with the engine, with a way to try again", () => {
    const down = overviewModel({ problem: "Docker is not running: start Docker Desktop." });
    const { nodes, rows } = renderOverview(doc, down);
    const root = nodes[0] as unknown as FakeNode;
    expect(root.all("section")).toHaveLength(1);
    expect(root.querySelector("div.desk-error")?.attributes.role).toBe("alert");
    expect(root.querySelector("button")?.attributes["data-act"]).toBe("refresh");
    expect(texts(rows)[0]).toBe("Not reachable");
  });
});

describe("the tree's cursor and marks", () => {
  it("keeps the cursor on its row across draws, marks rows and a stack's rows at once", () => {
    const root = doc.createElement("div");
    const tree = createTree(doc, root);
    const draw = () => tree.set(renderContainers(doc, containers, prefs(), tree.folded).rows);
    draw();
    tree.move("next");
    tree.mark();
    expect(tree.marked().map((i) => (i.kind === "container" ? i.name : ""))).toEqual(["shop-db-1"]);
    tree.move("first");
    tree.mark();
    expect(tree.marked()).toHaveLength(2);
    tree.move("first");
    tree.mark();
    expect(tree.marked()).toHaveLength(0);
    tree.markAll();
    expect(tree.marked()).toHaveLength(3);
    draw();
    expect(tree.marked()).toHaveLength(3);
    tree.moveTo(4);
    expect(tree.selection()).toMatchObject({ name: "scratch" });
    expect(tree.fold(false)).toBe(false);
    expect(tree.selection()).toMatchObject({ kind: "section", section: "standalone" });
    expect(tree.fold(false)).toBe(true);
    draw();
    expect(texts(tree.rows()).at(-1)).toBe("▸ Other containers 0/1");
    expect(tree.clearMarks()).toBe(true);
  });

  it("shows JSON with deep levels folded until opened, and files as a drop target", () => {
    const folded = new Set<string>();
    const json = { Id: "abc", State: { Health: { Status: "healthy" } }, Args: [1, true, null] };
    expect(texts(renderJson(doc, json, folded))).toEqual([
      "▾ {3}",
      'Id "abc"',
      "▾ State {1}",
      "▸ Health {1}",
      "▾ Args [3]",
      "0 1",
      "1 true",
      "2 null",
    ]);
    folded.add("+$/State/Health");
    expect(texts(renderJson(doc, json, folded))).toContain('Status "healthy"');
    const files = renderFiles(
      doc,
      { path: "/etc", entries: [], problem: "", loading: false },
      DB_ID,
    );
    const list = (files.nodes?.[1] ?? null) as unknown as FakeNode;
    expect(list.attributes).toMatchObject({
      "data-drop": "files",
      "data-container": DB_ID,
      "data-path": "/etc",
    });
    expect(texts(files.rows)).toEqual([
      "↰ .. the folder above",
      "This folder is empty. Y copies a file of this computer into it.",
    ]);
  });
});
