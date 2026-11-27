// What Eris reads through Data (ADR 0088): the open file's value at a JSON Pointer, nested to a
// depth, secrets kept secret, and a sentence when there is none to read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { disk, file, mount } from "./harness";

const A = file("~/data/config.json");
const E = file("~/data/.env");
const json = JSON.stringify({
  name: "desk",
  db: { host: "localhost", port: 5432, password: "hunter2" },
  servers: [{ host: "a", tags: ["x", "y"] }],
  max_tokens: 10,
});

describe("endue.data.read", () => {
  it("reads the whole file, a pointer, to a depth, with secrets as [secret]", async () => {
    const { host } = await mount({ handlers: disk({ [A.path]: json, [E.path]: "API_KEY=abc\n" }) });
    await expect(host.command("endue.data.read")).rejects.toThrow(/No file is open in Data/);
    await host.command("desk.files.visit", A);
    const all = (await host.command("endue.data.read")) as { value: Record<string, unknown> };
    expect(all.value).toEqual({
      name: "desk",
      db: { host: "localhost", port: 5432, password: "[secret]" },
      servers: [{ host: "a", tags: { "…items": 2 } }],
      max_tokens: 10,
    });
    const deep = await host.command("endue.data.read", { pointer: "/servers/0", depth: 2 });
    expect(deep).toMatchObject({ pointer: "/servers/0", value: { host: "a", tags: ["x", "y"] } });
    const shallow = await host.command("endue.data.read", { depth: 0 });
    expect(shallow).toMatchObject({ value: { "…keys": 4 } });
    await expect(host.command("endue.data.read", { pointer: "/nope" })).rejects.toThrow(
      /names nothing/,
    );
    await host.command("desk.files.visit", E);
    const env = (await host.command("endue.data.read", { path: E.path })) as { value: unknown };
    expect(JSON.stringify(env.value)).not.toContain("abc");
  });

  it("says what did not parse", async () => {
    const B = file("~/data/broken.json");
    const { host } = await mount({ handlers: disk({ [B.path]: '{ "a": 1, ' }) });
    await host.command("desk.files.visit", B);
    const read = (await host.command("endue.data.read")) as { errors: unknown[] };
    expect(read.errors.length).toBeGreaterThan(0);
  });

  it("sets a pointer in the existing edit session and searches without exposing masked values", async () => {
    const { host, params, view } = await mount({ handlers: disk({ [A.path]: json }) });
    await host.command("desk.files.visit", A);
    await expect(
      host.command("endue.data.set", { path: A.path, pointer: "/db/port", value: 6543 }),
    ).resolves.toMatchObject({ pointer: "/db/port", changed: true });
    await expect(host.command("endue.data.read", { pointer: "/db/port" })).resolves.toMatchObject({
      value: 6543,
    });
    view.places.set(A.buffer, { mode: "tree", expanded: ["0", "0/1"], selected: "0/1/1" });
    await expect(host.command("endue.data.read")).resolves.toMatchObject({
      selectedPointer: "/db/port",
    });
    expect(params("fs.write")).toEqual([]);
    await expect(
      host.command("endue.data.search", { path: A.path, query: "hunter2" }),
    ).resolves.toMatchObject({ matches: [] });
    await expect(host.command("endue.data.search", { query: "6543" })).resolves.toMatchObject({
      matches: [expect.any(Object)],
    });
    await expect(host.command("endue.data.problems", { path: A.path })).resolves.toMatchObject({
      problems: [],
    });
  });

  it("is offered to agents as a read", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
    ) as PluginManifest;
    const read = manifest.contributes?.commands?.find((c) => c.id === "endue.data.read");
    expect(read).toMatchObject({
      agent: true,
      readOnly: true,
      args: { additionalProperties: false },
    });
  });
});
