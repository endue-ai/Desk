// The commands agents call: reads answer with plain data, never a variable's value; a name that
// is not a container's is refused before docker sees it.
import { describe, expect, it, vi } from "vitest";
import { containerData, wireCommands } from "../ui/commands.js";
import { stacksOf } from "../ui/model.js";
import * as parse from "../ui/parse.js";
import { createStore } from "../ui/store.js";

const web = parse.container({
  Id: "b".repeat(64),
  Name: "/shop-web-1",
  State: { Status: "running", StartedAt: "2026-11-16T10:00:00Z" },
  Config: {
    Image: "nginx:1.27",
    Env: ["SECRET_KEY=abc123"],
    Labels: { "com.docker.compose.project": "shop", "com.docker.compose.service": "web" },
  },
  NetworkSettings: { Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] } },
});
const failed = parse.container({
  Id: "c".repeat(64),
  Name: "/migrate",
  State: { Status: "exited", ExitCode: 1 },
  Config: { Image: "app" },
});

function setup() {
  const store = createStore((fn) => fn());
  store.set({
    containers: [web, failed],
    engine: { status: "up", problem: "", kind: "", info: null },
  });
  const handlers = new Map<string, (args: unknown) => unknown>();
  const act = { container: vi.fn(async () => true), compose: vi.fn(async () => true) };
  const app = {
    store,
    live: { refresh: vi.fn() },
    act,
    stacks: () => stacksOf(store.state.containers, []),
    docker: vi.fn(),
  };
  wireCommands(
    { commands: { on: (id: string, fn: (a: unknown) => unknown) => handlers.set(id, fn) } },
    app as never,
  );
  return { handlers, act, app };
}

describe("commands", () => {
  it("lists containers as data, those in trouble when asked", async () => {
    const { handlers } = setup();
    const all = (await handlers.get("endue.docker-studio.containers")?.({})) as unknown[];
    expect(all).toHaveLength(2);
    const problems = (await handlers.get("endue.docker-studio.containers")?.({
      state: "problems",
    })) as Array<{ name: string }>;
    expect(problems.map((c) => c.name)).toEqual(["migrate"]);
    expect(containerData(web)).toMatchObject({
      name: "shop-web-1",
      stack: "shop",
      service: "web",
      ports: ["8080:80/tcp"],
    });
  });

  it("gives a container's variables by name only", async () => {
    const { handlers } = setup();
    const detail = (await handlers.get("endue.docker-studio.container")?.({
      container: "shop-web-1",
    })) as { environment: string[] };
    expect(detail.environment).toEqual(["SECRET_KEY"]);
    expect(JSON.stringify(detail)).not.toContain("abc123");
  });

  it("acts through the studio's own actions, names checked", async () => {
    const { handlers, act } = setup();
    await handlers.get("endue.docker-studio.act")?.({
      action: "restart",
      containers: ["shop-web-1"],
    });
    expect(act.container).toHaveBeenCalledWith(
      "restart",
      [expect.objectContaining({ name: "shop-web-1" })],
      false,
    );
    await expect(
      handlers.get("endue.docker-studio.act")?.({ action: "restart", containers: ["--all"] }),
    ).rejects.toThrow();
    await expect(
      handlers.get("endue.docker-studio.act")?.({ action: "format", containers: ["shop-web-1"] }),
    ).rejects.toThrow();
    await handlers.get("endue.docker-studio.compose")?.({ stack: "shop", action: "restart" });
    expect(act.compose).toHaveBeenCalledWith("restart", "shop");
  });
});
