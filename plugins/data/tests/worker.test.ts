import { afterEach, describe, expect, it } from "vitest";
import { openFile } from "../ui/formats.js";
import { validate } from "../ui/schema.js";
import { search } from "../ui/search.js";
import { isMasked } from "../ui/secrets.js";
import { childrenOf, previewOf } from "../ui/tree.js";
import { openWorker } from "../ui/worker-client.js";
import { workerHarness } from "./worker-harness";

const active: ReturnType<typeof workerHarness>[] = [];
afterEach(() =>
  active.splice(0).forEach((worker) => {
    worker.close();
  }),
);
const bytes = (text: string) => new TextEncoder().encode(text);

async function opened(text: string, name = "sample.json") {
  const harness = workerHarness();
  active.push(harness);
  const file = await openWorker(name, bytes(text), harness.start, { maskKeys: true });
  if (!file.remote) throw new Error("Missing worker document");
  return { ...harness, file, ask: file.remote.request };
}

describe("the worker-held data document", () => {
  it("answers bounded children, source lines, search and schema results like the existing tree", async () => {
    const text = '{\n "title": "Desk",\n "rows": [1, 2, 3]\n}\n';
    const local = openFile("sample.json", bytes(text)).doc;
    if (!local?.roots[0]) throw new Error("Missing fixture root");
    const { file, ask } = await opened(text);
    expect(file.text).toBeUndefined();
    expect(file.bytes).toBeUndefined();
    expect(file.doc?.roots).toEqual([]);
    const kids = await ask("children", { path: [0], from: 0, count: 100 });
    expect(kids.items.map((node: { preview: string }) => node.preview)).toEqual(
      childrenOf(local.roots[0]).map(previewOf),
    );
    expect(
      (await ask("lines", { from: 1, count: 5 })).lines.map((line: { text: string }) => line.text),
    ).toEqual(text.trimEnd().split("\n"));
    expect(await ask("search", { query: "Desk" })).toEqual(
      search(local, "Desk", (chain) => isMasked(chain, true)),
    );
    const schema = { type: "object", properties: { title: { type: "number" } } };
    expect(await ask("validate", { schema })).toEqual(
      validate(local.roots[0], schema).map((error) => ({ ...error, root: 0 })),
    );
    expect((await ask("node", { path: [0, 1, 2] })).line).toBe(3);
  });

  it("never posts a masked scalar through rows, raw lines, search or schema diagnostics before Reveal", async () => {
    const secret = "fixture-secret-never-post";
    const { ask, messages } = await opened(
      `{"password":"${secret}","token":{"rows":["${secret}","${secret}"]},"visible":"Desk"}`,
    );
    const children = await ask("children", { path: [0], from: 0, count: 100 });
    expect(children.items[0]).toMatchObject({ masked: true, preview: "••••••••" });
    await ask("lines", { from: 1, count: 20 });
    await ask("rows", { from: 0, count: 200 });
    expect((await ask("search", { query: secret })).matches).toEqual([]);
    await ask("validate", {
      schema: { properties: { token: { properties: { rows: { uniqueItems: true } } } } },
    });
    expect(JSON.stringify(messages)).not.toContain(secret);
    await ask("mask", { keys: true, revealed: "0/0" });
    expect((await ask("node", { path: [0, 0] })).preview).toContain(secret);
    await ask("mask", { keys: true, revealed: null });
    expect((await ask("node", { path: [0, 0] })).preview).not.toContain(secret);
  });

  it("caps every viewport response and long scalar preview; YAML still uses its original parser", async () => {
    const { ask } = await opened(
      `rows:\n${"  - value\n".repeat(500)}password: fixture-hidden\n`,
      "sample.yaml",
    );
    expect(
      (await ask("children", { path: [0, 0], from: 0, count: 10000 })).items.length,
    ).toBeLessThanOrEqual(200);
    expect((await ask("lines", { from: 1, count: 10000 })).lines.length).toBeLessThanOrEqual(200);
    const long = await opened(`{"text":"${"x".repeat(10000)}"}`);
    expect((await long.ask("node", { path: [0, 0] })).preview.length).toBeLessThanOrEqual(301);
  });

  it("bounds parser diagnostics in metadata and raw lines without changing parser errors", async () => {
    const { file, ask } = await opened(`value: *${"alias".repeat(3000)}\n`, "broken.yaml");
    const error = file.doc?.errors[0];
    if (!error) throw new Error("Missing alias diagnostic");
    expect(error.message).toMatch(/^Unknown alias/);
    expect(error.message.length).toBeLessThanOrEqual(500);
    const lines = await ask("lines", { from: 1, count: 2 });
    expect(lines.lines[0].error.length).toBeLessThanOrEqual(500);
  });
});
