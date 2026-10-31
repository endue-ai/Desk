import { describe, expect, it } from "vitest";
import { NOT_RUNNING } from "../ui/errors.js";
import { COMMANDS } from "../ui/schemas.js";
import { EVENT_ARGS } from "../ui/watch.js";
import { DAEMON_DOWN, DB_ID, event, INSPECT, PS, VERSION, VERSION_DOWN, WEB_ID } from "./fixtures";
import { engine, mount } from "./harness";

const wait = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the engine", () => {
  it("says which engine and context it talks to, follows its events and lists the containers", async () => {
    const m = await mount();
    expect(m.view.headers.at(-1)).toEqual({
      context: "desktop-linux",
      engine: "Docker 29.8.1 · Docker Desktop 4.93.0 (240920)",
      problem: "",
      live: true,
    });
    expect(m.docker.last("events")?.args).toEqual([...EVENT_ARGS]);
    expect(m.view.shown.at(-1)).toBe("containers");
    expect(m.view.latest("containers").containers.map((c: { name: string }) => c.name)).toEqual([
      "shop-web-1",
      "shop-db-1",
      "scratch",
    ]);
    expect(m.docker.last("ps")?.args.slice(0, 3)).toEqual(["ps", "-a", "--no-trunc"]);
  });

  it("registers every command with its description and argument schema", async () => {
    const m = await mount();
    const registered = m.params("cmd.register") as Array<{
      id: string;
      argsSchema: { type: string };
    }>;
    expect(registered.map((r) => r.id)).toEqual(COMMANDS.map((c) => c.id));
    expect(registered.every((r) => r.argsSchema.type === "object")).toBe(true);
    const run = registered.find((r) => r.id === "endue.docker.run") as unknown as {
      argsSchema: { required: string[] };
    };
    expect(run.argsSchema.required).toEqual(["image"]);
  });

  it("says Docker is not running instead of listing, and recovers on refresh", async () => {
    let up = false;
    const m = await mount({
      script: engine({
        version: () =>
          up ? { stdout: VERSION } : { stdout: VERSION_DOWN, stderr: DAEMON_DOWN, code: 1 },
        ps: () => (up ? { stdout: PS } : { stderr: DAEMON_DOWN, code: 1 }),
        events: () => (up ? { hang: true } : { stderr: DAEMON_DOWN, code: 1 }),
      }),
    });
    expect(m.view.headers.at(-1)?.problem).toBe(NOT_RUNNING);
    expect(m.view.lists).toEqual([]);
    up = true;
    await m.keys.refresh?.();
    expect(m.view.headers.at(-1)?.problem).toBe("");
    expect(m.view.latest("containers").containers).toHaveLength(3);
  });
});

describe("the engine coming back", () => {
  it("reads the screen again by itself once the event stream is back", async () => {
    let up = false;
    const m = await mount({
      script: engine({
        version: () =>
          up ? { stdout: VERSION } : { stdout: VERSION_DOWN, stderr: DAEMON_DOWN, code: 1 },
        ps: () => (up ? { stdout: PS } : { stderr: DAEMON_DOWN, code: 1 }),
        events: () => (up ? { hang: true } : { stderr: DAEMON_DOWN, code: 1 }),
      }),
    });
    expect(m.view.headers.at(-1)?.problem).toBe(NOT_RUNNING);
    up = true;
    m.clock.advance(1000);
    await m.settle();
    expect(m.view.headers.at(-1)).toMatchObject({ problem: "", live: true });
    expect(m.view.latest("containers").containers).toHaveLength(3);
  });
});

