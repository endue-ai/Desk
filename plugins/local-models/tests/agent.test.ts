import { describe, expect, it, vi } from "vitest";
import manifest from "../plugin.json";
import { createApp } from "../ui/app.js";
import { wireCommands } from "../ui/commands.js";

const sample = { id: "demo", name: "Demo", serverId: "fixture", caps: [] };

describe("local models agent commands", () => {
  it("declares agent reads, named model actions and reviewed deletion", () => {
    const commands = manifest.contributes.commands;
    for (const name of ["models", "library", "threads", "thread", "search"]) {
      expect(commands.find(({ id }) => id.endsWith(`.${name}`))).toMatchObject({
        agent: true,
        readOnly: true,
      });
    }
    for (const name of ["ask", "load", "eject", "download"]) {
      expect(commands.find(({ id }) => id.endsWith(`.${name}`))).toMatchObject({ agent: true });
    }
    expect(commands.find(({ id }) => id.endsWith(".delete-model"))).toMatchObject({
      agent: true,
      irreversible: true,
    });
  });

  it("answers a named model's question and returns model data", async () => {
    const handlers = new Map<string, (args?: unknown) => unknown>();
    const app = {
      S: { get: () => ({ ready: true, generating: false, models: [sample], servers: [] }) },
      newChat: vi.fn(() => ({ id: "t-1" })),
      send: vi.fn(async () => ({ content: "Local answer" })),
    };
    wireCommands(
      { commands: { on: (id: string, run: (args?: unknown) => unknown) => handlers.set(id, run) } },
      app as never,
    );
    const run = (name: string, args?: unknown) => {
      const command = handlers.get(`endue.local-models.${name}`);
      if (!command) throw new Error(`Missing command ${name}`);
      return command(args);
    };
    await expect(run("models")).resolves.toMatchObject({ models: [{ id: "demo", name: "Demo" }] });
    await expect(run("ask", { model: "demo", prompt: "Say hello" })).resolves.toMatchObject({
      answer: "Local answer",
      thread: "t-1",
    });
  });

  it("starts silently with a remote server and asks again only when explicitly allowed", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const bridge = {
      onEvent: () => () => {},
      async call(method: string, params: Record<string, unknown>) {
        calls.push({ method, params });
        if (method === "store.get" && params.key === "servers")
          return { value: [{ host: "fixture.invalid", port: 10800 }] };
        if (method === "store.get") return {};
        if (method === "net.connect")
          throw Object.assign(new Error("not granted"), { code: "permission_denied" });
        if (method === "proc.spawn")
          throw Object.assign(new Error("not available"), { code: "not_found" });
        if (method === "perm.request") return { granted: true };
        return {};
      },
    };
    const app = createApp(bridge);
    await app.start();
    expect(calls.filter(({ method }) => method === "perm.request")).toEqual([]);
    await app.allowServer({ host: "fixture.invalid", port: 10800 });
    expect(calls.filter(({ method }) => method === "perm.request")).toMatchObject([
      {
        params: {
          permission: { permission: "net:connect", hosts: ["fixture.invalid:10800"] },
          duration: "always",
          again: true,
        },
      },
    ]);
  });
});
