// Reminders on the desk: while a calendar is open, each DISPLAY or AUDIO alarm that comes due becomes
// a ui.notify. Each fires once: the keys of fired alarms live in the plugin's state, which outlasts a
// reload of its surface, and an alarm missed by more than five minutes (the desk was closed) stays
// quiet rather than arriving late.
import { dueReminders } from "./calendar/alarms.js";
import { whenText } from "./format.js";
import { MINUTE } from "./ical/values.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./calendar/model.js").Model} Model
 */

/** How late a reminder may still be shown. */
const GRACE = 5 * MINUTE;
/** The longest wait between checks, so edits and a sleeping machine are noticed. */
const CHECK = MINUTE;
/** Fired keys kept, newest last. */
const KEPT = 500;

/**
 * @param {Pick<PluginContext, "bridge" | "state">} ctx
 * @param {object} host
 * @param {() => Model[]} host.calendars
 * @param {() => number} host.now
 * @param {string} host.locale
 * @param {() => boolean} host.enabled
 * @param {(run: () => void, ms: number) => unknown} [host.setTimer]
 * @param {(timer: unknown) => void} [host.clearTimer]
 */
export function createReminders(ctx, host) {
  const setTimer = host.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = host.clearTimer ?? ((timer) => clearTimeout(/** @type {number} */ (timer)));
  const state = () => /** @type {Record<string, unknown>} */ (ctx.state.get() ?? {});
  const fired = new Set(/** @type {string[]} */ (state().fired ?? []));
  let checked = host.now() - GRACE;
  /** @type {unknown} */
  let timer;
  let stopped = false;

  const keep = () => {
    const list = [...fired].slice(-KEPT);
    ctx.state.set({ ...state(), fired: list });
  };

  const check = () => {
    timer = undefined;
    if (stopped) return;
    const at = host.now();
    const from = Math.max(checked, at - GRACE);
    let next = at + CHECK;
    let any = false;
    if (host.enabled()) {
      for (const model of host.calendars()) {
        for (const reminder of dueReminders(model, from, at + CHECK)) {
          if (reminder.at > at) {
            next = Math.min(next, reminder.at);
            continue;
          }
          if (fired.has(reminder.key)) continue;
          fired.add(reminder.key);
          any = true;
          const occ = reminder.occurrence;
          const body = [whenText(host.locale, occ), occ.location].filter(Boolean).join(" · ");
          void ctx.bridge
            .call("ui.notify", {
              title: reminder.message,
              body,
              level: "info",
              scope: { permission: "ui:notify" },
            })
            .catch(() => {});
        }
      }
      if (any) keep();
    }
    checked = at;
    timer = setTimer(check, Math.max(1000, next - at));
  };

  return {
    /** A calendar opened, closed or changed: look again now. */
    changed() {
      if (stopped) return;
      if (timer !== undefined) clearTimer(timer);
      check();
    },
    dispose() {
      stopped = true;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
  };
}
