import { describe, expect, it, vi } from "vitest";
import { createActions, failure, SEND_HOOKS } from "../ui/actions.js";
import type { Collection } from "../ui/collection-fs.js";
import { wireCommands } from "../ui/commands.js";
import { installAuth } from "../ui/features-auth.js";
import { installCollections } from "../ui/features-collections.js";
import { installImport } from "../ui/features-import.js";
import { newRequest, pair } from "../ui/model.js";
import { scope } from "../ui/vars.js";

const SAVED = "~/shop/read.request.json";
const ROOT = "~/shop";
const PRIVATE = "private-fixture-token";

function fixture() {
  const req = newRequest({
    name: "Read things",
    url: `https://sample.test/things?api_key=${PRIVATE}`,
    headers: [pair({ key: "Authorization", value: `Bearer ${PRIVATE}` })],
  });
  const post = newRequest({ name: "Write things", method: "POST", url: "https://sample.test/x" });
  const env = {
    name: "Desk",
    vars: [{ ...pair({ key: "token", value: PRIVATE }), secret: true }],
  };
  const coll = {
    name: "Shop",
    path: ROOT,
    envs: [env],
    children: [
      { type: "request", path: SAVED, req, name: req.name, method: req.method },
      {
        type: "request",
        path: `${ROOT}/write.request.json`,
        req: post,
        name: post.name,
        method: post.method,
      },
    ],
  };
  const response = {
    ...failure(""),
    status: 200,
    headers: [
      ["Set-Cookie", `session=${PRIVATE}`],
      ["X-Example", "ordinary"],
    ],
    body: new TextEncoder().encode(`{"token":"${PRIVATE}","answer":42}`),
    contentType: "application/json",
  };
  const tab = {
    id: "request-tab",
    req,
    ref: { collection: ROOT, path: SAVED },
    response,
    saved: null,
    reqTab: "params",
    resTab: "body",
  };
  const S = {
    collections: { list: [coll] },
    app: { state: { tabs: [tab], history: [], active: tab.id }, dirty: () => false },
    scopes: () => [scope("env", "Desk", env.vars)],
    parentAuth: () => [],
    parentHeaders: () => [],
    save: vi.fn(async () => true),
    send: vi.fn(async (sending) => {
      sending.response = response;
    }),
    envs: {
      activeEnv: () => env,
      varsOf: () => env.vars,
      use: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    },
    importFile: vi.fn(async () => ({ imported: 1 })),
  };
  const handlers = new Map<string, (args: unknown) => unknown>();
  const ctx = {
    commands: {
      on: (id: string, handler: (args: unknown) => unknown) => handlers.set(id, handler),
    },
  };
  wireCommands(ctx, S as never);
  return {
    coll,
    env,
    req,
    tab,
    S,
    async invoke(name: string, args: object) {
      const handler = handlers.get(`endue.api-studio.${name}`);
      if (!handler) throw new Error(`No API Studio command named ${name}`);
      return await handler(args);
    },
  };
}

