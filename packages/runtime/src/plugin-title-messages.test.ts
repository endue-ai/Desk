import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { afterEach, expect, it, vi } from "vitest";
import { PluginHost } from "./plugins";

const ID = "test.catalog";
const info = {
  id: ID,
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 1,
  manifest: {
    id: ID,
    name: "Catalog",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    messages: "words",
    surfaces: [
      {
        id: "main",
        title: "Surface fallback",
        titleMessage: "catalog.window",
        placement: "center",
      },
    ],
    contributes: {
      commands: [
        { id: "test.catalog.open", title: "Fallback", titleMessage: "catalog.open" },
        { id: "test.catalog.read", title: "Fallback", titleMessage: "catalog.read" },
        { id: "test.catalog.legacy", title: "Literal" },
        { id: "test.catalog.missing", title: "Unlisted", titleMessage: "catalog.missing" },
      ],
    },
  },
} as PluginInfo;

afterEach(() => vi.unstubAllGlobals());

it("registers catalog command titles and opens the surface before a plugin frame can greet the desk", async () => {
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.includes("/ko.json")
        ? { "catalog.window": "카탈로그", "catalog.open": "열기" }
        : { "catalog.window": "Catalog", "catalog.open": "Open", "catalog.read": "Read" },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const stub = browserStub({
    "plugin.list": () => ({ plugins: [info] }),
    "cmd.register": () => ({}),
    "cmd.unregister": () => ({}),
  });
  const open = vi.fn();
  const deps = {
    bridge: new BridgeClient(stub),
    win: { addEventListener() {}, removeEventListener() {} } as unknown as Window,
    open,
    close() {},
    reload() {},
    frame: () => null,
    language: () => "ko" as const,
  };
  const host = new PluginHost(deps, {
    url: (plugin, path, revision, surface) =>
      `https://local.invalid/${surface}/${plugin}/${path}?v=${revision}`,
  });
  try {
    await host.start();
    const titles = stub.log.flatMap(({ request }) =>
      request.method === "cmd.register" ? [[request.params.id, request.params.title]] : [],
    );
    expect(titles).toEqual([
      ["test.catalog.open", "열기"],
      ["test.catalog.read", "Read"],
      ["test.catalog.legacy", "Literal"],
      ["test.catalog.missing", "Unlisted"],
    ]);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: ID, title: "카탈로그" }));
    expect(fetch.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      "https://local.invalid/main/test.catalog/words/en.json?v=1",
      "https://local.invalid/main/test.catalog/words/ko.json?v=1",
    ]);
  } finally {
    host.stop();
  }
});
