import { describe, expect, it } from "vitest";
import { firstOf, inspectModel } from "../ui/inspect.js";
import { parseContexts, parseDiskUse, parseStats, parseVersion } from "../ui/parse-engine.js";
import { parseContainers, parseImages, parseNetworks, parseProjects } from "../ui/parse-list.js";
import {
  renderCompose,
  renderContainers,
  renderDetail,
  renderImages,
  renderNetworks,
  renderSystem,
} from "../ui/view-lists.js";
import {
  CONTEXTS,
  DISK,
  IMAGES,
  INSPECT,
  NETWORKS,
  PROJECTS,
  PS,
  STATS,
  VERSION,
} from "./fixtures";

/** Just enough of a document for the renderers: elements with attributes, classes and text. */
class Node {
  children: Node[] = [];
  attributes: Record<string, string> = {};
  className = "";
  constructor(
    readonly tag: string,
    readonly text = "",
  ) {}
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  append(...nodes: Node[]) {
    this.children.push(...nodes);
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join(" ");
  }
}
const doc = {
  createElement: (tag: string) => new Node(tag),
  createTextNode: (text: string) => new Node("#text", text),
} as unknown as Document;

const text = (rows: Array<{ el: HTMLElement }>) =>
  rows.map((r) => (r.el as unknown as Node).textContent.replace(/\s+/g, " ").trim());

describe("the list renderers", () => {
  it("group containers by Compose project by service, with ports and sampled use, the rest last", () => {
    const model = { containers: parseContainers(PS), stats: parseStats(STATS), all: true };
    const rows = renderContainers(doc, model, new Set());
    expect(text(rows)).toEqual([
      "▾ shop 2/2",
      "db postgres:17 Up 6 hours (healthy) 127.0.0.1:5432→5432 12.40% · 52.41MiB",
      "web node:22-bookworm-slim Up 6 hours 8080→80 0.17% · 37.75MiB",
      "▾ Containers 0/1",
      "scratch alpine:3.20 Exited (137) 2 days ago",
    ]);
    expect(rows.map((r) => r.level)).toEqual([1, 2, 2, 1, 2]);
    // Inside a project a container goes by its service; the item keeps its own name.
    expect(rows[1]?.item).toMatchObject({ kind: "container", name: "shop-db-1", project: "shop" });
    const dot = (rows[1]?.el as unknown as Node | undefined)?.children[0];
    expect(dot?.attributes["aria-label"]).toBe("running healthy");
    expect(text(renderContainers(doc, model, new Set(["project:shop"])))).toHaveLength(3);
    expect(
      text(renderContainers(doc, { ...model, containers: [], all: false }, new Set())),
    ).toEqual(["No running containers. a shows stopped ones too."]);
  });

  it("show Compose projects with their services, images with their use, and networks", () => {
    const containers = parseContainers(PS).filter((c) => c.project);
    const compose = text(
      renderCompose(doc, { projects: parseProjects(PROJECTS), containers }, new Set()),
    );
    expect(compose[0]).toBe("▾ old-demo exited(4), running(1) /Users/me/demo/compose.yaml");
    expect(compose.slice(1)).toEqual([
      expect.stringMatching(/^▾ shop running\(2\)/),
      expect.stringMatching(/^db postgres:17/),
      expect.stringMatching(/^web node:22/),
    ]);
    expect(text(renderImages(doc, { images: parseImages(IMAGES) }))).toEqual([
      expect.stringMatching(/^ghcr\.io\/acme\/api@sha256:4f53cda18c2b.* e45cdcfd2c0e 1\.2GB/),
      "postgres:17 9431865c385c 438MB 2026-10-20 13:38:33 +0900 KST 1 container",
      "<none> 0e4a9e06ad09 394MB 2026-10-31 09:29:36 +0900 KST unused",
    ]);
    expect(text(renderNetworks(doc, { networks: parseNetworks(NETWORKS) }))).toEqual([
      "bridge bridge local built in",
      "backplane bridge local internal",
      "shop_default bridge local shop",
    ]);
  });

  it("show the engine, the contexts and disk use, and a detail with masked secrets", () => {
    const system = text(
      renderSystem(
        doc,
        {
          version: parseVersion(VERSION),
          contexts: parseContexts(CONTEXTS),
          disk: parseDiskUse(DISK),
          context: "",
        },
        new Set(["disk"]),
      ),
    );
    expect(system).toEqual([
      "▾ Engine",
      "Server 29.8.1 (API 1.56)",
      "Platform Docker Desktop 4.93.0 (240920)",
      "System linux/arm64",
      "Client 29.8.1 (API 1.56) darwin/arm64",
      "▾ Contexts",
      "default unix:///var/run/docker.sock",
      "desktop-linux (in use) unix:///Users/me/.docker/run/docker.sock",
      "build ssh://me@build.example",
      "▸ Disk use",
    ]);
    const detail = text(renderDetail(doc, inspectModel(firstOf(INSPECT)), new Set()));
    expect(detail).toContain("POSTGRES_PASSWORD ••••••");
    expect(detail).toContain("▾ Ports 1");
  });
});