describe("API Studio agent commands", () => {
  it("reads saved requests, tabs and generated code without leaking stored values or sending", async () => {
    const f = fixture();
    const request = await f.invoke("request", { name: SAVED });
    const tab = await f.invoke("tab", { name: f.req.name });
    const code = await f.invoke("codegen", { request: SAVED, lang: "fetch" });
    expect(request).toMatchObject({ request: { method: "GET", name: f.req.name } });
    expect(tab).toMatchObject({ response: { status: 200, body: expect.stringContaining("42") } });
    expect(code).toMatchObject({ code: expect.stringContaining("fetch(") });
    expect(JSON.stringify([request, tab, code])).not.toContain(PRIVATE);
    expect(f.S.send).not.toHaveBeenCalled();
  });

  it("saves a request, sets a non-secret variable and opens local import", async () => {
    const f = fixture();
    await f.invoke("save-request", { name: f.req.name });
    expect(f.S.save).toHaveBeenCalledWith(f.tab, undefined);
    await f.invoke("use-environment", { collection: ROOT, name: "Desk" });
    expect(f.S.envs.use).toHaveBeenCalledWith(f.coll, "Desk");
    await expect(
      f.invoke("set-variable", { collection: ROOT, key: "token", value: "attempt" }),
    ).rejects.toThrow(/secret/i);
    await f.invoke("set-variable", { collection: ROOT, key: "host", value: "sample.test" });
    expect(f.S.envs.save).toHaveBeenCalledWith(f.coll, f.env, [
      expect.objectContaining({ key: "token", value: PRIVATE, secret: true }),
      expect.objectContaining({ key: "host", value: "sample.test" }),
    ]);
    await expect(f.invoke("import", { path: "~/schema.yml", kind: "openapi" })).resolves.toEqual({
      imported: 1,
    });
    expect(f.S.importFile).toHaveBeenCalledWith("~/schema.yml", "openapi");
  });

  it("only runs named saved GET, HEAD or OPTIONS through the safe send", async () => {
    const f = fixture();
    await expect(f.invoke("send-read", { request: "Write things" })).rejects.toThrow(/GET/i);
    await expect(f.invoke("send-read", { url: "https://sample.test" })).rejects.toThrow(/saved/i);
    await expect(f.invoke("send-read", { request: SAVED })).resolves.toMatchObject({ status: 200 });
    expect(f.S.send).toHaveBeenCalledOnce();
    expect(f.S.send).toHaveBeenCalledWith(expect.objectContaining({ ref: f.tab.ref }), {
      readOnly: true,
    });
    f.S.collections.list.push({ ...f.coll, path: "~/overlap" });
    await expect(f.invoke("send-read", { request: SAVED })).rejects.toThrow(/overlapping/i);
    expect(f.S.send).toHaveBeenCalledOnce();
  });

  it("checks the effective method again before a safe request reaches curl", async () => {
    const f = fixture();
    const engine = { send: vi.fn() };
    const S = { ...f.S, app: { emit: vi.fn(), remember: vi.fn() }, engine };
    const tab = { ...f.tab, response: undefined };
    const hook = {
      prepared: (_studio: unknown, _tab: unknown, prep: { method: string }) =>
        (prep.method = "POST"),
    };
    SEND_HOOKS.push(hook as never);
    try {
      await createActions(S as never).send(tab as never, { readOnly: true });
    } finally {
      SEND_HOOKS.splice(SEND_HOOKS.indexOf(hook as never), 1);
    }
    expect(engine.send).not.toHaveBeenCalled();
    expect(tab.response).toMatchObject({ error: expect.stringMatching(/GET.*HEAD.*OPTIONS/) });
  });

  it("holds an OAuth renewal for the reviewed send", async () => {
    const f = fixture();
    const engine = { send: vi.fn() };
    const S = {
      ...f.S,
      app: { emit: vi.fn(), remember: vi.fn() },
      ctx: { bridge: { call: vi.fn(async () => ({})) } },
      engine,
      settings: {},
    };
    const tab = {
      ...f.tab,
      req: {
        ...f.req,
        auth: { type: "oauth2", oauth2: { tokenUrl: "https://sample.test/oauth" } },
      },
      response: undefined,
    };
    installAuth(S as never);
    try {
      await createActions(S as never).send(tab as never, { readOnly: true });
    } finally {
      SEND_HOOKS.shift();
    }
    expect(engine.send).not.toHaveBeenCalled();
    expect(tab.response).toMatchObject({ error: expect.stringMatching(/reviewed send.*OAuth/) });
  });
});

it("reads a selected description under an exact file scope and asks for a writable destination", async () => {
  const path = "/outside/docs/api.json";
  const call = vi.fn(async (method: string) => {
    if (method === "fs.read")
      return { content: '{"openapi":"3.1.0","info":{"title":"Sample"},"paths":{}}' };
    if (method === "dialog.open") return { cancelled: true };
    throw new Error(`Unexpected bridge call ${method}`);
  });
  const fixture = { ctx: { bridge: { call } }, homeActions: () => [] };
  installImport(fixture as never);
  const studio = fixture as typeof fixture & {
    importFile(path: string, kind: string): Promise<unknown>;
  };
  await expect(studio.importFile(path, "openapi")).resolves.toMatchObject({ cancelled: true });
  await expect(studio.importFile("/outside/docs/*.json", "openapi")).rejects.toThrow(/exact/i);
  expect(call).toHaveBeenCalledWith("fs.read", {
    path,
    encoding: "utf8",
    scope: { permission: "fs:read", paths: [path] },
  });
  expect(call).toHaveBeenCalledWith(
    "dialog.open",
    expect.objectContaining({
      kind: "folders",
      intent: "destination",
    }),
  );
  expect(call).toHaveBeenCalledTimes(2);
});

