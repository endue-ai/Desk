// The pages the specs look into besides the desk's (ADR 0201): each window lies in a page of its own,
// a same-origin popup of the desk's page titled `desk-window:<window id>`, which chromedriver lists
// as a window of its own; each plugin's page is a browser of its own whose URL names the plugin
// (`desk-plugin://<host>/<plugin>/…`). The compositor names each surface's host and plugin.
import { browser } from "@wdio/globals";
import { shellCommand } from "./compositor";

/** The title of window `id`'s own page (`packages/runtime/src/surface/window-pages.ts`). */
export const pageTitle = (id: string) => `desk-window:${id}`;

/** The handle where each page was last found, by the name it was looked for under. */
const seen = new Map<string, string>();

/**
 * Run `body` in each page chromedriver lists for which `is` holds (its URL, and its title for a
 * blank page: a window's own), until one returns something; the handle where page `name` was last
 * found first. Back on the desk's page after, whatever happened. With a page for every window
 * (ADR 0201) a look through them all, a URL and a title each, took seconds.
 */
async function inPages<T>(
  name: string,
  is: (url: string, title: string) => boolean,
  body: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const shell = await browser.getWindowHandle();
  try {
    const handles = await browser.getWindowHandles();
    const last = seen.get(name);
    const order = last && handles.includes(last) ? [last, ...handles] : handles;
    for (const handle of new Set(order)) {
      if (handle === shell) continue;
      await browser.switchToWindow(handle);
      const url = await browser.getUrl();
      if (!is(url, url === "about:blank" ? await browser.getTitle() : "")) continue;
      seen.set(name, handle);
      const found = await body();
      if (found !== undefined) return found;
    }
    return undefined;
  } finally {
    await browser.switchToWindow(shell);
  }
}

/** Run `body` in window `id`'s own page; undefined while the window has none. */
export function inWindowPage<T>(id: string, body: () => Promise<T>): Promise<T | undefined> {
  return inPages(pageTitle(id), (_, title) => title === pageTitle(id), body);
}

/** Whether `url` is a page of plugin `plugin` (`desk-plugin://<host>/<plugin>/…`). */
export function pluginPage(url: string, plugin: string): boolean {
  return url.startsWith("desk-plugin://") && new URL(url).pathname.startsWith(`/${plugin}/`);
}

/** Run `body` in plugin `plugin`'s page, once it has one (15 s at most); back on the desk's after. */
export async function inPluginPage<T>(plugin: string, body: () => Promise<T>): Promise<T> {
  const done: { value?: T } = {};
  await browser.waitUntil(
    async () => {
      const ran = await inPages(
        `plugin:${plugin}`,
        (url) => pluginPage(url, plugin),
        async () => {
          done.value = await body();
          return true;
        },
      );
      return ran === true;
    },
    { timeout: 15_000, timeoutMsg: `${plugin} has no page of its own` },
  );
  return done.value as T;
}

/** The surfaces the compositor drew, by host: the plugin each shows. */
type Surfaces = Record<string, { plugin?: string }>;

/** The host plugin `plugin`'s page is served from, as the compositor names its surface. */
export async function hostOf(plugin: string): Promise<string> {
  const { surfaces } = await shellCommand<{ surfaces: Surfaces }>("compositor_stats");
  return Object.entries(surfaces).find(([, s]) => s.plugin === plugin)?.[0] ?? "";
}
