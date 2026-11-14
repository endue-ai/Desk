/**
 * endue.ai's own pages in a desk window (ADR 0223). An agent's page and its Studio are the web's:
 * the desk shows them live, in the Browser's web view (`endue.browser`, ADR 0216), instead of
 * building them again or copying the web's code, which is closed and stays outside this
 * repository. The page is in a browser of its own: it reads nothing of the desk, and the person
 * signs in to endue.ai in it once, as in any browser. Where the Browser is not there (a host
 * without web views, the plugin disabled) the page opens in the system browser, as it did.
 */
import type { ShellCtx } from "../shell/context";
import { openOnWeb, WEB } from "./endue";

const BROWSER = "endue.browser";
/** How often, and how long apart, the Browser is asked while its window is still loading. */
const TRIES = 20;
const APART_MS = 150;

/** Where a page was shown. */
export type Shown = "desk" | "system";

type Run = (command: string, args?: unknown) => Promise<unknown>;

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Ask the Browser for `url` until its window has loaded and hears the command. */
async function go(run: Run, url: string): Promise<void> {
  for (let tried = 1; ; tried++) {
    try {
      await run("endue.browser.go", { url });
      return;
    } catch (error) {
      if (tried >= TRIES) throw error;
      await later(APART_MS);
    }
  }
}

/**
 * Show one of endue.ai's pages in a desk window; in the system browser when the desk cannot.
 * Nothing but endue.ai's own origin is ever shown.
 */
export async function showOnDesk(ctx: ShellCtx, url: string): Promise<Shown> {
  if (!url.startsWith(`${WEB}/`)) throw new Error(`not an endue.ai page: ${url}`);
  const commands = ctx.runtime?.commands;
  if (commands) {
    const run: Run = (command, args) => commands.run(command, args);
    try {
      await run("desk.plugins.open", { plugin: BROWSER });
      await go(run, url);
      return "desk";
    } catch {
      // No Browser here: the system's.
    }
  }
  await openOnWeb(ctx, url);
  return "system";
}
