import { describe, expect, it, vi } from "vitest";
import type { Invocation } from "../../../packages/plugin-sdk/src/index";
import { createActions } from "../ui/actions.js";
import { wireCommands } from "../ui/commands.js";
import { container, image } from "../ui/parse.js";
import { createStore } from "../ui/store.js";

const web = container({ Id: "b".repeat(64), Name: "/web", State: { Status: "running" } });
const webImage = image({ Id: `sha256:${"d".repeat(64)}`, RepoTags: ["web:stable", "web:next"] });

function setup() {
  const store = createStore((fn) => fn());
  store.set({
    containers: [web],
    images: [webImage],
    engine: { status: "up", problem: "", kind: "", info: null },
  });
  type Handler = (args: unknown, invocation?: Partial<Invocation>) => unknown;
  const handlers = new Map<string, Handler>();
  const act = { container: vi.fn(async () => true) };
  const engine = { load: vi.fn(async (_list: string) => {}) };
  const docker = vi.fn(async (_args: string[], _options?: unknown) => ({
    stdout: "Total reclaimed space: 12kB",
    stderr: "",
  }));
  const overlay = { confirm: vi.fn(async () => true) };
  const images = { removeImages: vi.fn(async () => true) };
  const builds = { start: vi.fn(async () => ({ id: "build-1", status: "ok", image: "web:next" })) };
  wireCommands(
    {
      commands: {
        on: (name: string, fn: Handler) => handlers.set(name, fn),
      },
    },
    { store, act, engine, docker, overlay, images, builds } as never,
  );
  return {
    act,
    engine,
    docker,
    overlay,
    images,
    builds,
    invoke: (id: string, args: unknown = {}, invocation?: Partial<Invocation>) => {
      const run = handlers.get(`endue.docker-studio.${id}`);
      if (!run) throw new Error(`Unknown Studio tool ${id}`);
      return run(args, invocation);
    },
  };
}

describe("Docker Studio agent operations", () => {
  it("reads volume and network collections as data", async () => {
    const { invoke, engine } = setup();
    await expect(invoke("volumes")).resolves.toEqual([]);
    await expect(invoke("networks")).resolves.toEqual([]);
    expect(engine.load.mock.calls).toEqual([["volumes"], ["networks"]]);
  });

  it("starts or stops through exact named commands and reuses a remove review", async () => {
    const { invoke, act } = setup();
    const args = { containers: ["web"] };
    await invoke("start", args);
    expect(act.container).toHaveBeenLastCalledWith(
      "start",
      [expect.objectContaining({ name: "web" })],
      false,
    );
    await invoke("stop", args);
    expect(act.container).toHaveBeenLastCalledWith(
      "stop",
      [expect.objectContaining({ name: "web" })],
      false,
    );
    await invoke("remove", args, { caller: "agent:eris", approved: true });
    expect(act.container).toHaveBeenLastCalledWith(
      "remove",
      [expect.objectContaining({ name: "web" })],
      true,
    );
  });

  it("removes only the named image reference and prunes only the chosen kinds", async () => {
    const { invoke, images, docker, overlay } = setup();
    const reviewed = { caller: "agent:eris", approved: true };
    await expect(invoke("remove-image", { image: "web:next" }, reviewed)).resolves.toEqual({
      done: true,
    });
    expect(images.removeImages).toHaveBeenCalledWith(
      [expect.objectContaining({ id: webImage.id, refs: ["web:next"] })],
      true,
    );
    await expect(invoke("prune", { kinds: ["networks", "cache"] }, reviewed)).resolves.toEqual({
      done: true,
      results: [
        { kind: "networks", done: true, freed: "12kB" },
        { kind: "cache", done: true, freed: "12kB" },
      ],
    });
    expect(docker.mock.calls.map(([argv]) => argv)).toEqual([
      ["network", "prune", "--force"],
      ["builder", "prune", "--force"],
    ]);
    await expect(invoke("prune", { kinds: ["networks", "anything"] }, reviewed)).rejects.toThrow(
      /Choose cleanup kinds/,
    );
    expect(docker).toHaveBeenCalledTimes(2);
    expect(overlay.confirm).not.toHaveBeenCalled();
  });

  it("runs an agent's build and Compose file through their checked operations", async () => {
    const { invoke, builds, docker } = setup();
    await expect(
      invoke("build", { context: "/sample/project", tag: "web:next" }, { caller: "agent:eris" }),
    ).resolves.toMatchObject({ id: "build-1", status: "ok" });
    expect(builds.start).toHaveBeenCalledWith(
      expect.objectContaining({ context: "/sample/project", tag: "web:next" }),
    );
    await expect(
      invoke("compose-up", { file: "/sample/project/compose.yaml", project: "sample" }),
    ).resolves.toMatchObject({ done: true });
    expect(docker).toHaveBeenCalledWith(
      [
        "compose",
        "--ansi",
        "never",
        "--project-name",
        "sample",
        "--file",
        "/sample/project/compose.yaml",
        "up",
        "--detach",
        "--remove-orphans",
      ],
      { cwd: "/sample/project", timeoutMs: 0 },
    );
  });

  it("keeps a direct person's confirmation and sends the dedicated shell gesture to Terminal", async () => {
    const confirm = vi.fn(async () => true);
    const run = vi.fn(async () => ({}));
    const docker = vi.fn(async () => ({}));
    const action = createActions({
      settings: { confirm: true, shell: "/bin/sh", stopTimeout: 10 },
      overlay: { confirm },
      docker,
      engine: { load: vi.fn() },
      store: { state: { context: "local" }, touch: vi.fn() },
      ctx: { commands: { run } },
      toast: vi.fn(),
      pending: new Set(),
    } as never);
    await expect(action.container("kill", [web])).resolves.toBe(true);
    await expect(action.container("kill", [web], true)).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(docker).toHaveBeenCalledTimes(2);
    await action.shell(web);
    expect(run).toHaveBeenCalledWith("endue.terminal.run", {
      command: "docker",
      args: ["--context", "local", "exec", "--interactive", "--tty", "--", web.id, "/bin/sh"],
      title: web.name,
      dockerShell: true,
    });
  });
});
