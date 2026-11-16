// Collections as folders of plain files: what a file holds, reading a tree back in order, and the
// operations (save, new folder, rename, move, delete) on a real temporary folder.
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Tab } from "../ui/app.js";
import { createApp } from "../ui/app.js";
import type { Collection, FolderNode, Node } from "../ui/collection-fs.js";
import { createFiles, envFile, readCollection, requestFile, slug } from "../ui/collection-fs.js";
import { createCollections } from "../ui/collections.js";
import type { Auth, Pair } from "../ui/model.js";
import { newRequest, normalize, pair } from "../ui/model.js";
import type { Scope } from "../ui/vars.js";
import { fsBridge } from "./fs-bridge";

type Studio = {
  ctx: { bridge: Awaited<ReturnType<typeof fsBridge>> };
  app: ReturnType<typeof createApp>;
  collections: ReturnType<typeof createCollections>;
  scopeProviders: ((tab: Tab) => Scope[])[];
  parentAuth(tab: Tab): Auth[];
  parentHeaders(tab: Tab): Pair[];
};
const folder = (node: Node | undefined) => node as FolderNode;
const coll = (c: Collection | undefined) => c as Collection;

let bridge: Awaited<ReturnType<typeof fsBridge>>;
beforeEach(async () => {
  bridge = await fsBridge();
});
afterEach(() => bridge.cleanup());

function studio() {
  const S = {
    ctx: { bridge },
    app: createApp(),
    scopeProviders: [],
    envScopes: () => [],
    globalScopes: () => [],
  } as unknown as Studio;
  S.collections = createCollections(S as never);
  return S;
}

describe("the files", () => {
  it("leaves defaults out of a request's file and keeps it readable", () => {
    const file = requestFile(newRequest({ id: "r1", name: "Ping", url: "{{base}}/ping" }));
    expect(file).toEqual({
      format: "endue.api-studio/1",
      id: "r1",
      name: "Ping",
      method: "GET",
      url: "{{base}}/ping",
    });
    const full = requestFile(
      normalize({
        id: "r2",
        name: "Make",
        method: "POST",
        url: "/x",
        headers: [pair({ key: "A", value: "1", on: false })],
        body: { mode: "json", json: "{}" },
        settings: { timeoutMs: 5000 },
      }),
    );
    expect(full.headers).toEqual([{ key: "A", value: "1", on: false }]);
    expect(full.body).toEqual({ mode: "json", json: "{}" });
    expect(full.settings).toEqual({ timeoutMs: 5000 });
  });

  it("never writes a secret's value", () => {
    const file = envFile({
      path: "~/c/environments/local.env.json",
      name: "Local",
      vars: [
        { ...pair({ key: "token", value: "s3cret" }), secret: true },
        pair({ key: "base", value: "http://x" }),
      ],
    });
    expect(JSON.stringify(file)).not.toContain("s3cret");
    expect(file.vars).toEqual([
      { key: "token", value: "", secret: true },
      { key: "base", value: "http://x" },
    ]);
  });

  it("makes file names from names", () => {
    expect(slug("List users (v2)")).toBe("list-users-v2");
    expect(slug("Café ☕")).toBe("cafe");
    expect(slug("사용자 목록")).toBe("사용자-목록");
  });
});