function scopedCollection(call: (method: string, params: { again?: boolean }) => Promise<unknown>) {
  const studio = {
    ctx: { bridge: { call, onEvent: () => () => {} } },
    app: { emit: vi.fn(), toast: vi.fn() },
    scopeProviders: [],
    homeActions: () => [],
  };
  const collections = installCollections(studio as never);
  const menu = (
    studio as typeof studio & {
      collectionMenu(
        coll: Partial<Collection>,
        adds: unknown[],
      ): Array<string | { label: string; run(): unknown }>;
    }
  ).collectionMenu;
  return { collections, menu };
}

it("shares one prompt and requires the collection menu to retry a remembered refusal", async () => {
  const root = "/outside/shop";
  let refused = false;
  let allowed = false;
  let cards = 0;
  const call = vi.fn(async (method: string, params: { again?: boolean }) => {
    if (method === "perm.request") {
      if (refused && !params.again) return { granted: false, reason: "refused-earlier" };
      cards++;
      if (cards === 1) {
        refused = true;
        return { granted: false };
      }
      allowed = true;
      return { granted: true };
    }
    if (method === "fs.write" && allowed) return {};
    throw Object.assign(new Error("permission denied"), { code: "permission_denied" });
  });
  const {
    collections: { files },
    menu,
  } = scopedCollection(call);
  const allow = () =>
    menu({ path: root, name: "Shop" }, []).find(
      (item) => typeof item !== "string" && item.label === "Allow writing this collection",
    );
  const first = await Promise.allSettled([
    files.write(`${root}/a.json`, "a", root),
    files.write(`${root}/b.json`, "b", root),
  ]);
  expect(first.map((x) => x.status)).toEqual(["rejected", "rejected"]);
  expect(call.mock.calls.filter(([m]) => m === "perm.request")).toHaveLength(1);
  await expect(files.write(`${root}/a.json`, "a", root)).rejects.toThrow("permission denied");
  expect(cards).toBe(1);
  const item = allow();
  if (!item || typeof item === "string")
    throw new Error("The collection has no write retry action.");
  await item.run();
  expect(cards).toBe(2);
  expect(call).toHaveBeenLastCalledWith("perm.request", {
    permission: { permission: "fs:write", paths: [root, `${root}/**`] },
    reason: expect.any(String),
    again: true,
  });
  expect(allow()).toBeUndefined();
  expect(call.mock.calls.filter(([m]) => m === "fs.write")).toHaveLength(3);
  await expect(files.write(`${root}/a.json`, "a", root)).resolves.toEqual({});
});

it("reloads a collection once its read retry is allowed", async () => {
  const root = "/outside/shop";
  let allowed = false;
  const call = vi.fn(async (method: string, params: { again?: boolean }) => {
    if (method === "perm.request") {
      allowed ||= params.again === true;
      return { granted: allowed };
    }
    if (!allowed)
      throw Object.assign(new Error("permission denied"), { code: "permission_denied" });
    if (method === "fs.list") return { entries: [] };
    if (method === "fs.read") return { content: '{"name":"Shop on disk"}' };
    return {};
  });
  const { collections, menu } = scopedCollection(call);
  await collections.reload(root);
  const before = collections.byPath(root);
  expect(before?.error).toContain("permission denied");
  if (!before) throw new Error("The collection is missing.");
  const item = menu(before, []).find(
    (row) => typeof row !== "string" && row.label === "Allow reading this collection",
  );
  if (!item || typeof item === "string")
    throw new Error("The collection has no read retry action.");
  await item.run();
  expect(collections.byPath(root)).toMatchObject({ name: "Shop on disk" });
  expect(collections.byPath(root)?.error).toBeUndefined();
});
