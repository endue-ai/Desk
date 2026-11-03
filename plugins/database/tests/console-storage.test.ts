import { describe, expect, it, vi } from "vitest";
import { createConsoles } from "../ui/consoles.js";
import { SAVED } from "./harness";

function setup(fail = false) {
  const connection = SAVED[0];
  if (!connection) throw new Error("Missing fixture connection");
  const messages: string[] = [];
  const call = vi.fn(async (method: string, params: { key: string; value?: string }) => {
    if (method === "store.set" && fail) throw new Error("Storage unavailable");
    if (method === "store.get") return {};
    return { value: params.value };
  });
  const deps = {
    commands: { run: async () => "buffer" },
    bridge: { call },
    connection: () => connection,
    settings: () => ({ maxRows: 500 }),
    view: { console: () => {}, say: (message: string) => messages.push(message) },
    changed: () => {},
  } as unknown as Parameters<typeof createConsoles>[0];
  return { consoles: createConsoles(deps), connection, messages, call };
}

describe("console storage", () => {
  it("warns when 70 KiB of text exceeds the saved limit", async () => {
    const { consoles, connection, messages, call } = setup();
    await consoles.open(connection);
    consoles.edited("x".repeat(70 * 1024));
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(call).toHaveBeenCalledWith("store.set", {
      key: "console:c-lite",
      value: "x".repeat(60 * 1024),
    });
    expect(messages).toContain("Only the first 60 KB of this console is kept");
  });

  it("reports a failure to save the console", async () => {
    const { consoles, connection, messages } = setup(true);
    await consoles.open(connection);
    consoles.edited("select 1");
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(messages.join(" ")).toMatch(/(save|sav(ing|ed)|keep|stor)/iu);
    expect(messages.join(" ")).toMatch(/(fail|could not|cannot|unable|error)/iu);
  });
});
