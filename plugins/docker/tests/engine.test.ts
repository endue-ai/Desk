import { describe, expect, it } from "vitest";
import {
  explain,
  kindOf,
  NO_COMPOSE,
  NOT_RUNNING,
  SOCKET_DENIED,
  stripAnsi,
} from "../ui/errors.js";
import {
  parseContexts,
  parseDiskUse,
  parseEvent,
  parseStats,
  parseVersion,
  statsFor,
} from "../ui/parse-engine.js";
import {
  CONTEXTS,
  DAEMON_DOWN,
  DB_ID,
  DISK,
  event,
  STATS,
  VERSION,
  VERSION_DOWN,
  WEB_ID,
} from "./fixtures";

const failed = (stderr: string, code = 1) => ({ code, signal: null, stdout: "", stderr });

describe("parseVersion", () => {
  it("reads the client and the server, and no server when the daemon is down", () => {
    expect(parseVersion(VERSION)).toEqual({
      client: {
        version: "29.8.1",
        api: "1.56",
        os: "darwin",
        arch: "arm64",
        context: "desktop-linux",
      },
      server: {
        version: "29.8.1",
        api: "1.56",
        minApi: "1.40",
        os: "linux",
        arch: "arm64",
        platform: "Docker Desktop 4.93.0 (240920)",
      },
    });
    expect(parseVersion(VERSION_DOWN).server).toBeNull();
    expect(parseVersion("")).toEqual({ client: null, server: null });
  });
});

describe("parseContexts, parseStats and parseDiskUse", () => {
  it("reads the contexts with the current one", () => {
    const contexts = parseContexts(CONTEXTS);
    expect(contexts.map((c) => c.name)).toEqual(["default", "desktop-linux", "build"]);
    expect(contexts.find((c) => c.current)?.endpoint).toBe(
      "unix:///Users/me/.docker/run/docker.sock",
    );
  });

  it("keys stats by full id and finds them by a short one too", () => {
    const stats = parseStats(STATS);
    expect(statsFor(stats, DB_ID)).toMatchObject({
      cpu: 12.4,
      cpuText: "12.40%",
      memPerc: 0.66,
      pids: 12,
    });
    const short = parseStats(STATS.replaceAll(WEB_ID, WEB_ID.slice(0, 12)));
    expect(statsFor(short, WEB_ID)?.memText).toBe("37.75MiB / 7.747GiB");
    expect(parseStats('{"Container":"x","CPUPerc":"--"}').get("x")?.cpu).toBe(0);
  });

  it("reads disk use per type", () => {
    expect(parseDiskUse(DISK)[3]).toEqual({
      type: "Build Cache",
      total: "214",
      active: "0",
      size: "29.57GB",
      reclaimable: "17.7GB",
    });
  });
});

describe("parseEvent", () => {
  it("splits an action's detail and keeps the actor's attributes and the time in milliseconds", () => {
    const parsed = parseEvent(
      event("container", "health_status: unhealthy", DB_ID, { name: "shop-db-1" }),
    );
    expect(parsed).toMatchObject({
      type: "container",
      action: "health_status",
      detail: "unhealthy",
      id: DB_ID,
      name: "shop-db-1",
    });
    expect(Math.floor((parsed?.time ?? 0) / 1000)).toBe(1793426838);
    expect(
      parseEvent(event("container", "die", WEB_ID, { exitCode: "1" }))?.attributes.exitCode,
    ).toBe("1");
    expect(parseEvent("not an event")).toBeUndefined();
    expect(parseEvent('{"Type":"container"}')).toBeUndefined();
  });
});

describe("explain", () => {
  it("says the failures everyone meets the same way every time", () => {
    expect(explain(["ps"], failed(DAEMON_DOWN))).toBe(NOT_RUNNING);
    expect(
      explain(
        ["ps"],
        failed(
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
        ),
      ),
    ).toBe(NOT_RUNNING);
    expect(
      explain(
        ["ps"],
        failed(
          "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get ...",
        ),
      ),
    ).toBe(SOCKET_DENIED);
    expect(
      explain(
        ["compose"],
        failed("docker: 'compose' is not a docker command.\nSee 'docker --help'"),
      ),
    ).toBe(NO_COMPOSE);
    expect(explain(["compose"], failed("docker: unknown command: docker compose\n"))).toBe(
      NO_COMPOSE,
    );
    expect(
      explain(
        ["ps"],
        failed(
          'Failed to initialize: unable to resolve docker endpoint: context "gone": context not found: open …',
        ),
      ),
    ).toBe("The Docker context gone does not exist: pick another with Docker: switch context.");
  });

  it("takes docker's prefixes and usage hints off, and says something when docker said nothing", () => {
    expect(explain(["stop"], failed("Error response from daemon: No such container: web\n"))).toBe(
      "No such container: web.",
    );
    expect(
      explain(
        ["run"],
        failed(
          "docker: Error response from daemon: Conflict. The name is in use.\n\nRun 'docker run --help' for more information\n",
        ),
      ),
    ).toBe("Conflict. The name is in use.");
    expect(
      explain(["logs", "--tail", "5"], { code: 2, signal: null, stdout: "", stderr: "" }),
    ).toBe("docker logs exited with 2.");
    expect(explain(["stop"], { code: null, signal: "kill", stdout: "", stderr: "" })).toBe(
      "docker stop was ended by kill.",
    );
    expect(kindOf("all fine")).toBeUndefined();
  });

  it("strips colours, titles and control characters but keeps tabs", () => {
    const esc = String.fromCharCode(27);
    expect(stripAnsi(`${esc}[1;31mred${esc}[0m ${esc}]0;title\u0007a\tb\r`)).toBe("red a\tb");
  });
});
