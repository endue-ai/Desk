// The window's frame: the rail of sections on the left, the section in front, and the toast. Each
// section draws itself into its own element and redraws on the state keys it reads.
import { fill, h, icon, iconButton } from "./dom.js";
import { chatView } from "./view-chat.js";
import { modelsView } from "./view-models.js";
import { pickerView } from "./view-picker.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./state.js").State["view"]} ViewName
 */

/** @type {{ id: ViewName, label: string, short: string, icon: import("./dom.js").IconName }[]} */
export const SECTIONS = [
  { id: "chat", label: "Chat", short: "Chat", icon: "chat" },
  { id: "models", label: "My models", short: "Models", icon: "cube" },
];

/** @param {App} app @param {HTMLElement} root */
export function mountShell(app, root) {
  const { S } = app;
  const rail = h("nav.lm-rail", { "aria-label": "Sections" });
  const stage = h("div.lm-stage");
  const toastHost = h("div.lm-toasts", { role: "status", "aria-live": "polite" });
  const shell = h("div.lm-app", null, rail, stage, toastHost);
  root.append(shell);

  /** @type {Map<string, { el: HTMLElement }>} */
  const views = new Map();
  const make = (/** @type {ViewName} */ id) => {
    if (id === "models") return modelsView(app);
    return chatView(app);
  };

  function drawRail() {
    const { view, servers, scanning } = S.get();
    const online = servers.filter((s) => s.status === "online").length;
    fill(
      rail,
      h("div.lm-mark", { title: "Local models" }, icon("sparkle")),
      h(
        "div.lm-rail-list",
        null,
        SECTIONS.map((s) =>
          h(
            "button.desk-icon-btn.lm-rail-btn",
            {
              type: "button",
              title: s.label,
              "aria-label": s.label,
              "aria-current": view === s.id ? "page" : undefined,
              onClick: () => S.set({ view: s.id }),
            },
            icon(s.icon),
            h("span.lm-rail-label", null, s.short),
          ),
        ),
      ),
      h("div.lm-rail-spacer"),
      h(
        "button.desk-icon-btn.lm-rail-btn.lm-rail-status",
        {
          type: "button",
          title: scanning
            ? "Looking for model servers…"
            : online
              ? `${online} model server${online === 1 ? "" : "s"} answering. Look again`
              : "No model server answering. Look again",
          "aria-label": "Look for model servers again",
          onClick: () => void app.scan(),
          dataset: { state: scanning ? "checking" : online ? "online" : "offline" },
        },
        icon("server"),
        h("span.lm-status-dot"),
      ),
    );
  }

  function drawStage() {
    const { view } = S.get();
    let entry = views.get(view);
    if (!entry) {
      entry = make(view);
      views.set(view, entry);
    }
    for (const [id, v] of views) v.el.hidden = id !== view;
    if (!entry.el.isConnected) stage.append(entry.el);
    shell.dataset.view = view;
  }

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let toastTimer;
  function drawToast() {
    const { toast } = S.get();
    clearTimeout(toastTimer);
    if (!toast) {
      toastHost.replaceChildren();
      return;
    }
    fill(
      toastHost,
      h(
        "div.lm-toast",
        { dataset: { level: toast.level } },
        icon(toast.level === "error" ? "x" : toast.level === "success" ? "check" : "sparkle"),
        h("span", null, toast.text),
        iconButton("x", "Dismiss", () => S.set({ toast: null })),
      ),
    );
    toastTimer = setTimeout(() => S.set({ toast: null }), toast.level === "error" ? 7000 : 3500);
  }

  S.on(["view", "servers", "scanning"], drawRail);
  S.on(["view"], drawStage);
  S.on(["toast"], drawToast);
  drawRail();
  drawStage();
  shell.append(pickerView(app).el);
  return shell;
}
