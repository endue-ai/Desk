// What docker prints, read into the studio's models: inspect JSON, compose ls, system df, stats and
// events lines, sizes and times.
import { describe, expect, it } from "vitest";
import { ago, bytes, duration, memory, parsePercent, parseSize, time } from "../ui/format.js";
import { problemOf, splitRef, stackState, stateLabel } from "../ui/model.js";
import * as parse from "../ui/parse.js";
import { event, sample, touches } from "../ui/parse-live.js";

const inspected = {
  Id: "a".repeat(64),
  Name: "/shop-api-1",
  Created: "2026-11-16T10:00:00.000000000Z",
  Path: "node",
  Args: ["server.js"],
  Image: `sha256:${"b".repeat(64)}`,
  RestartCount: 2,
  State: {
    Status: "running",
    ExitCode: 0,
    StartedAt: "2026-11-16T10:00:01Z",
    FinishedAt: "0001-01-01T00:00:00Z",
    Health: { Status: "healthy" },
  },
  HostConfig: { RestartPolicy: { Name: "unless-stopped" } },
  Config: {
    Image: "shop-api:dev",
    Env: ["NODE_ENV=production"],
    Cmd: ["node", "server.js"],
    Labels: { "com.docker.compose.project": "shop", "com.docker.compose.service": "api" },
    ExposedPorts: { "3000/tcp": {} },
  },
  NetworkSettings: {
    Ports: {
      "3000/tcp": [
        { HostIp: "0.0.0.0", HostPort: "3000" },
        { HostIp: "::", HostPort: "3000" },
      ],
      "9229/tcp": null,
    },
    Networks: { shop_default: { IPAddress: "172.20.0.3", Aliases: ["api"] } },
  },
  Mounts: [{ Type: "volume", Name: "shop_data", Destination: "/data", RW: true }],
};

describe("parse", () => {
  it("reads a container from inspect, one row per published port", () => {
    const c = parse.container(inspected);
    expect(c.name).toBe("shop-api-1");
    expect(c.project).toBe("shop");
    expect(c.service).toBe("api");
    expect(c.health).toBe("healthy");
    expect(c.finishedAt).toBe(0);
    expect(c.ports).toEqual([{ ip: "0.0.0.0", host: 3000, container: 3000, proto: "tcp" }]);
    expect(c.networks[0]).toMatchObject({ name: "shop_default", ip: "172.20.0.3" });
    expect(c.mounts[0]).toMatchObject({ type: "volume", name: "shop_data", rw: true });
    expect(stateLabel(c)).toBe("Running · healthy");
  });

  it("says what is wrong with a container", () => {
    const c = parse.container(inspected);
    expect(problemOf(c)).toBeNull();
    expect(problemOf({ ...c, state: "exited", exitCode: 1 })?.text).toBe("Exited with code 1");
    expect(problemOf({ ...c, state: "exited", exitCode: 143 })).toBeNull();
    expect(problemOf({ ...c, health: "unhealthy" })?.level).toBe("warning");
    expect(problemOf({ ...c, oom: true })?.text).toMatch(/out of memory/);
    expect(stackState({ containers: [c, { ...c, state: "exited" }] })).toBe("partial");
  });

  it("reads compose ls in both shapes and system df rows", () => {
    const rows = parse.projects(
      '[{"Name":"shop","Status":"running(5), exited(1)","ConfigFiles":"/a/compose.yaml,/a/compose.override.yaml"}]',
    );
    expect(rows[0]?.files).toEqual(["/a/compose.yaml", "/a/compose.override.yaml"]);
    expect(parse.projectStatus(rows[0]?.status ?? "")).toEqual({ running: 5, exited: 1 });
    expect(
      parse.projects('{"Name":"blog","Status":"exited(2)","ConfigFiles":"/b/c.yml"}'),
    ).toHaveLength(1);
    const df = parse.disk(
      '{"Active":"3","Reclaimable":"1.2GB (40%)","Size":"3GB","TotalCount":"10","Type":"Images"}\n{"Type":"Build Cache","TotalCount":"4","Active":"0","Size":"512MB","Reclaimable":"512MB"}',
    );
    expect(df).toEqual([
      { kind: "images", count: 10, active: 3, size: 3e9, reclaimable: 1.2e9 },
      { kind: "cache", count: 4, active: 0, size: 512e6, reclaimable: 512e6 },
    ]);
  });

  it("reads stats and events lines", () => {
    const s = sample(
      '\u001b[2J\u001b[H{"ID":"abc","Name":"web","CPUPerc":"12.50%","MemUsage":"30MiB / 1GiB","MemPerc":"2.9%","NetIO":"1.5kB / 2MB","BlockIO":"0B / 0B","PIDs":"7"}',
    );
    expect(s).toMatchObject({
      id: "abc",
      cpu: 12.5,
      mem: 30 * 1024 ** 2,
      memLimit: 1024 ** 3,
      netIn: 1500,
      pids: 7,
    });
    expect(sample("--")).toBeUndefined();
    const e = event(
      '{"Type":"container","Action":"exec_start: sh","Actor":{"ID":"abc","Attributes":{"name":"web"}},"time":1700000000,"timeNano":1700000000123000000}',
    );
    expect(e).toMatchObject({
      type: "container",
      action: "exec_start",
      name: "web",
      time: 1700000000123,
    });
    expect(e && touches(e)).toEqual([]);
  });
});

describe("format", () => {
  it("reads and writes sizes the way docker does", () => {
    expect(parseSize("1.2GB")).toBe(1.2e9);
    expect(parseSize("30MiB")).toBe(30 * 1024 ** 2);
    expect(parseSize("0B")).toBe(0);
    expect(parseSize("N/A")).toBeNaN();
    expect(parsePercent("0.05%")).toBe(0.05);
    expect(bytes(431_400_000)).toBe("431 MB");
    expect(bytes(1_234_000)).toBe("1.2 MB");
    expect(memory(30 * 1024 ** 2)).toBe("30.0 MiB");
  });

  it("says times and durations", () => {
    expect(time("0001-01-01T00:00:00Z")).toBe(0);
    expect(time("2024-05-01 10:00:00 +0900 KST")).toBe(Date.parse("2024-05-01T10:00:00+09:00"));
    expect(duration(3_725_000)).toBe("1h 2m");
    expect(ago(1_000_000 - 5 * 60_000, 1_000_000)).toBe("5 minutes ago");
    expect(splitRef("localhost:5000/app")).toEqual({ repo: "localhost:5000/app", tag: "latest" });
    expect(splitRef("nginx:1.27")).toEqual({ repo: "nginx", tag: "1.27" });
  });
});