describe("lists", () => {
  it("answers each list command with what it shows", async () => {
    const m = await mount();
    const containers = (await m.host.invoke("endue.docker.containers")) as Array<{
      id: string;
      stats: unknown;
    }>;
    expect(containers[0]).toMatchObject({ id: WEB_ID, stats: null });
    expect(
      ((await m.host.invoke("endue.docker.compose")) as Array<{ name: string }>).map((p) => p.name),
    ).toEqual(["shop", "old-demo"]);
    expect(m.view.latest("compose").containers.map((c: { service: string }) => c.service)).toEqual([
      "web",
      "db",
    ]);
    expect(((await m.host.invoke("endue.docker.images")) as unknown[]).length).toBe(3);
    expect(((await m.host.invoke("endue.docker.volumes")) as unknown[]).length).toBe(2);
    expect(((await m.host.invoke("endue.docker.networks")) as unknown[]).length).toBe(3);
    const system = (await m.host.invoke("endue.docker.system")) as {
      contexts: unknown[];
      disk: unknown[];
    };
    expect(system.contexts).toHaveLength(3);
    expect(system.disk).toHaveLength(4);
    expect(await m.host.invoke("endue.docker.open", { view: "volumes" })).toBe("volumes");
    expect(m.view.shown.at(-1)).toBe("volumes");
  });

  it("lists only running containers after a, and keeps the choice across a reload", async () => {
    const m = await mount();
    await m.keys.toggleAll?.();
    expect(m.docker.last("ps")?.args.slice(0, 2)).toEqual(["ps", "--no-trunc"]);
    expect(m.host.state).toMatchObject({ all: false, view: "containers" });
    await m.host.invoke("endue.docker.containers", { all: true });
    expect(m.docker.last("ps")?.args[1]).toBe("-a");
  });

  it("samples resource use while the containers show, at the interval", async () => {
    const m = await mount({ init: { "endue.docker.stats-interval": 5 } });
    m.clock.advance(0);
    await m.settle();
    expect(m.docker.of("stats")).toHaveLength(1);
    expect(m.view.latest("containers").stats.get(DB_ID)).toMatchObject({ cpuText: "12.40%" });
    m.clock.advance(5000);
    await m.settle();
    expect(m.docker.of("stats")).toHaveLength(2);
    await m.keys.images?.();
    m.clock.advance(60_000);
    await m.settle();
    expect(m.docker.of("stats")).toHaveLength(2);
  });
});

describe("events", () => {
  it("refreshes the list on screen once a burst of events is over, and tells about failures", async () => {
    const m = await mount();
    const stream = m.docker.last("events");
    const before = m.docker.of("ps").length;
    m.docker.write(
      stream?.procId ?? "",
      `${event("container", "die", WEB_ID, { exitCode: "2" })}\n`,
    );
    m.docker.write(stream?.procId ?? "", `${event("container", "start", WEB_ID)}\n`);
    await wait();
    m.clock.advance(250);
    await m.settle();
    expect(m.docker.of("ps").length).toBe(before + 1);
    expect(m.params("ui.notify")).toEqual([
      {
        level: "warning",
        title: "shop-web-1 stopped with exit code 2",
        body: "It ended on its own. Its logs say why.",
        scope: { permission: "ui:notify" },
      },
    ]);
  });

  it("does not tell about a container this plugin stopped", async () => {
    const m = await mount();
    await m.host.invoke("endue.docker.stop", { container: WEB_ID });
    m.docker.write(
      m.docker.last("events")?.procId ?? "",
      `${event("container", "die", WEB_ID, { exitCode: "137" })}\n`,
    );
    await wait();
    expect(m.params("ui.notify")).toEqual([]);
  });
});

