import { describe, expect, it, vi } from "vitest";
import { createConsoles } from "../ui/consoles.js";
import { SAVED } from "./harness";

function setup(fail = false, given?: (method: string, params: never) => Promise<unknown>) {
  const connection = SAVED[0];
  if (!connection) throw new Error("Missing fixture connection");
  const messages: string[] = [];
  const call =
    given ??
    vi.fn(async (method: string, params: { key: string; value?: string }) => {
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
  it("keeps console text past the store's limit in a file and reads it back whole", async () => {
    const store: Record<string, unknown> = {};
    const files: Record<string, string> = {};
    const scopes: unknown[] = [];
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "store.set") store[params.key as string] = params.value;
      if (method === "store.get")
        return (params.key as string) in store ? { value: store[params.key as string] } : {};
      if (method === "fs.write") {
        scopes.push(params.scope);
        files[params.path as string] = params.content as string;
        return { bytesWritten: (params.content as string).length };
      }
      if (method === "fs.read") return { content: files[params.path as string], encoding: "utf8" };
      return {};
    });
    const text = `select '${"x".repeat(70 * 1024)}';`;
    const first = setup(false, call);
    await first.consoles.open(first.connection);
    first.consoles.edited(text);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const path = "~/.endue/database/consoles/c-lite.sql";
    expect(store["console:c-lite"]).toEqual({ file: path, length: text.length });
    expect(files[path]).toBe(text);
    expect(scopes).toEqual([{ permission: "fs:write", paths: [path] }]);
    expect(first.messages).toEqual([]);
    // Back after a restart, whole.
    const second = setup(false, call);
    const shown = await second.consoles.open(second.connection);
    expect(shown.text).toBe(text);
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
