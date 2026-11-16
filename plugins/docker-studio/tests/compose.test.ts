// A stack's resolved config as services in levels, and the compose commands it runs.
import { describe, expect, it } from "vitest";
import { configArgs, levels, parseConfig, serviceArgs, upArgs } from "../ui/compose.js";

const config = JSON.stringify({
  name: "shop",
  services: {
    web: {
      image: "nginx",
      ports: [{ target: 80, published: "8080", protocol: "tcp" }],
      depends_on: { api: { condition: "service_started" } },
    },
    api: {
      image: "shop-api:dev",
      build: { context: "." },
      depends_on: { db: { condition: "service_healthy" }, cache: { condition: "service_started" } },
    },
    db: {
      image: "postgres:16",
      volumes: [{ type: "volume", source: "pgdata", target: "/var/lib/postgresql/data" }],
    },
    cache: { image: "redis:7" },
  },
  volumes: { pgdata: {} },
});

describe("compose", () => {
  it("reads services, what they depend on and their levels", () => {
    const c = parseConfig(config);
    const by = Object.fromEntries(c.services.map((s) => [s.name, s]));
    expect(by.db?.level).toBe(0);
    expect(by.cache?.level).toBe(0);
    expect(by.api?.level).toBe(1);
    expect(by.web?.level).toBe(2);
    expect(by.api?.depends).toEqual([
      { name: "db", condition: "service_healthy" },
      { name: "cache", condition: "service_started" },
    ]);
    expect(by.web?.ports).toEqual(["8080:80"]);
    expect(by.db?.volumes).toEqual(["pgdata:/var/lib/postgresql/data"]);
    expect(by.api?.build).toBe(true);
    expect(c.volumes).toEqual(["pgdata"]);
    expect(parseConfig("not json").services).toEqual([]);
  });

  it("stops at a cycle", () => {
    const a = {
      name: "a",
      image: "",
      build: false,
      ports: [],
      volumes: [],
      restart: "",
      level: 0,
      depends: [{ name: "b", condition: "" }],
    };
    const b = { ...a, name: "b", depends: [{ name: "a", condition: "" }] };
    expect(() => levels([a, b])).not.toThrow();
  });

  it("makes the compose commands, names checked", () => {
    expect(configArgs("shop", ["/a/compose.yaml"])).toEqual([
      "compose",
      "--ansi",
      "never",
      "--project-name",
      "shop",
      "--file",
      "/a/compose.yaml",
      "config",
      "--format",
      "json",
    ]);
    expect(serviceArgs("shop", "restart", "api")).toEqual([
      "compose",
      "--ansi",
      "never",
      "--project-name",
      "shop",
      "restart",
      "api",
    ]);
    expect(() => serviceArgs("shop", "stop", "-x")).toThrow();
    expect(upArgs({ file: "/a/compose.yaml", project: "", build: true, pull: false })).toEqual([
      "compose",
      "--ansi",
      "never",
      "--file",
      "/a/compose.yaml",
      "up",
      "--detach",
      "--remove-orphans",
      "--build",
    ]);
    expect(() =>
      upArgs({ file: "compose.yaml", project: "", build: false, pull: false }),
    ).toThrow();
    expect(() =>
      upArgs({ file: "/a/c.yaml", project: "Bad Name", build: false, pull: false }),
    ).toThrow();
  });
});
