// User themes in the app's data folder (ADR 0058, docs/ko/theme-requirements.md TC-01). The app hands the
// core `<data>/themes/` and watches it, and grants the runtime theme:manage: a theme the runtime saves
// is a folder there, a folder put there by hand is installed, and both are listed by plugin.list as theme
// plugins, not built in, after a relaunch. browser.reloadSession() quits the app and launches it again
// with the same HOME (support/driver.ts). The spec asks the core as the runtime does, through the
// `bridge_call` command, caller `desk`: Tauri's invoke, or the CEF shell's native channel.
import { cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, expect } from "@wdio/globals";
import { appData, shellReady } from "../support/desk";

/** Saved through theme.save in the first run. */
const SAVED = "local.e2e-saved";
/** e2e/fixtures/theme-e2e-paper, put in the themes folder by hand. */
const PLACED = "local.e2e-paper";
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/theme-e2e-paper");

type Plugin = { id: string; status: string; builtIn: boolean; manifest?: { kind?: string } };
type Answer = { result?: { plugins?: Plugin[]; plugin?: Plugin }; error?: { message: string } };
/**
 * What the shells put on the window: Tauri's `invoke` (`@tauri-apps/api/core` calls it), or the CEF
 * shell's native channel (packages/bridge/src/cef.ts), which answers a call `{ id, cmd, args }` with
 * `{ id, ok }` or `{ id, error }` through `onMessage`.
 */
type Host = {
  __TAURI_INTERNALS__?: { invoke(command: string, args: unknown): Promise<unknown> };
  __deskNative?: { send(text: string): void; onMessage?: (text: string) => void };
};

/** The user themes folder in the app's data folder under the spec's HOME (support/driver.ts). */
function themesFolder(): string {
  return join(appData(), "themes");
}

/** One bridge call as the runtime: the command the runtime's Tauri adapter invokes. */
function bridge(method: string, params: Record<string, unknown>): Promise<Answer> {
  return browser.execute(
    async (method: string, params: Record<string, unknown>) => {
      const host = window as unknown as Host;
      const request = { id: 1, method, params };
      if (host.__TAURI_INTERNALS__) {
        return (await host.__TAURI_INTERNALS__.invoke("bridge_call", { request })) as Answer;
      }
      const native = host.__deskNative;
      if (!native) throw new Error("neither Tauri's invoke nor the CEF shell's channel is here");
      // An id the page's own calls (counted from 1) never reach; its other replies go on to it.
      const id = 2 ** 31 - 7;
      return await new Promise<Answer>((resolve, reject) => {
        const page = native.onMessage;
        native.onMessage = (text) => {
          const reply = JSON.parse(text) as { id?: number; ok?: Answer; error?: string };
          if (reply.id !== id) return page?.(text);
          native.onMessage = page;
          if (reply.error !== undefined) reject(new Error(reply.error));
          else resolve(reply.ok as Answer);
        };
        native.send(JSON.stringify({ id, cmd: "bridge_call", args: { request } }));
      });
    },
    method,
    params,
  );
}

/** The installed plugin `id` as plugin.list answers it, or undefined. */
async function listed(id: string): Promise<Plugin | undefined> {
  const answer = await bridge("plugin.list", { scope: { permission: "plugin:manage" } });
  if (answer.error) throw new Error(`plugin.list: ${answer.error.message}`);
  return answer.result?.plugins?.find((plugin) => plugin.id === id);
}

const asUserTheme = { status: "ready", builtIn: false, manifest: { kind: "theme" } };

describe("themes: user themes in the app's data folder", () => {
  it("a theme the runtime saved and a folder put in themes/ by hand are listed after a relaunch", async () => {
    await shellReady();

    // The runtime holds theme:manage: its save lands in <data>/themes/ and is installed.
    const manifest = {
      id: SAVED,
      name: "E2E Saved",
      version: "1.0.0",
      kind: "theme",
      theme: { light: { colors: { background: "#efe4cf" } } },
    };
    const saved = await bridge("theme.save", { manifest, scope: { permission: "theme:manage" } });
    expect(saved.error).toBeUndefined();
    expect(saved.result?.plugin).toMatchObject(asUserTheme);
    expect(existsSync(join(themesFolder(), SAVED, "plugin.json"))).toBe(true);

    // A folder put there by hand while the app runs is installed by the watch.
    cpSync(FIXTURE, join(themesFolder(), PLACED), { recursive: true });
    await browser.waitUntil(async () => (await listed(PLACED)) !== undefined, {
      timeout: 10_000,
      timeoutMsg: `${PLACED} was not installed from the themes folder while the app ran`,
    });

    // Relaunch: both were in the themes folder before the start, and both are listed again.
    await browser.reloadSession();
    await shellReady();
    expect(await listed(SAVED)).toMatchObject(asUserTheme);
    expect(await listed(PLACED)).toMatchObject(asUserTheme);
  });
});
