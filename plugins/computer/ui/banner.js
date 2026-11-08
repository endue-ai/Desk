// The banner over every app while an agent operates the computer (ADR 0123): who, what it is
// doing now, and Stop; after a stop, that nothing acts until Resume. The desk shows it in a small
// window of its own above other apps and hands it computer.activity with `deskBanner.show`; Stop
// and Resume go back to the desk as a navigation to `?stop` or `?resume`, which the desk answers
// and cancels. The plugin's page draws the same model.
import { agentName } from "./invocations.js";

/**
 * @typedef {{ visible: boolean, stopped: boolean, title: string, detail: string }} Banner
 * @typedef {{ state: string, caller: string, agent?: string, action?: string, app?: string }} Activity
 */

/** @type {Banner} */
export const HIDDEN = { visible: false, stopped: false, title: "", detail: "" };

/**
 * The banner after `data`: shown for an agent's acts, kept up after one ends (the desk hides it
 * once the agent is idle), "Stopped" after the stop until it is resumed. The person's own acts
 * and a plugin's own leave it as it is.
 * @param {Banner} before
 * @param {Activity} data
 * @returns {Banner}
 */
export function bannerModel(before, data) {
  if (data.state === "stopped") {
    return {
      visible: true,
      stopped: true,
      title: "Stopped",
      detail: "Nothing acts on your computer until you resume.",
    };
  }
  if (data.state === "resumed") return HIDDEN;
  if (!data.agent || before.stopped) return before;
  const who = agentName(data.agent);
  const where = data.app ? ` in ${data.app}` : "";
  const what = data.action ? `${data.action}${where}` : "";
  const detail = {
    acting: what,
    done: what ? `Did: ${what}` : "",
    failed: what ? `Could not ${what}` : "",
  }[data.state];
  return {
    visible: true,
    stopped: false,
    title: `${who} is using your computer`,
    detail: detail ?? "",
  };
}

/**
 * The activity the desk opened the banner with, in its URL's fragment; null without one.
 * @param {string} hash `location.hash`
 * @returns {Activity | null}
 */
export function firstActivity(hash) {
  try {
    const data = JSON.parse(decodeURIComponent(hash.replace(/^#/, "")));
    return data && typeof data.state === "string" ? data : null;
  } catch {
    return null;
  }
}

/**
 * Draw the banner in `doc` and answer `deskBanner.show(activity)`; Stop and Resume `navigate`.
 * @param {Document} doc
 * @param {(to: string) => void} navigate
 */
export function mountBanner(doc, navigate) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const root = pick("banner");
  const title = pick("banner-title");
  const detail = pick("banner-detail");
  const stop = /** @type {HTMLButtonElement} */ (pick("banner-stop"));
  const key = pick("banner-key");
  let banner = HIDDEN;
  stop.addEventListener("click", () => navigate(banner.stopped ? "?resume" : "?stop"));
  const draw = () => {
    root.hidden = !banner.visible;
    root.dataset.stopped = String(banner.stopped);
    title.textContent = banner.title;
    detail.textContent = banner.detail;
    stop.textContent = banner.stopped ? "Resume" : "Stop";
    key.hidden = banner.stopped;
  };
  draw();
  return {
    /** @param {Activity} data */
    show(data) {
      banner = bannerModel(banner, data);
      draw();
    },
    /** The stop key in words, as the desk reads its setting: "Hold Esc to stop". */
    key(/** @type {string} */ text) {
      key.textContent = text;
    },
    get banner() {
      return banner;
    },
  };
}
