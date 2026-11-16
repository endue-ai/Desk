// @vitest-environment jsdom
// The whole window on real things: the page mounted with a bridge whose proc.spawn runs the real
// curl against a local server and whose fs.* works on a temporary folder. A collection is made,
// a request in it is opened, sent with the button, its checks and tests run (scripts in a vm
// standing in for the worker), the history keeps it, and Save writes its file.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestFile, text } from "../ui/collection-fs.js";
import type { Collections } from "../ui/collections.js";
import { normalize, pair } from "../ui/model.js";
import type { Spawn } from "../ui/scripts.js";
import { createStudio } from "../ui/studio.js";
import { fsBridge } from "./fs-bridge";
import { curlBridge, testServer } from "./real-curl";

const vmSpawn: Spawn = (source, timeoutMs) =>
  new Promise((resolve) => {
    const context = vm.createContext({
      postMessage: (d: unknown) => resolve(structuredClone(d)),
      console: {},
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      setTimeout,
      btoa,
      atob,
    });
    try {
      vm.runInContext(source, context, { timeout: timeoutMs });
    } catch (error) {
      resolve({ fatal: String((error as Error).message) });
    }
  });

const until = async (check: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

let server: Awaited<ReturnType<typeof testServer>>;
let files: Awaited<ReturnType<typeof fsBridge>>;
beforeAll(async () => {
  server = await testServer();
  files = await fsBridge();
  Element.prototype.scrollIntoView = () => {};
});
afterAll(async () => {
  await server.close();
  await files.cleanup();
});

describe("the studio", () => {
  it("makes a collection, sends a request from it, runs its checks and tests, and saves it", async () => {
    const curl = curlBridge();
    const listeners = new Set<(e: unknown) => void>();
    const bridge = {
      onEvent: (l: (e: unknown) => void) => {
        listeners.add(l);
        const offs = [curl.onEvent(l as never), files.onEvent(l)];
        return () => {
          for (const off of offs) off();
        };
      },
      call: (method: string, params: Record<string, unknown>) =>
        method.startsWith("proc.") ? curl.call(method, params) : files.call(method, params),
    };
    let saved: unknown;
    const ctx = {
      pluginId: "endue.api-studio",
      bridge,
      state: { get: () => saved, set: (v: unknown) => (saved = v) },
      commands: { on: () => {} },
      surface: {},
    };
    const studio = createStudio(ctx, document);
    const S = studio.S as typeof studio.S & { spawn: Spawn; collections: Collections };
    S.spawn = vmSpawn;
    await studio.start();

    const coll = await S.collections.create("~", "Local API");
    if (!coll) throw new Error("no collection");
    const req = normalize({
      id: "r1",
      name: "Echo",
      method: "POST",
      url: "{{base}}/echo?n=1",
      params: [pair({ key: "n", value: "1" })],
      headers: [pair({ key: "X-Who", value: "{{who}}" })],
      body: { mode: "json", json: '{"hello": "{{who}}"}' },
      vars: {
        pre: [pair({ key: "who", value: "ada" })],
        post: [pair({ key: "echoed", value: "res.body.body" })],
      },
      asserts: [{ id: "a1", on: true, target: "res.status", op: "eq", value: "200" }],
      tests: 'test("echoes the header", () => expect(res.body.headers["x-who"]).to.equal("ada"));',
    });
    await files.call("fs.write", {
      path: "~/local-api/echo.request.json",
      content: text(requestFile(req)),
    });
    await files.call("fs.write", {
      path: "~/local-api/collection.json",
      content: JSON.stringify({ name: "Local API", vars: [{ key: "base", value: server.url }] }),
    });
    await S.collections.reload(coll.path);

    // Open it from the tree, send it with the button.
    const node = [...document.querySelectorAll<HTMLElement>(".as-node")].find((n) =>
      n.textContent?.includes("Echo"),
    );
    node?.click();
    await until(() => !!document.querySelector(".as-send"));
    expect(document.querySelector(".as-url input")?.getAttribute("aria-label")).toBe("URL");
    document.querySelector<HTMLButtonElement>(".as-send")?.click();
    await until(() => !!document.querySelector(".as-status .status-pill"));
    expect(document.querySelector(".as-status .status-pill")?.textContent).toBe("200 OK");

    const tab = studio.S.app.current();
    expect(tab?.results?.asserts.map((a: { ok: boolean }) => a.ok)).toEqual([true]);
    expect(tab?.results?.tests.map((t: { name: string; ok: boolean }) => [t.name, t.ok])).toEqual([
      ["echoes the header", true],
    ]);
    expect(studio.S.runtime.values.get("echoed")).toBe('{"hello": "ada"}');
    expect(
      document.querySelector('.as-res .as-subtab[data-section="tests"]')?.textContent,
    ).toContain("✓ 2/2");
    expect(studio.S.app.state.history[0]?.status).toBe(200);

    // Change it and save: the file follows.
    if (!tab) throw new Error("no tab");
    tab.req.method = "PUT";
    studio.S.app.emit("req", { field: "method" });
    expect(studio.S.app.dirty(tab)).toBe(true);
    await studio.S.save(tab);
    expect(
      JSON.parse(readFileSync(files.real("~/local-api/echo.request.json"), "utf8")).method,
    ).toBe("PUT");
    expect(studio.S.app.dirty(tab)).toBe(false);
  });
});
