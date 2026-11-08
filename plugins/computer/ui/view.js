// The Computer page: while an agent acts, a banner with Stop; the OS permissions, each with why it
// is asked, Ask and Open System Settings; the stop, with Resume; the apps Eris may operate, with
// Add and Remove; and what was done lately. Native controls with the base sheet's kit classes
// (desk-btn, desk-field), so the design system in force draws them. Text is set as text.

/**
 * @typedef {import("./page.js").Shown} Shown
 * @typedef {import("./page.js").OsPermission} OsPermission
 * @typedef {{ ask(p: OsPermission): void, openSettings(p: OsPermission): void, stop(): void,
 *   resume(): void, addApp(id: string): void, removeApp(id: string): void, refresh(): void }} Actions
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const banner = pick("live");
  const permissions = pick("permissions");
  const message = pick("message");
  const stopped = pick("stopped");
  const apps = pick("apps");
  const recent = pick("recent");
  const status = pick("status");
  const field = /** @type {HTMLInputElement} */ (pick("new-app"));

  /** @param {string} tag @param {Record<string, any>} props @param {...(Node | null)} children */
  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (value !== undefined && value !== false)
        node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.filter((c) => c !== null));
    return node;
  };
  const button = (/** @type {string} */ label, /** @type {() => void} */ onclick, extra = {}) =>
    el("button", { type: "button", class: "desk-btn", text: label, onclick, ...extra });

  pick("live-stop").addEventListener("click", () => actions.stop());
  pick("stop").addEventListener("click", () => actions.stop());
  pick("resume").addEventListener("click", () => actions.resume());
  pick("refresh").addEventListener("click", () => actions.refresh());
  pick("app-form").addEventListener("submit", (event) => {
    event.preventDefault();
    actions.addApp(field.value);
    field.value = "";
  });

  return {
    /** @param {Shown} shown */
    show(shown) {
      banner.hidden = !shown.banner.visible || shown.banner.stopped;
      pick("live-title").textContent = shown.banner.title;
      pick("live-detail").textContent = shown.banner.detail;
      message.textContent = shown.message;
      permissions.replaceChildren(
        ...shown.permissions.map((p) =>
          el(
            "li",
            { class: "permission", "data-granted": String(p.granted) },
            el("div", { class: "what" }, el("strong", { text: p.label }), el("p", { text: p.why })),
            el("span", { class: "state", text: p.granted ? "Allowed" : "Not allowed yet" }),
            p.granted ? null : button("Ask macOS", () => actions.ask(p.id)),
            button("Open System Settings", () => actions.openSettings(p.id)),
          ),
        ),
      );
      permissions.hidden = shown.state !== "ready";
      stopped.dataset.stopped = String(shown.stopped);
      pick("stopped-text").textContent = shown.stopped
        ? "Stopped. Nothing acts on your computer until you resume."
        : "Eris may use the computer. Every act waits for your approval.";
      pick("stop").hidden = shown.stopped || shown.state !== "ready";
      pick("resume").hidden = !shown.stopped;
      apps.replaceChildren(
        ...(shown.apps.length
          ? shown.apps.map((id) =>
              el(
                "li",
                {},
                el("code", { text: id }),
                button("Remove", () => actions.removeApp(id), { "aria-label": `Remove ${id}` }),
              ),
            )
          : [
              el("li", {
                class: "empty",
                text: "Every app. Add one to allow only the apps you list.",
              }),
            ]),
      );
      recent.replaceChildren(
        ...(shown.recent.length
          ? shown.recent.map((row) =>
              el(
                "li",
                { "data-state": row.state },
                el("span", { class: "when", text: row.when }),
                el("span", { text: `${row.who}: ${row.what}${row.app ? ` in ${row.app}` : ""}` }),
                row.state === "failed"
                  ? el("span", { class: "state", text: "did not go through" })
                  : null,
              ),
            )
          : [
              el("li", {
                class: "empty",
                text: "Nothing yet. What Eris does shows here and on the runs board.",
              }),
            ]),
      );
    },
    /** @param {string} text */
    status(text) {
      status.textContent = text;
    },
  };
}
