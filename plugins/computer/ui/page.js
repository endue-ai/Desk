// The Computer page's logic (ADR 0123): the OS permissions computer use needs (Accessibility,
// Screen Recording) with why, a button to ask and one to open System Settings; the apps Eris may
// operate (the setting endue.computer.apps); Stop and Resume; and what was done lately, from
// computer.activity. The view is handed in, so the tests drive it on the SDK's test host.
import { bannerModel, HIDDEN } from "./banner.js";
import { agentName } from "./invocations.js";

const SEE = { permission: "computer:see" };
const CONTROL = { permission: "computer:control" };
/** The acts the page lists, newest first. */
export const RECENT = 20;
/** How long the banner stays after an agent's last act, as the desk's own over other apps. */
export const LINGER = 10_000;

/** Why each OS permission is asked, in the person's words. */
export const WHY = {
  accessibility:
    "Lets Eris read the buttons and fields of other apps and click and type in them for you.",
  "screen-recording": "Lets Eris see the screen and the names of other apps' windows.",
};

/**
 * @typedef {"accessibility" | "screen-recording"} OsPermission
 * @typedef {{ id: OsPermission, label: string, granted: boolean, why: string }} PermissionRow
 * @typedef {{ when: string, who: string, what: string, app: string, state: string }} ActRow
 * @typedef {{ state: "loading" | "ready" | "unsupported" | "failed", message: string,
 *   permissions: PermissionRow[], bundleId: string | null, stopped: boolean, apps: string[],
 *   recent: ActRow[], banner: import("./banner.js").Banner }} Shown
 * @typedef {{ show(shown: Shown): void, status(text: string): void }} View
 * @typedef {{ call(method: string, params: unknown): Promise<any>,
 *   onEvent(listener: (event: any) => void): () => void }} Bridge
 * @typedef {{ get<T>(key: string): Promise<T | undefined>, set(key: string, value: unknown): Promise<void> }} Settings
 */

/**
 * @param {{ bridge: Bridge, settings: Settings }} ctx
 * @param {View} view
 * @param {() => string} [now]
 */
export function createPage(ctx, view, now = () => new Date().toLocaleTimeString()) {
  const { bridge, settings } = ctx;
  /** @type {Shown} */
  const shown = {
    state: "loading",
    message: "",
    permissions: [],
    bundleId: null,
    stopped: false,
    apps: [],
    recent: [],
    banner: HIDDEN,
  };
  const draw = () => view.show({ ...shown, recent: [...shown.recent] });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let idle;

  const refresh = async () => {
    try {
      const status = await bridge.call("computer.permissions.status", { scope: SEE });
      shown.permissions = [
        {
          id: "accessibility",
          label: "Accessibility",
          granted: status.accessibility,
          why: WHY.accessibility,
        },
        {
          id: "screen-recording",
          label: "Screen Recording",
          granted: status.screenRecording,
          why: WHY["screen-recording"],
        },
      ];
      shown.bundleId = status.bundleId ?? null;
      shown.stopped = status.stopped;
      shown.state = "ready";
      shown.message = shown.bundleId
        ? `macOS asks about ${shown.bundleId}.`
        : "macOS asks about the app that started the desk (your terminal under just dev).";
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error).code;
      shown.state = code === "unsupported" ? "unsupported" : "failed";
      shown.message =
        code === "unsupported"
          ? "Computer use works on macOS for now."
          : `The desk could not read the permissions: ${message(error)}`;
    }
    shown.apps = (await settings.get("apps").catch(() => undefined)) ?? [];
    draw();
  };

  /** @param {any} data computer.activity's data */
  const heard = (data) => {
    shown.banner = bannerModel(shown.banner, data);
    clearTimeout(idle);
    // The banner stays up while an agent keeps acting, and goes LINGER ms after its last act.
    if (shown.banner.visible && !shown.banner.stopped) {
      idle = setTimeout(() => {
        shown.banner = HIDDEN;
        draw();
      }, LINGER);
    }
    if (data.state === "stopped" || data.state === "resumed") {
      shown.stopped = data.state === "stopped";
    } else if (data.state !== "acting") {
      const row = {
        when: now(),
        who: data.agent ? agentName(data.agent) : data.caller,
        what: data.action ?? "",
        app: data.app ?? "",
        state: data.state,
      };
      shown.recent = [row, ...shown.recent].slice(0, RECENT);
    }
    draw();
  };
  bridge.onEvent((event) => {
    if (event.event === "computer.activity") heard(event.data);
  });

  /** @param {() => Promise<unknown>} work @param {string} done */
  const doing = async (work, done) => {
    try {
      await work();
      view.status(done);
    } catch (error) {
      view.status(message(error));
    }
    await refresh();
  };

  const saveApps = (/** @type {string[]} */ apps) =>
    doing(
      () => settings.set("apps", apps),
      apps.length ? `Eris may operate ${apps.length} apps.` : "Eris may operate every app.",
    );

  return {
    ready: refresh(),
    refresh,
    /** @param {OsPermission} permission */
    ask: (permission) =>
      doing(
        () => bridge.call("computer.permissions.request", { permission, scope: SEE }),
        "Asked macOS.",
      ),
    /** @param {OsPermission} permission */
    openSettings: (permission) =>
      doing(
        () => bridge.call("computer.permissions.open", { permission, scope: SEE }),
        "System Settings is open. Turn on endue Desk there, then come back.",
      ),
    stop: () =>
      doing(
        () => bridge.call("computer.stop", { scope: CONTROL }),
        "Stopped. Eris can no longer act.",
      ),
    resume: () =>
      doing(
        () => bridge.call("computer.stop", { resume: true, scope: CONTROL }),
        "Eris may use the computer again.",
      ),
    /** @param {string} id */
    addApp: (id) => {
      const app = id.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(app)) {
        view.status(`${app || "That"} is not a bundle id, such as com.apple.Safari.`);
        return Promise.resolve();
      }
      return saveApps([...new Set([...shown.apps, app])]);
    },
    /** @param {string} id */
    removeApp: (id) => saveApps(shown.apps.filter((app) => app !== id)),
  };
}

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
