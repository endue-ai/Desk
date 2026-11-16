// @vitest-environment jsdom
// The whole window on real things: the page mounted with a bridge whose proc.spawn runs the real
// curl against a local server and whose fs.* works on a temporary folder. A collection is made,
// a request in it is opened, sent with the button, its checks and tests run (scripts in a vm
// standing in for the worker), the history keeps it, and Save writes its file.
import { readFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestFile, text } from "../ui/collection-fs.js";
import type { Collections } from "../ui/collections.js";
import { wireCommands } from "../ui/commands.js";
import { normalize, pair } from "../ui/model.js";
import type { Spawn } from "../ui/scripts.js";
import { createStudio, type Studio } from "../ui/studio.js";
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

/** Wait for a dialog and press one of its buttons. */
const answer = async (dialogClass: string, label: string) => {
  await until(() => !!document.querySelector(`.as-dialog.${dialogClass}`));
  const box = document.querySelector(`.as-dialog.${dialogClass}`);
  const button = [...(box?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no ${label} in ${dialogClass}`);
  button.click();
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
    // Its tests came from the collection's files, so the person is asked before they run.
    await answer("is-trust", "Run scripts");
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

    // A token typed as is: saving offers to move it into a secret of this collection's own
    // environment (made, as it had none), never the globals; the file keeps {{token}}.
    tab.req.auth = { type: "bearer", bearer: { token: "typed-SECRET" } };
    const saving = studio.S.save(tab);
    await answer("is-secrets", "Move to secrets");
    expect(await saving).toBe(true);
    const file = readFileSync(files.real("~/local-api/echo.request.json"), "utf8");
    expect(file).not.toContain("typed-SECRET");
    expect(JSON.parse(file).auth.bearer.token).toBe("{{token}}");
    const envs = (studio.S as Studio).envs;
    const withEnv = S.collections.byPath(coll.path);
    const local = withEnv && envs.activeEnv(withEnv);
    expect(local?.name).toBe("Local secrets");
    expect(
      envs.varsOf(withEnv, local).find((v: { key: string }) => v.key === "token"),
    ).toMatchObject({ value: "typed-SECRET", secret: true });
    expect(envs.globals.some((v: { key: string }) => v.key === "token")).toBe(false);
    expect(
      readFileSync(files.real("~/local-api/environments/local-secrets.env.json"), "utf8"),
    ).not.toContain("typed-SECRET");

    // A script that arrives on disk afterwards (a pull) is asked about again; said no, it does
    // not run, and the Tests tab says why.
    await files.call("fs.write", {
      path: "~/local-api/echo.request.json",
      content: text(
        requestFile({ ...tab.req, scripts: { pre: 'api.set("pulled", "1");', post: "" } }),
      ),
    });
    await S.collections.reload(coll.path);
    const fresh = [...document.querySelectorAll<HTMLElement>(".as-node")].find((n) =>
      n.textContent?.includes("Echo"),
    );
    fresh?.click();
    const pulled = studio.S.app.current();
    if (!pulled) throw new Error("no tab");
    pulled.req = normalize({
      ...pulled.req,
      scripts: { pre: 'api.set("pulled", "1");', post: "" },
    });
    const sending = studio.S.send(pulled);
    await answer("is-trust", "Don't run");
    await sending;
    expect(studio.S.runtime.values.get("pulled")).toBeUndefined();
    expect(pulled.results?.errors.map((e: { text: string }) => e.text).join(" ")).toContain(
      "not allowed",
    );

    // A copy of it, which belongs to no collection, is asked about too.
    studio.S.duplicate(pulled);
    const copy = studio.S.app.current();
    if (!copy || copy === pulled) throw new Error("no copy");
    const copying = studio.S.send(copy);
    await answer("is-trust", "Don't run");
    await copying;
    expect(studio.S.runtime.values.get("pulled")).toBeUndefined();
  });

  it("asks before a request sends a file from outside its collection, and refuses file URLs", async () => {
    const curl = curlBridge();
    const bridge = {
      onEvent: (l: (e: unknown) => void) => {
        const offs = [curl.onEvent(l as never), files.onEvent(l)];
        return () => {
          for (const off of offs) off();
        };
      },
      call: (method: string, params: Record<string, unknown>) =>
        method.startsWith("proc.") ? curl.call(method, params) : files.call(method, params),
    };
    document.body.replaceChildren();
    const studio = createStudio(
      {
        pluginId: "endue.api-studio",
        bridge,
        state: { get: () => undefined, set: () => {} },
        commands: { on: () => {} },
        surface: {},
      },
      document,
    );
    await studio.start();
    const coll = await (studio.S as Studio).collections.create("~", "Files API");
    if (!coll) throw new Error("no collection");
    const outside = files.real("outside.txt");
    await files.call("fs.write", { path: "~/outside.txt", content: "private" });
    const tab = studio.S.app.open(
      normalize({
        name: "Upload",
        method: "POST",
        url: `${server.url}/echo`,
        body: { mode: "file", file: outside },
      }),
      { collection: coll.path, path: `${coll.path}/upload.request.json` },
    );
    const refused = studio.S.send(tab);
    await answer("is-file-guard", "Don't send");
    await refused;
    expect(tab.response?.status).toBe(0);
    expect(tab.response?.error).toContain("not allowed");
    expect(curl.calls.some((c) => c.method === "proc.spawn")).toBe(false);

    const sent = studio.S.send(tab);
    await answer("is-file-guard", "Send the file");
    await sent;
    expect(tab.response?.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(tab.response?.body)).body).toBe("private");

    // Inside the collection it goes without asking, unless a symlink there points elsewhere.
    await files.call("fs.write", { path: "~/files-api/data.txt", content: "own" });
    tab.req.body = { ...tab.req.body, file: files.real("files-api/data.txt") };
    tab.ref = {
      collection: files.real("files-api"),
      path: files.real("files-api/up.request.json"),
    };
    await studio.S.send(tab);
    expect(JSON.parse(new TextDecoder().decode(tab.response?.body)).body).toBe("own");
    await symlink(files.real("outside.txt"), files.real("files-api/link.txt"));
    tab.req.body = { ...tab.req.body, file: files.real("files-api/link.txt") };
    const linked = studio.S.send(tab);
    await answer("is-file-guard", "Don't send");
    await linked;
    expect(tab.response?.error).toContain("not allowed");

    tab.req.url = "file:///etc/hosts";
    tab.req.body = normalize({}).body;
    await studio.S.send(tab);
    expect(tab.response?.error).toBe("Only http:// and https:// URLs can be sent.");
  });

  it("fills no secret into a request an agent writes, and hides secrets in its answer", async () => {
    const curl = curlBridge();
    const bridge = {
      onEvent: (l: (e: unknown) => void) => {
        const offs = [curl.onEvent(l as never), files.onEvent(l)];
        return () => {
          for (const off of offs) off();
        };
      },
      call: (method: string, params: Record<string, unknown>) =>
        method.startsWith("proc.") ? curl.call(method, params) : files.call(method, params),
    };
    document.body.replaceChildren();
    const handlers = new Map<string, (args: unknown) => Promise<Record<string, unknown>>>();
    const ctx = {
      pluginId: "endue.api-studio",
      bridge,
      state: { get: () => undefined, set: () => {} },
      commands: { on: (id: string, fn: never) => handlers.set(id, fn) },
      surface: {},
    };
    const studio = createStudio(ctx, document);
    wireCommands(ctx, studio.S);
    await studio.start();
    await (studio.S as Studio).envs.saveGlobals([
      { id: "g1", on: true, key: "token", value: "g-SECRET", secret: true },
      { id: "g2", on: true, key: "who", value: "ada" },
    ]);
    const send = handlers.get("endue.api-studio.send");
    if (!send) throw new Error("no send command");
    // A value captured at runtime may be a token under a plain name: not filled in either.
    studio.S.runtime.values.set("x", "captured-SECRET");
    const answered = await send({
      url: `${server.url}/echo?t={{token}}&w={{who}}&x={{x}}`,
      headers: { "X-Token": "{{token}}" },
    });
    expect(JSON.stringify(answered)).not.toContain("captured-SECRET");
    expect(JSON.stringify(answered)).not.toContain("g-SECRET");
    expect(answered.secretsNotFilled).toEqual(["token"]);
    const echoed = JSON.parse(String(answered.body));
    expect(echoed.query.w).toBe("ada");
    expect(echoed.headers["x-token"]).toBe("{{token}}");
  });
});
