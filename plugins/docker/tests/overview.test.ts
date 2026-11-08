import { describe, expect, it } from "vitest";
import { formatBytes, overviewModel, parseSize } from "../ui/overview.js";
import { parseDiskUse, parseVersion } from "../ui/parse-engine.js";
import {
  parseContainers,
  parseImages,
  parseNetworks,
  parseProjects,
  parseVolumes,
} from "../ui/parse-list.js";
import { DB_ID, DISK, IMAGES, NETWORKS, PROJECTS, PS, VERSION, VOLUMES, WEB_ID } from "./fixtures";
import { engine, mount } from "./harness";

const line = (record: Record<string, unknown>) => JSON.stringify(record);
/** Three more containers: one unhealthy, one paused, one a Compose service that died. */
const MORE = [
  line({
    id: "a1".repeat(32),
    names: "worker",
    image: "busybox",
    state: "running",
    status: "Up 2 minutes (unhealthy)",
    ports: "",
    project: "",
    service: "",
  }),
  line({
    id: "b2".repeat(32),
    names: "cache",
    image: "redis:7",
    state: "paused",
    status: "Up 3 hours (Paused)",
    ports: "",
    project: "",
    service: "",
  }),
  line({
    id: "c3".repeat(32),
    names: "old-demo-api-1",
    image: "ghcr.io/acme/api",
    state: "exited",
    status: "Exited (1) 1 day ago",
    ports: "",
    project: "old-demo",
    service: "api",
  }),
].join("\n");

const sources = () => ({
  containers: parseContainers(`${PS}${MORE}\n`),
  projects: parseProjects(PROJECTS),
  images: parseImages(IMAGES),
  volumes: parseVolumes(VOLUMES),
  networks: parseNetworks(NETWORKS),
  disk: parseDiskUse(DISK),
  version: parseVersion(VERSION),
  context: "",
});

describe("the overview model", () => {
  it("counts containers by state, unhealthy apart from running", () => {
    expect(overviewModel(sources()).counts).toEqual({
      running: 2,
      unhealthy: 1,
      paused: 1,
      restarting: 0,
      stopped: 2,
      total: 6,
    });
  });

  it("groups containers by Compose project, with a dot per service and the rest standalone", () => {
    const model = overviewModel(sources());
    expect(model.stacks.map((s) => [s.name, s.running, s.total, s.state])).toEqual([
      ["old-demo", 0, 1, "exited"],
      ["shop", 2, 2, "running"],
    ]);
    expect(model.stacks[1]?.services).toEqual([
      { name: "db", id: DB_ID, state: "running", health: "healthy" },
      { name: "web", id: WEB_ID, state: "running", health: null },
    ]);
    expect(model.stacks[1]?.files).toEqual([
      "/Users/me/shop/compose.yaml",
      "/Users/me/shop/compose.override.yaml",
    ]);
    expect(model.standalone).toBe(3);
    // A project compose ls knows but whose containers were not read keeps compose's own numbers.
    const bare = overviewModel({ ...sources(), containers: [] });
    expect(bare.stacks.map((s) => [s.name, s.running, s.total, s.state])).toEqual([
      ["old-demo", 1, 5, "partial"],
      ["shop", 2, 2, "running"],
    ]);
  });

  it("adds up image disk use, the dangling part apart, and the engine's disk use per kind", () => {
    const { images, disk } = overviewModel(sources());
    // 438MB + 394MB + 1.2GB, as docker counts: powers of 1000.
    expect(images.bytes).toBe(2_032_000_000);
    expect(images.dangling).toEqual({ count: 1, bytes: 394_000_000 });
    expect(images.unused).toBe(1);
    expect(images.largest.map((i) => i.ref)).toEqual([
      "ghcr.io/acme/api@sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "postgres:17",
    ]);
    expect(disk?.rows.map((r) => [r.label, r.bytes, r.reclaimable, r.count, r.active])).toEqual([
      ["Images", 26_700_000_000, 15_160_000_000, 38, 14],
      ["Containers", 832_100_000, 708_900_000, 3, 2],
      ["Volumes", 53_960_000_000, 43_640_000_000, 2, 1],
      ["Build cache", 29_570_000_000, 17_700_000_000, 214, 0],
    ]);
    expect(disk?.bytes).toBe(111_062_100_000);
    expect(formatBytes(disk?.bytes ?? 0)).toBe("111 GB");
    expect(formatBytes(images.dangling.bytes)).toBe("394 MB");
  });

  it("says what the engine is, and counts volumes and networks", () => {
    const model = overviewModel(sources());
    expect(model.engine).toEqual({
      up: true,
      version: "29.8.1",
      platform: "Docker Desktop 4.93.0 (240920)",
      context: "desktop-linux",
      problem: "",
    });
    expect(model.volumes).toEqual({ count: 2, anonymous: 1, named: 1 });
    expect(model.networks).toEqual({ count: 3, custom: 2 });
    const down = overviewModel({ problem: "Docker is not running." });
    expect(down.engine.up).toBe(false);
    expect(down.disk).toBeNull();
    expect(down.counts.total).toBe(0);
  });

  it("reads docker's sizes in both its unit systems", () => {
    expect(parseSize("1.2GB")).toBe(1_200_000_000);
    expect(parseSize("37.75MiB")).toBe(39_583_744);
    expect(parseSize("15.16GB (56%)")).toBe(15_160_000_000);
    expect(parseSize("0B")).toBe(0);
    expect(parseSize("N/A")).toBe(0);
  });
});

describe("the overview surface", () => {
  it("opens on the overview, read from one call per list, and answers its command", async () => {
    const m = await mount();
    expect(m.view.shown.at(-1)).toBe("overview");
    const model = m.view.latest("overview");
    expect(model.counts).toMatchObject({ running: 2, stopped: 1, total: 3 });
    expect(model.disk?.rows).toHaveLength(4);
    for (const sub of ["ps", "image", "volume", "network", "system"])
      expect(m.docker.of(sub).length, sub).toBe(1);
    const answered = (await m.host.invoke("endue.docker.overview")) as { counts: unknown };
    expect(answered.counts).toEqual(model.counts);
  });

  it("still shows what it could read when disk use fails", async () => {
    const m = await mount({ script: engine({ "system df": { code: 1, stderr: "boom\n" } }) });
    const model = m.view.latest("overview");
    expect(model.disk).toBeNull();
    expect(model.counts.total).toBe(3);
  });
});
