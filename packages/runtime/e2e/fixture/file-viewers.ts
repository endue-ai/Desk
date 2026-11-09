// Real image fixtures in the real Images and Explorer frames, under the app's plugin CSP.
import type { StubHandlers } from "@endue-ai/bridge";
import png from "../../../../plugins/images/tests/fixtures/exif.png?inline";
import jpeg from "../../../../plugins/images/tests/fixtures/small.jpg?inline";
import type { BrowserCore } from "../../src/bridge/core";

const files = { "~/Documents/photo.jpg": jpeg, "~/Documents/picture.png": png };
const bytesOf = (url: string) =>
  Uint8Array.from(atob(url.split(",")[1] ?? ""), (c) => c.charCodeAt(0));

export const fileHandlers: StubHandlers = {
  "fs.url": ({ path }) => {
    const url = files[path as keyof typeof files];
    if (!url) throw new Error(`No fixture ${path}`);
    return { url, type: url.slice(5, url.indexOf(";")), size: bytesOf(url).length };
  },
  "fs.read": ({ path, offset = 0, length, encoding = "utf8" }) => {
    const url = files[path as keyof typeof files];
    if (!url) throw new Error(`No fixture ${path}`);
    const bytes = bytesOf(url);
    const part = bytes.subarray(offset, length === undefined ? undefined : offset + length);
    return {
      content:
        encoding === "base64" ? btoa(String.fromCharCode(...part)) : new TextDecoder().decode(part),
      encoding,
      size: bytes.length,
    };
  },
  "fs.list": () => ({
    entries: Object.entries(files).map(([path, url]) => ({
      name: path.slice(path.lastIndexOf("/") + 1),
      kind: "file",
      size: bytesOf(url).length,
    })),
  }),
  "fs.watch": ({ path }) => ({ watchId: `watch:${path}` }),
};

/** Grant the file plugins what their manifests ask for; `more` names other plugins to grant too. */
export async function grantFilePlugins(core: BrowserCore, more: string[] = []): Promise<void> {
  const off = core.client.onEvent((event) => {
    if (event.event === "perm.prompt")
      void core.client.call("perm.answer", {
        promptId: event.data.promptId,
        granted: true,
        scope: { permission: "perm:manage" },
      });
  });
  for (const plugin of core.plugins.filter((p) =>
    ["endue.explorer", "endue.images", ...more].includes(p.id),
  ))
    for (const permission of plugin.manifest?.permissions ?? [])
      await core.client.forward(
        {
          id: 1,
          method: "perm.request",
          params: { permission, reason: "Built-in file plugin fixture" },
        },
        plugin.id,
      );
  off();
}