describe("a collection on disk", () => {
  it("is made, filled, renamed, reordered and emptied through the studio", async () => {
    const S = studio();
    const made = coll(await S.collections.create("~", "Shop API"));
    expect(made.path).toBe("~/shop-api");
    expect(existsSync(bridge.real("~/shop-api/collection.json"))).toBe(true);

    const users = await S.collections.newFolder(made, made.path, "Users");
    const tab = S.app.blank({ name: "List users", url: "{{base}}/users" });
    await S.collections.saveAs(tab, coll(S.collections.byPath(made.path)), users);
    expect(tab.ref?.path).toBe("~/shop-api/users/list-users.request.json");
    expect(JSON.parse(readFileSync(bridge.real(tab.ref?.path ?? ""), "utf8")).url).toBe(
      "{{base}}/users",
    );

    const second = S.app.blank({ name: "Get user", url: "{{base}}/users/:id" });
    await S.collections.saveAs(second, coll(S.collections.byPath(made.path)), users);
    let fresh = coll(S.collections.byPath(made.path));
    const dir = folder(fresh.children.find((n) => n.type === "folder"));
    expect(dir.children.map((n) => n.name)).toEqual(["List users", "Get user"]);

    // Move the second before the first.
    await S.collections.move(fresh, dir.children[1] as Node, users, dir.children[0]);
    fresh = coll(S.collections.byPath(made.path));
    expect(folder(fresh.children[0]).children.map((n) => n.name)).toEqual([
      "Get user",
      "List users",
    ]);

    // Rename renames the file too, and the open tab follows.
    await S.collections.rename(
      fresh,
      folder(fresh.children[0]).children[0] as Node,
      "Fetch a user",
    );
    expect(second.ref?.path).toBe("~/shop-api/users/fetch-a-user.request.json");
    expect(existsSync(bridge.real(second.ref?.path ?? ""))).toBe(true);

    // Edit and save in place.
    second.req.method = "HEAD";
    await S.collections.saveRequest(second);
    expect(JSON.parse(readFileSync(bridge.real(second.ref?.path ?? ""), "utf8")).method).toBe(
      "HEAD",
    );
    expect(S.app.dirty(second)).toBe(false);

    // Deleting the folder closes its tabs.
    fresh = coll(S.collections.byPath(made.path));
    await S.collections.remove(fresh, fresh.children[0] as Node);
    expect(existsSync(bridge.real(users))).toBe(false);
    expect(S.app.state.tabs).toHaveLength(0);
  });

  it("reads a tree in its order, with environments, and gives requests their parents' settings", async () => {
    const S = studio();
    const made = coll(await S.collections.create("~", "API"));
    const files = createFiles(bridge);
    await files.write(
      "~/api/collection.json",
      JSON.stringify({
        name: "API",
        auth: { type: "bearer", bearer: { token: "{{token}}" } },
        headers: [{ key: "Accept", value: "application/json" }],
        vars: [{ key: "v", value: "1" }],
      }),
      "~/api",
    );
    await files.write(
      "~/api/b/folder.json",
      JSON.stringify({ name: "B", seq: 1, headers: [{ key: "X-Folder", value: "b" }] }),
      "~/api",
    );
    await files.write(
      "~/api/b/one.request.json",
      JSON.stringify({ id: "1", name: "One", url: "/1", seq: 2 }),
      "~/api",
    );
    await files.write(
      "~/api/b/two.request.json",
      JSON.stringify({ id: "2", name: "Two", url: "/2", seq: 1 }),
      "~/api",
    );
    await files.write(
      "~/api/a.request.json",
      JSON.stringify({ id: "3", name: "A", url: "/a", seq: 2 }),
      "~/api",
    );
    await files.write("~/api/broken.request.json", "{ not json", "~/api");
    await files.write(
      "~/api/environments/local.env.json",
      JSON.stringify({ name: "Local", vars: [{ key: "token", value: "", secret: true }] }),
      "~/api",
    );
    const read = await readCollection(files, "~/api");
    expect(read.children.map((n) => n.name)).toEqual(["B", "A"]);
    expect(folder(read.children[0]).children.map((n) => n.name)).toEqual(["Two", "One"]);
    expect(read.envs.map((e) => e.name)).toEqual(["Local"]);
    expect(read.error).toContain("broken.request.json");

    await S.collections.reload(made.path);
    const fresh = coll(S.collections.byPath(made.path));
    const node = folder(fresh.children[0]).children[0];
    if (node?.type !== "request") throw new Error("no request");
    const tab = S.app.open(node.req, { collection: made.path, path: node.path });
    expect(S.parentAuth(tab).map((a) => a.type)).toEqual(["inherit", "bearer"]);
    expect(S.parentHeaders(tab).map((h) => h.key)).toEqual(["Accept", "X-Folder"]);
    const scopes = S.scopeProviders[0]?.(tab) ?? [];
    expect(scopes.map((s) => s.name)).toEqual(["folder", "collection"]);
  });
});
