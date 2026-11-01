import { describe, expect, it } from "vitest";
import {
  healthOf,
  PS_FORMAT,
  parseContainers,
  parseImages,
  parseNetworks,
  parsePorts,
  parseProjects,
  parseVolumes,
  portText,
  records,
} from "../ui/parse-list.js";
import { DB_ID, IMAGES, NETWORKS, OLD_ID, PROJECTS, PS, VOLUMES, WEB_ID } from "./fixtures";

describe("records", () => {
  it("reads one object per line, or one array, and skips what is not an object", () => {
    expect(records('{"a":1}\n\n{"b":2}\nnot json\n[1]\n{"c":')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(records('[{"a":1},2,{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(records("")).toEqual([]);
    expect(records("   \n")).toEqual([]);
  });
});

describe("the templates", () => {
  it("ask for a JSON object of named fields, never .Size (docker would measure every container)", () => {
    expect(PS_FORMAT).toMatch(/^\{"id":\{\{json \.ID\}\},/);
    expect(PS_FORMAT).toContain('"project":{{json (.Label "com.docker.compose.project")}}');
    expect(PS_FORMAT).not.toContain(".Size");
  });
});

describe("parseContainers", () => {
  it("reads state, health, ports and the Compose project of each container", () => {
    const [web, db, old] = parseContainers(PS);
    expect(web).toMatchObject({
      id: WEB_ID,
      name: "shop-web-1",
      state: "running",
      health: null,
      project: "shop",
      service: "web",
      command: "docker-entrypoint.sh npm start",
      ports: [{ ip: "0.0.0.0", host: "8080", container: "80", proto: "tcp" }],
    });
    expect(db).toMatchObject({
      id: DB_ID,
      health: "healthy",
      ports: [{ ip: "127.0.0.1", host: "5432" }],
    });
    expect(old).toMatchObject({ id: OLD_ID, state: "exited", project: "", ports: [] });
  });

  it("takes the first of several names and reads the state from the status on older CLIs", () => {
    const [c] = parseContainers(
      '{"id":"abc","names":"web,other/alias","status":"Up 2 minutes (Paused)"}',
    );
    expect(c).toMatchObject({ name: "web", state: "paused" });
    expect(parseContainers('{"status":"Restarting (1) 3 seconds ago"}')[0]?.state).toBe(
      "restarting",
    );
    expect(parseContainers('{"status":"Created"}')[0]?.state).toBe("created");
  });

  it("knows the three health words", () => {
    expect(healthOf("Up 1 hour (unhealthy)")).toBe("unhealthy");
    expect(healthOf("Up 3 seconds (health: starting)")).toBe("starting");
    expect(healthOf("Up 1 hour")).toBeNull();
  });
});

describe("parsePorts", () => {
  it("keeps one entry for the same mapping on IPv4 and IPv6, and reads ranges and exposed ports", () => {
    expect(
      parsePorts("0.0.0.0:8080->80/tcp, :::8080->80/tcp, [::]:8080->80/tcp, 5432/tcp"),
    ).toEqual([
      { ip: "0.0.0.0", host: "8080", container: "80", proto: "tcp" },
      { ip: "", host: "", container: "5432", proto: "tcp" },
    ]);
    expect(parsePorts("0.0.0.0:8000-8001->8000-8001/udp")).toEqual([
      { ip: "0.0.0.0", host: "8000-8001", container: "8000-8001", proto: "udp" },
    ]);
    expect(parsePorts("garbage, , 80")).toEqual([]);
  });

  it("reads as a row shows it: the local address only when it is not every address", () => {
    expect(portText({ ip: "0.0.0.0", host: "8080", container: "80", proto: "tcp" })).toBe(
      "8080→80",
    );
    expect(portText({ ip: "127.0.0.1", host: "5432", container: "5432", proto: "tcp" })).toBe(
      "127.0.0.1:5432→5432",
    );
    expect(portText({ ip: "", host: "", container: "53", proto: "udp" })).toBe("53/udp");
    expect(portText({ ip: "::", host: "53", container: "53", proto: "udp" })).toBe("53→53/udp");
  });
});

describe("parseImages", () => {
  it("names an image by repository and tag, by digest without a tag, by short id when dangling", () => {
    const [pg, dangling, api] = parseImages(IMAGES);
    expect(pg).toMatchObject({ ref: "postgres:17", containers: 1, dangling: false, size: "438MB" });
    expect(dangling).toMatchObject({ ref: "0e4a9e06ad09", dangling: true, containers: 0 });
    expect(api).toMatchObject({
      ref: "ghcr.io/acme/api@sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      containers: null,
    });
  });
});

describe("parseVolumes and parseNetworks", () => {
  it("marks anonymous volumes and the engine's own networks", () => {
    const [anon, named] = parseVolumes(VOLUMES);
    expect(anon).toMatchObject({ anonymous: true, driver: "local" });
    expect(named).toMatchObject({ name: "shop_db-data", anonymous: false, project: "shop" });
    expect(parseVolumes(`{"name":"${"f".repeat(64)}","labels":""}`)[0]?.anonymous).toBe(true);
    const [bridge, shop, internal] = parseNetworks(NETWORKS);
    expect(bridge).toMatchObject({ builtin: true, internal: false });
    expect(shop).toMatchObject({ builtin: false, project: "shop" });
    expect(internal?.internal).toBe(true);
  });
});

describe("parseProjects", () => {
  it("counts running and all services and splits the config files", () => {
    expect(parseProjects(PROJECTS)).toEqual([
      {
        name: "shop",
        status: "running(2)",
        files: ["/Users/me/shop/compose.yaml", "/Users/me/shop/compose.override.yaml"],
        running: 2,
        total: 2,
      },
      {
        name: "old-demo",
        status: "exited(4), running(1)",
        files: ["/Users/me/demo/compose.yaml"],
        running: 1,
        total: 5,
      },
    ]);
  });

  it("reads NDJSON from Compose versions that print a line per project", () => {
    expect(parseProjects('{"Name":"a","Status":"exited(1)","ConfigFiles":""}\n')).toEqual([
      { name: "a", status: "exited(1)", files: [], running: 0, total: 1 },
    ]);
  });
});