describe("logs", () => {
  it("opens a container's logs as a buffer and follows them; closing the buffer stops them", async () => {
    const m = await mount({ script: engine({ logs: { hang: true } }) });
    expect(await m.host.invoke("endue.docker.logs", { container: "shop-web-1" })).toEqual({
      title: "docker logs: shop-web-1",
      follow: true,
    });
    expect(m.ran("desk.buffers.open")).toEqual([{ name: "docker logs: shop-web-1" }]);
    expect(m.view.shown.at(-1)).toBe("logs");
    const stream = m.docker.last("logs");
    expect(stream?.args).toEqual([
      "logs",
      "--timestamps",
      "--tail",
      "500",
      "--follow",
      "--",
      "shop-web-1",
    ]);
    m.docker.write(
      stream?.procId ?? "",
      "2026-10-31T06:00:00Z hello\n2026-10-31T06:00:01Z world\n",
    );
    await m.settle();
    expect(m.view.logViews.at(-1)?.lines.map((l) => l.text)).toEqual(["hello", "world"]);
    await m.host.command("desk.buffers.closed", { buffer: "endue.docker:1" });
    await m.settle();
    expect(m.docker.killed.map((k) => k.procId)).toContain(stream?.procId);
    expect(m.view.shown.at(-1)).toBe("containers");
  });

  it("stops and starts following, filters and shows times from the keys", async () => {
    const m = await mount({
      script: engine({ logs: { hang: true } }),
      commands: { "desk.palette.pick": () => "error" },
    });
    m.view.selected = { kind: "project", name: "shop", files: [] };
    await m.keys.logs?.();
    expect(m.docker.last("compose")?.cwd).toBe("/");
    await m.keys.toggleFollow?.();
    expect(m.view.logViews.at(-1)).toMatchObject({ follow: false, running: false });
    await m.keys.filter?.();
    expect(m.view.logViews.at(-1)?.filter).toBe("error");
    m.keys.toggleTimestamps?.();
    expect(m.view.logViews.at(-1)?.timestamps).toBe(true);
    await m.keys.toggleFollow?.();
    expect(m.view.logViews.at(-1)).toMatchObject({ follow: true, running: true });
  });

  it("reads the last lines for agents without a view", async () => {
    const m = await mount({
      script: engine({
        logs: { stdout: "2026-10-31T06:00:00Z one\n", stderr: "2026-10-31T06:00:01Z two\n" },
      }),
    });
    const { lines } = (await m.host.invoke("endue.docker.tail", {
      container: "web",
      tail: 5,
      since: "10m",
    })) as {
      lines: Array<{ stream: string; text: string }>;
    };
    expect(lines.map((l) => `${l.stream}:${l.text}`)).toEqual(["stdout:one", "stderr:two"]);
    expect(m.docker.last("logs")?.args).toEqual([
      "logs",
      "--timestamps",
      "--tail",
      "5",
      "--since",
      "10m",
      "--",
      "web",
    ]);
    expect(m.view.shown.at(-1)).toBe("containers");
  });
});

