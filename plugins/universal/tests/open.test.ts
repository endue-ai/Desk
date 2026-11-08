import { beforeEach, describe, expect, it, vi } from "vitest";
// The element and the small DOM it runs on in Node, from @endue-ai/ui's own tests.
import "../../../packages/ui/src/elements/test-dom";
import { defineUiPlugin, parseYaml } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { defineElements } from "../../../packages/ui/src/elements/index";
import { reset } from "../../../packages/ui/src/elements/test-dom";
import { ALL, scopeOf, viewOf } from "../ui/open.js";
import { createScreen } from "../ui/screen.js";

defineElements();

const DATA =
  "entries:\n  - { id: a, title: One, group: todo }\n  - { id: b, title: Two, group: done }\n";
const VIEW = `type: kanban
title: From a file
source: { file: "~/boards/launch.yaml" }
options: { groups: [todo, doing, done] }
`;

describe("viewOf", () => {
  const io = (files: Record<string, string>) => ({
    parse: parseYaml,
    read: vi.fn(async (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no ${path}`);
      return text;
    }),
  });

  it("opens a view as given, in another presentation when asked", async () => {
    const view = { type: "chat" as const, source: { data: { entries: [] } } };
    expect(await viewOf({ view }, io({}))).toEqual(view);
    expect(await viewOf({ view, type: "agent", title: "Run" }, io({}))).toEqual({
      ...view,
      type: "agent",
      title: "Run",
    });
    await expect(viewOf({ view: { type: "gantt", source: {} } }, io({}))).rejects.toThrow("view:");
  });

  it("opens data, a URL or a data file as a list that switches to every presentation", async () => {
    const data = { entries: [{ title: "x" }] };
    expect(await viewOf({ data }, io({}))).toEqual({ type: "list", types: ALL, source: { data } });
    expect(await viewOf({ url: "https://example.com/a.yaml", type: "kanban" }, io({}))).toEqual({
      type: "kanban",
      types: ALL,
      source: { url: "https://example.com/a.yaml" },
    });
    await expect(viewOf({ url: "file:///etc/passwd" }, io({}))).rejects.toThrow("only http");
    const files = io({ "~/a.yaml": DATA, "~/v.yaml": VIEW });
    expect(await viewOf({ file: "~/a.yaml" }, files)).toMatchObject({
      source: { file: "~/a.yaml" },
    });
    expect(await viewOf({ file: "~/v.yaml" }, files)).toMatchObject({
      type: "kanban",
      title: "From a file",
      source: { file: "~/boards/launch.yaml" },
    });
    await expect(viewOf({}, io({}))).rejects.toThrow("Open what?");
    await expect(viewOf({ id: "eris.board" }, io({}))).rejects.toThrow("not a universal view");
  });

  it("names the permission each source is read under", () => {
    expect(scopeOf({ url: "https://tasks.example.com/a.yaml" })).toEqual({
      permission: "net:fetch",
      hosts: ["tasks.example.com"],
    });
    expect(scopeOf({ file: "~/a.yaml" })).toEqual({ permission: "fs:read", paths: ["~/a.yaml"] });
    expect(scopeOf({ command: "example.feed.get" })).toEqual({
      permission: "cmd:invoke",
      ids: ["example.feed.get"],
    });
    expect(scopeOf({ items: { kinds: ["task"] } })).toEqual({
      permission: "data:read",
      kinds: ["task"],
    });
    expect(scopeOf({ data: { entries: [] } })).toBeUndefined();
  });
});

describe("the screen", () => {
  beforeEach(reset);

  const flush = async (host: { settle(): Promise<void> }) => {
    for (let i = 0; i < 4; i++) {
      await host.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  it("asks for the refused source's permission and draws it once allowed", async () => {
    const host = createTestHost({
      pluginId: "desk.universal",
      files: { "~/boards/launch.yaml": DATA },
    });
    const ctx = await defineUiPlugin({ mount() {} }, host.transport);
    const page = document.createElement("main");
    document.body.append(page);
    const screen = createScreen(page, ctx);
    const handle = screen.open({ type: "kanban", source: { file: "~/boards/launch.yaml" } });
    await flush(host);
    expect(handle.element.getAttribute("state")).toBe("denied");
    const notice = page.children[0] as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("permission");

    expect(await screen.allow()).toEqual({ granted: true });
    await flush(host);
    expect(handle.element.getAttribute("state")).toBe("ready");
    expect(handle.data?.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(notice.hidden).toBe(true);
    screen.close();
    const left = [...(page.children as unknown as HTMLElement[])].map((child) => child.localName);
    expect(left).not.toContain("desk-universal-view");
  });
});
