// Log lines read into their time, service, level and JSON fields; a container's folders as ls
// prints them; every path the Files tab hands docker checked.
import { describe, expect, it } from "vitest";
import { childOf, containerPath, crumbs, lsArgs, parentOf, parseLs } from "../ui/files.js";
import { createRing, filterLines, levelOf, logArgs, parseLine } from "../ui/logs.js";

describe("logs", () => {
  it("reads the time, the service and a JSON line's message and fields", () => {
    const line = parseLine(
      'api-1  | 2026-11-16T10:00:00.123456789Z {"level":"error","msg":"payment timeout","route":"/api/orders","ms":3021}',
      "stdout",
      true,
      0,
    );
    expect(line.source).toBe("api");
    expect(line.time).toBe(Date.parse("2026-11-16T10:00:00.123Z"));
    expect(line.level).toBe("error");
    expect(line.message).toBe("payment timeout");
    expect(line.fields).toEqual([
      ["route", "/api/orders"],
      ["ms", "3021"],
    ]);
  });

  it("tells levels from words and keeps a ring", () => {
    expect(levelOf("2026 WARN job retry")).toBe("warn");
    expect(levelOf("LOG:  checkpoint complete")).toBe("info");
    expect(levelOf("GET / 200")).toBe("");
    const ring = createRing(3);
    for (const text of ["a", "b ERROR", "c", "d"]) ring.push(text, "stdout", false);
    expect(ring.lines.map((l) => l.text)).toEqual(["b ERROR", "c", "d"]);
    expect(ring.first).toBe(1);
    expect(filterLines(ring.lines, "", new Set(["error"])).map((l) => l.text)).toEqual(["b ERROR"]);
    expect(filterLines(ring.lines, "C", new Set()).map((l) => l.text)).toEqual(["c"]);
  });

  it("reads a container's or a stack's logs with docker logs and compose logs", () => {
    expect(logArgs({ kind: "container", id: "web" }, { tail: 100, follow: true })).toEqual([
      "logs",
      "--timestamps",
      "--tail",
      "100",
      "--follow",
      "--",
      "web",
    ]);
    expect(
      logArgs(
        { kind: "project", name: "shop", files: ["/a/compose.yaml"] },
        { tail: 5, follow: false },
      ),
    ).toEqual([
      "compose",
      "--ansi",
      "never",
      "--project-name",
      "shop",
      "--file",
      "/a/compose.yaml",
      "logs",
      "--no-color",
      "--timestamps",
      "--tail",
      "5",
    ]);
    expect(() =>
      logArgs({ kind: "container", id: "--privileged" }, { tail: 1, follow: false }),
    ).toThrow();
  });
});

describe("files", () => {
  it("reads ls -lA, folders first", () => {
    const out = [
      "total 12",
      "-rw-r--r--    1 root     root          1093 Nov 14 09:12 default.conf",
      "drwxr-xr-x    2 root     root          4096 Nov 14 09:12 conf.d",
      "lrwxrwxrwx    1 root     root            12 Nov 14  2023 current -> /etc/release",
    ].join("\n");
    const entries = parseLs(out, "/etc/nginx");
    expect(entries.map((e) => [e.name, e.kind])).toEqual([
      ["conf.d", "dir"],
      ["current", "link"],
      ["default.conf", "file"],
    ]);
    expect(entries[2]?.size).toBe(1093);
    expect(entries[1]?.target).toBe("/etc/release");
  });

  it("checks and resolves paths", () => {
    expect(containerPath("/a/./b/../c/")).toBe("/a/c");
    expect(parentOf("/a/c")).toBe("/a");
    expect(parentOf("/a")).toBe("/");
    expect(childOf("/", "etc")).toBe("/etc");
    expect(crumbs("/etc/nginx").map((c) => c.path)).toEqual(["/", "/etc", "/etc/nginx"]);
    expect(() => containerPath("etc")).toThrow();
    expect(lsArgs("web", "/etc")).toEqual(["exec", "--", "web", "ls", "-lA", "--", "/etc"]);
  });
});
