// Every plugin surface has its own origin on the desk-plugin scheme (#36), so an engine that isolates
// sites gives each window its own process. A surface's host is `<surface>.<plugin label>`, and the path
// keeps its shape, `/<plugin id>/<path>`, so file lookup does not change. Two labels make the whole
// host the site: the last label is never a known suffix, since a plugin label always holds a `-`.
// crates/desk-web/src/plugin_scheme/hosts.rs parses the same shape and refuses a path of another plugin.
import type { BridgeRequest, PluginInfo, PluginManifest } from "@endue-ai/bridge";
import { instanceNumber, instanceSurface, pluginOf } from "./instances";
import type { PluginHostOptions } from "./plugin-host-deps";

/** The surface a plugin that declares none opens: its frame still gets a host of its own. */
export const DEFAULT_SURFACE = "main";

/** The host of the desk's own pages and of files the desk loads itself (theme fonts, images). */
export const SHARED_HOST = "localhost";

const PLUGIN_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SURFACE_ID = /^[a-z][a-z0-9-]*$/;

/**
 * A plugin id as one host label: every `-` doubled, then every `.` one `-` (example.hello-ui is
 * example-hello--ui). Each part of an id starts with a letter, so in a run of hyphens half are the
 * id's own and an odd one out is a dot: no two ids share a label.
 */
export function pluginLabel(id: string): string {
  return id.replaceAll("-", "--").replaceAll(".", "-");
}

/**
 * The host of one surface of a plugin, `main.example-hello--ui`. Undefined for an id no host can
 * carry: one outside the manifest's patterns, or a label starting `xn--`, which URL parsers read as
 * punycode. Those surfaces keep the shared host.
 */
export function surfaceHost(id: string, surface: string = DEFAULT_SURFACE): string | undefined {
  if (!PLUGIN_ID.test(id) || !SURFACE_ID.test(surface)) return undefined;
  const host = `${surface}.${pluginLabel(id)}`;
  return /(^|\.)xn--/.test(host) ? undefined : host;
}

/** The surface a mounted plugin's frame opens: the first its manifest declares. */
export function surfaceOf(manifest: PluginManifest | undefined): string {
  return manifest?.surfaces?.[0]?.id ?? DEFAULT_SURFACE;
}

/**
 * A mounted plugin's page at its revision, asked for with its surface (`PluginHost`); its `n`-th
 * window's on that window's own host, `<surface>--<n>.<label>` (ADR 0212).
 */
export function surfaceUrl(options: PluginHostOptions, info: PluginInfo, n = 1): string {
  const { id, manifest, revision } = info;
  return options.url(id, manifest?.entry ?? "", revision, instanceSurface(surfaceOf(manifest), n));
}

/**
 * A call of window `key`'s as the core takes it: `web.open` names the host of the calling window's
 * surface (ADR 0216), which only the runtime knows, since every window calls as its plugin.
 * Whatever a plugin put there is replaced, so a window opens a web view in itself alone.
 */
export function named(
  key: string,
  request: BridgeRequest,
  mounted: ReadonlyMap<string, PluginInfo>,
): BridgeRequest {
  if (request.method !== "web.open") return request;
  const plugin = pluginOf(key);
  const surface = instanceSurface(surfaceOf(mounted.get(plugin)?.manifest), instanceNumber(key));
  const { surface: _, ...params } = request.params;
  const host = surfaceHost(plugin, surface);
  return { ...request, params: host === undefined ? params : { ...params, surface: host } };
}

/**
 * The app's URL of a plugin file, with `?v=<revision>` so an update reloads it. With a surface it is
 * on that surface's host; without one, on the shared host. macOS and Linux reach the scheme as
 * `desk-plugin://<host>`; Windows (WebView2) as `http://desk-plugin.<host>.localhost`, which wry hands
 * the scheme as `desk-plugin://<host>.localhost`.
 */
export function deskPluginUrl(
  windows: boolean,
): (id: string, path: string, revision: number, surface?: string) => string {
  return (id, path, revision, surface) => {
    const own = surface === undefined ? undefined : surfaceHost(id, surface);
    const origin = windows
      ? `http://desk-plugin.${own === undefined ? "" : `${own}.`}localhost`
      : `desk-plugin://${own ?? SHARED_HOST}`;
    return `${origin}/${id}/${path}?v=${revision}`;
  };
}