describe("detail, shell and files", () => {
  it("shows a container's detail as a buffer and reloads it when the container changes", async () => {
    const m = await mount();
    m.view.selected = {
      kind: "container",
      id: DB_ID,
      name: "shop-db-1",
      state: "running",
      project: "shop",
    };
    const model = (await m.host.invoke("endue.docker.inspect")) as { name: string };
    expect(model.name).toBe("shop-db-1");
    expect(m.ran("desk.buffers.open")).toEqual([{ name: "docker inspect: shop-db-1" }]);
    expect(m.docker.last("container", "inspect")?.args).toEqual([
      "container",
      "inspect",
      "--",
      DB_ID,
    ]);
    const reads = m.docker.of("container").length;
    m.docker.write(
      m.docker.last("events")?.procId ?? "",
      `${event("container", "health_status: healthy", DB_ID)}\n`,
    );
    await wait();
    m.clock.advance(250);
    await m.settle();
    expect(m.docker.of("container").length).toBe(reads + 1);
  });

  it("removes the container on screen and goes back to the list once it is gone", async () => {
    let removed = false;
    const m = await mount({
      commands: { "desk.palette.pick": () => "yes" },
      script: engine({
        rm: () => {
          removed = true;
          return {};
        },
        "container inspect": () =>
          removed
            ? { code: 1, stderr: `Error response from daemon: No such container: ${DB_ID}\n` }
            : { stdout: INSPECT },
      }),
    });
    await m.host.invoke("endue.docker.inspect", { container: DB_ID });
    expect(await m.host.invoke("endue.docker.remove")).toBe("Removed shop-db-1.");
    expect(m.view.shown.at(-1)).toBe("containers");
    expect(m.view.details.at(-1)).toBeNull();
    await m.host.command("desk.buffers.show", { buffer: "endue.docker:1" });
    await m.settle();
    expect(m.view.shown.at(-1)).toBe("containers");
  });

  it("opens a shell inside the container in a terminal, with the context in use", async () => {
    const m = await mount({ store: { context: "build" } });
    m.view.selected = {
      kind: "container",
      id: WEB_ID,
      name: "shop-web-1",
      state: "running",
      project: "shop",
    };
    await m.keys.shell?.();
    expect(m.ran("endue.terminal.run")).toEqual([
      {
        command: "docker",
        args: ["--context", "build", "exec", "-it", "--", WEB_ID, "/bin/sh"],
        title: "shop-web-1: /bin/sh",
      },
    ]);
    await m.host.invoke("endue.docker.shell", {
      container: "shop-db-1",
      command: ["psql", "-U", "postgres"],
    });
    expect((m.ran("endue.terminal.run").at(-1) as { args: string[] }).args.slice(-4)).toEqual([
      "shop-db-1",
      "psql",
      "-U",
      "postgres",
    ]);
    await expect(
      m.host.invoke("endue.docker.shell", { container: "x", command: "bash" }),
    ).rejects.toThrow(/list of text/);
  });

  it("says to turn on the terminal when it is off", async () => {
    const m = await mount({ commands: { "endue.terminal.run": undefined } });
    await expect(m.host.invoke("endue.docker.shell", { container: "web" })).rejects.toThrow(
      /Terminal plugin/,
    );
  });

  it("opens a project's Compose file on the desk, reading the projects when needed", async () => {
    const m = await mount();
    expect(await m.host.invoke("endue.docker.open-file", { project: "shop" })).toBe(
      "/Users/me/shop/compose.yaml",
    );
    expect(m.ran("desk.files.open")).toEqual([{ path: "/Users/me/shop/compose.yaml" }]);
  });
});

describe("contexts and reloads", () => {
  it("switches context for this plugin only, keeps it, and watches the new engine", async () => {
    const m = await mount({ commands: { "desk.palette.pick": () => "build" } });
    expect(await m.host.invoke("endue.docker.context")).toBe("build");
    expect(m.store.context).toBe("build");
    expect(
      m.docker.calls.filter((c) => c.args[0] === "context").every((c) => c.args[1] === "ls"),
    ).toBe(true);
    expect(m.docker.last("events")?.context).toBe("build");
    expect(m.docker.last("version")?.context).toBe("build");
    expect(m.view.said.at(-1)).toBe("Using the context build.");
    const picked = m.ran("desk.palette.pick")[0] as { items: Array<{ id: string }> };
    expect(picked.items.map((i) => i.id)).toEqual(["@cli", "default", "desktop-linux", "build"]);
    expect(await m.host.invoke("endue.docker.context", { name: "" })).toBe("");
    expect(m.docker.last("version")?.context).toBeUndefined();
    await expect(m.host.invoke("endue.docker.context", { name: "-H tcp://x" })).rejects.toThrow(
      /not a context name/,
    );
  });

  it("comes back to the list, logs or detail a reload left", async () => {
    const images = await mount({ state: { view: "images", back: "images", all: true } });
    expect(images.view.shown.at(-1)).toBe("images");
    expect(images.view.latest("images").images).toHaveLength(3);
    const logs = await mount({
      script: engine({ logs: { hang: true } }),
      state: {
        view: "logs",
        back: "compose",
        logs: { kind: "container", id: WEB_ID, name: "shop-web-1" },
      },
    });
    expect(logs.view.shown.at(-1)).toBe("logs");
    expect(logs.docker.last("logs")?.args.at(-1)).toBe(WEB_ID);
    expect(logs.app.back()).toBe("compose");
    const detail = await mount({ state: { view: "inspect", detail: DB_ID } });
    expect(detail.view.shown.at(-1)).toBe("inspect");
    expect(detail.view.details.at(-1)?.name).toBe("shop-db-1");
  });
});
