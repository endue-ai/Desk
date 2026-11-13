// What the sleep specs share (#162, ADR 0176): a desk started again on a profile that keeps no
// window out of sight live (desk.surfaces.live 0), and a file window sent to sleep on another
// desktop and woken when the person goes there, its page marked first so a case can tell the page
// that comes back is a new one. sleep-openers.spec.ts (Notes, Sheets, Data: unsaved edits),
// sleep-media.spec.ts (Images, the Player) and sleep-documents.spec.ts (Docs, Slides, Web,
// Archives) use it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser } from "@wdio/globals";
import { inFrame, shellReady } from "./desk";
import { HOME_VAR } from "./driver";
import { hostOf } from "./pages";
import { byId, clearDesk, deskNow, freshDesktop, openWindow, run, until } from "./windows";

export const NOTES = "endue.notes";

/** What desk.buffers.list answers. */
export type Buffers = Array<{ id: string; modified: boolean; plugin: string }>;

/** Whether the desk lists the plugin's window asleep. */
export const asleep = (d: Awaited<ReturnType<typeof deskNow>>, plugin: string) =>
  byId(d, plugin)?.panes[0]?.asleep === true;

/** The spec's files folder under its HOME (`~/files`), made if missing. */
export function filesFolder(): string {
  const files = join(process.env[HOME_VAR] ?? "", "files");
  mkdirSync(files, { recursive: true });
  return files;
}

/**
 * Start the desk again on a profile with no window kept live out of sight (read at start), the
 * profile's windows cleared but Notes's, and a new desktop in front.
 */
export async function startWithNoneLive(): Promise<void> {
  const home = process.env[HOME_VAR] ?? "";
  mkdirSync(join(home, ".desk/profiles"), { recursive: true });
  const profile = "name: E2E live 0\nsettings:\n  desk.surfaces.live: 0\n";
  writeFileSync(join(home, ".desk/profiles/e2e-live.yaml"), profile);
  await browser.reloadSession();
  await shellReady();
  await run("desk.profiles.switch", { id: "e2e-live" });
  await clearDesk([NOTES]);
  await freshDesktop();
}

/**
 * Mark the plugin's page, so a test can tell the page that comes back is a new one: a window that
 * only looked asleep would keep its old page and its state with it.
 */
export const mark = (plugin: string) =>
  inFrame(plugin, () =>
    browser.execute(() => {
      (window as { slept?: boolean }).slept = true;
    }),
  );
export const marked = (plugin: string) =>
  inFrame(plugin, () => browser.execute(() => (window as { slept?: boolean }).slept === true));

/** Show a plugin's window in front and in use, asked again while it is still mounting. */
export async function show(plugin: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      await run("desk.display.show", { plugin });
      const w = byId(await deskNow(), plugin);
      return w?.focused === true && !w.hidden;
    },
    { timeout: 15_000, interval: 300, timeoutMsg: `${plugin} is not shown and in use` },
  );
}

/** The host a plugin's page is served from, as the compositor names its surface. */
const pageHost = (plugin: string) => hostOf(plugin);

/** Whether a page of `host` is open: a browser of its own that chromedriver lists. */
async function pageOpen(host: string): Promise<boolean> {
  const shell = await browser.getWindowHandle();
  try {
    for (const handle of await browser.getWindowHandles()) {
      if (handle === shell) continue;
      await browser.switchToWindow(handle);
      if ((await browser.getUrl()).startsWith(`desk-plugin://${host}/`)) return true;
    }
    return false;
  } finally {
    await browser.switchToWindow(shell);
  }
}

/**
 * Move the plugin's window (in use) to desktop `to` (its place in the list, or its id), use another
 * window, and wait for its sleep: the desk lists it asleep, and its page has closed. The page closes
 * a moment after the listing says so; a window woken before then keeps its old page, with what the
 * sleep would have dropped.
 */
export async function sleepOn(plugin: string, to: 2 | 3 | 4 | string): Promise<void> {
  await show(plugin);
  const host = await pageHost(plugin);
  if (typeof to === "string") await run("desk.shell.move-to-desktop", { desktop: to });
  else await run(`desk.shell.move-to-desktop-${to}`);
  await openWindow();
  await until((d) => asleep(d, plugin), `${plugin} asleep on desktop ${to}`, 20_000);
  await browser.waitUntil(async () => !(await pageOpen(host)), {
    timeout: 20_000,
    timeoutMsg: `${plugin}'s page did not close as it slept`,
  });
}

/**
 * Two new desktops for a case: an empty one of its own for its window to sleep on (its id), and the
 * one in front, where the case opens its window.
 */
export async function desktopsOfItsOwn(): Promise<string> {
  const own = await freshDesktop();
  await freshDesktop();
  return own;
}

/** Wake the window on desktop `id` by going there, as the person does. */
export async function wakeOn(plugin: string, id: string): Promise<void> {
  await run("desk.shell.desktop-go", { desktop: id });
  await until((d) => !asleep(d, plugin), `${plugin} awake on its desktop`, 20_000);
}
