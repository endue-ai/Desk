import { BridgeClient, browserStub, type StubHandlers } from "@endue-ai/bridge";
import { describe, expect, test } from "vitest";
import { studioShell } from "./shell-studio";

const STUDIO = { permission: "studio:manage" };

function setup(handlers: StubHandlers = {}) {
  const stub = browserStub(handlers);
  const client = new BridgeClient({
    name: "test",
    call: (request, caller) => stub.call(request, caller),
    onEvent: (listener) => stub.onEvent(listener),
  });
  const calls = () => stub.calls.map(({ method, params }) => ({ method, params }));
  return { studio: studioShell(client), calls };
}

const at = "2026-11-01T09:00:00Z";

describe("studio for the shell (ADR 0129)", () => {
  test("every read goes to studio.* under studio:manage", async () => {
    const { studio, calls } = setup({
      "studio.agents.list": () => ({
        agents: [
          {
            id: "ag_1",
            slug: "miso",
            name: "Miso",
            status: "active",
            createdAt: at,
            updatedAt: at,
          },
        ],
      }),
      "studio.conversations.list": () => ({ conversations: [], total: 0, hasMore: false }),
      "studio.spaces.list": () => ({
        spaces: [
          {
            id: "sp_1",
            key: "launch",
            name: "Launch",
            status: "active",
            createdAt: at,
            updatedAt: at,
          },
        ],
      }),
      "studio.spaces.get": ({ spaceId }) => ({
        space: {
          id: spaceId,
          key: "launch",
          name: "Launch",
          status: "active",
          createdAt: at,
          updatedAt: at,
        },
        agents: [],
        work: [],
        results: [],
        rooms: [],
        problems: [],
      }),
    });
    expect((await studio.agents()).map((a) => a.name)).toEqual(["Miso"]);
    expect(await studio.conversations()).toEqual([]);
    expect((await studio.spaces()).map((s) => s.id)).toEqual(["sp_1"]);
    expect((await studio.space("sp_1")).space.name).toBe("Launch");
    expect(calls()).toEqual([
      { method: "studio.agents.list", params: { scope: STUDIO } },
      { method: "studio.conversations.list", params: { limit: 50, scope: STUDIO } },
      { method: "studio.spaces.list", params: { scope: STUDIO } },
      { method: "studio.spaces.get", params: { spaceId: "sp_1", scope: STUDIO } },
    ]);
  });

  test("only endue.ai's https pages open, through shell.open", async () => {
    const { studio, calls } = setup({ "shell.open": () => ({ opened: true }) });
    await studio.open("https://endue.ai/spaces/sp_1");
    await expect(studio.open("https://elsewhere.example/x")).rejects.toThrow(/endue.ai/);
    await expect(studio.open("https://endue.ai.example/x")).rejects.toThrow(/endue.ai/);
    expect(calls()).toEqual([
      {
        method: "shell.open",
        params: {
          target: "https://endue.ai/spaces/sp_1",
          scope: { permission: "shell:open", schemes: ["https"] },
        },
      },
    ]);
  });
});
