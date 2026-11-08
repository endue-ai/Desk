import { describe, expect, it } from "vitest";
import { bytes, firstOf, inspectModel } from "../ui/inspect.js";
import { DB_ID, INSPECT } from "./fixtures";

const detail = (reveal = false) => inspectModel(firstOf(INSPECT), { reveal });
const section = (id: string, reveal = false) => detail(reveal).sections.find((s) => s.id === id);
const value = (id: string, label: string) =>
  section(id)?.fields.find((f) => f.label === label)?.value;

describe("inspectModel", () => {
  it("names the container and lists its sections in order", () => {
    const model = detail();
    expect(model).toMatchObject({
      id: DB_ID,
      name: "shop-db-1",
      image: "postgres:17",
      state: "running",
    });
    expect(model.sections.map((s) => s.id)).toEqual([
      "overview",
      "state",
      "ports",
      "mounts",
      "networks",
      "env",
      "labels",
      "limits",
    ]);
  });

  it("reads the overview, the state with its health checks, and leaves out what is empty", () => {
    expect(value("overview", "Command")).toBe("postgres");
    expect(value("overview", "Entrypoint")).toBe("docker-entrypoint.sh");
    expect(value("overview", "Restart policy")).toBe("unless-stopped");
    expect(value("overview", "Working dir")).toBeUndefined();
    expect(value("state", "Health")).toBe("healthy");
    expect(value("state", "Finished")).toBeUndefined();
    expect(value("state", "Exit code")).toBeUndefined();
    expect(section("state")?.fields.at(-1)).toEqual({
      label: "Check 2026-10-31T06:00:00Z",
      value: "exit 0: accepting connections",
    });
  });

  it("reads ports, mounts and networks as one line each", () => {
    expect(section("ports")?.fields).toEqual([{ label: "5432/tcp", value: "127.0.0.1:5432" }]);
    expect(section("mounts")?.fields).toEqual([
      { label: "/var/lib/postgresql/data", value: "volume shop_db-data" },
    ]);
    expect(section("networks")?.fields).toEqual([
      { label: "shop_default", value: "172.18.0.2/16 · via 172.18.0.1 · aliases db" },
    ]);
  });

  it("masks environment values whose names look secret, unless asked to reveal them", () => {
    expect(section("env")?.fields).toEqual([
      { label: "POSTGRES_PASSWORD", value: "••••••", masked: true },
      { label: "POSTGRES_DB", value: "shop" },
      { label: "PATH", value: "/usr/local/bin:/usr/bin" },
    ]);
    expect(section("env", true)?.fields[0]).toEqual({
      label: "POSTGRES_PASSWORD",
      value: "hunter2",
    });
  });

  it("sorts labels and reads limits in units people read", () => {
    expect(section("labels")?.fields.map((f) => f.label)).toEqual([
      "com.docker.compose.project",
      "com.docker.compose.service",
    ]);
    expect(value("limits", "Memory")).toBe("512 MiB");
    expect(value("limits", "CPUs")).toBe("1.5");
    expect(value("limits", "Processes")).toBeUndefined();
  });

  it("says when a stopped container ran out of memory, and never throws on odd input", () => {
    const stopped = inspectModel({
      Name: "/x",
      State: {
        Status: "exited",
        Running: false,
        ExitCode: 137,
        OOMKilled: true,
        FinishedAt: "2026-10-31T01:00:00Z",
      },
    });
    expect(stopped.sections[0]?.fields).toEqual(
      expect.arrayContaining([
        { label: "Exit code", value: "137" },
        { label: "Out of memory", value: "yes, it was killed" },
      ]),
    );
    expect(inspectModel(null)).toEqual({ id: "", name: "", image: "", state: "", sections: [] });
    expect(inspectModel({ Config: { Env: "nope", Labels: [] }, Mounts: {} }).sections).toEqual([]);
    expect(firstOf("not json")).toBeUndefined();
  });

  it("writes bytes with binary units", () => {
    expect(bytes(0)).toBe("");
    expect(bytes(1536)).toBe("1.5 KiB");
    expect(bytes(2 * 1024 ** 3)).toBe("2 GiB");
  });
});
