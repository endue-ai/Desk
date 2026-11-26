// The privileges panel (features/README.md): tabs (Roles, Object, Role, Defaults) and Refresh, a
// status line, the notices (a failed read with Try again, the catalogs this role may not read) and
// the tab's section (tabs.js). A new state is drawn again in place; the control that had the focus
// keeps it by its `data-focus`. Layout and colours: privileges.css.

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";
import { defaultsTab, objectTab } from "./object-tab.js";
import { rolesTab, roleTab } from "./tabs.js";

/**
 * @typedef {import("./controller.js").PrivState} PrivState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const LABELS = {
  roles: t("features.privileges.panel.roles"),
  object: t("features.privileges.panel.object"),
  role: t("features.privileges.panel.role"),
  defaults: t("features.privileges.panel.defaults"),
};

/** The status line: who read, which server, how many roles. */
function statusOf(/** @type {PrivState} */ s) {
  if (s.reading) return t("features.privileges.panel.readingRolesAndPrivileges");
  if (!s.probe) return s.error ? t("features.privileges.panel.notRead") : "";
  const roles = s.roles?.roles.length ?? 0;
  return [
    `Read as ${s.probe.user}${s.probe.superuser ? " (superuser)" : ""}`,
    `PostgreSQL ${Math.floor(s.probe.version / 10000)}`,
    `${roles} ${roles === 1 ? "role" : "roles"}`,
    ...(s.conn.readOnly ? ["read-only: nothing changes from here"] : []),
  ].join(" · ");
}

/**
 * @param {Document} doc
 * @param {PrivState} first
 * @param {Act} act
 * @param {{ id: string }} buffer
 */
export function privilegesPanel(doc, first, act, buffer) {
  const id = buffer.id;
  const root = el(doc, "div", { class: "privileges", tabindex: "-1" });
  /** Run a panel action; its failure is said on the status line by the host. */
  const go = (/** @type {string} */ action, /** @type {unknown[]} */ ...args) =>
    Promise.resolve(act(action, id, ...args)).catch(() => {});

  const draw = (/** @type {PrivState} */ s) => {
    const focus = /** @type {HTMLElement | null} */ (doc.activeElement)
      ?.closest?.("[data-focus]")
      ?.getAttribute("data-focus");
    const tabs = el(
      doc,
      "div",
      {
        class: "desk-tabs privileges-tabs",
        role: "tablist",
        "aria-label": t("features.privileges.panel.show"),
      },
      ...Object.entries(LABELS).map(([tab, label]) => {
        const b = el(
          doc,
          "button",
          {
            type: "button",
            role: "tab",
            class: "desk-tab",
            "aria-selected": String(s.tab === tab),
            "data-tab": tab,
            "data-focus": `tab-${tab}`,
          },
          label,
        );
        b.addEventListener("click", () => go("privilegesTab", tab));
        return b;
      }),
    );
    const refresh = el(
      doc,
      "button",
      {
        type: "button",
        class: "desk-btn desk-btn-quiet",
        "data-focus": "refresh",
        title: t("features.privileges.panel.readAgainG"),
      },
      t("features.privileges.panel.refresh"),
    );
    refresh.addEventListener("click", () => go("privilegesRefresh"));
    const notices = el(doc, "div", { class: "privileges-notices" });
    if (s.error) {
      const again = el(
        doc,
        "button",
        { type: "button", class: "desk-btn" },
        t("features.privileges.panel.tryAgain"),
      );
      again.addEventListener("click", () => go("privilegesRefresh"));
      notices.append(
        el(doc, "div", { class: "desk-error", role: "alert" }, el(doc, "p", {}, s.error), again),
      );
    }
    if (s.probe?.cannot.length)
      notices.append(
        el(
          doc,
          "p",
          { class: "desk-callout privileges-cannot" },
          t("features.privileges.panel.mayNotReadWhatNeedsThem", {
            user: String(s.probe.user),
            value: String(s.probe.cannot.join(", ")),
          }),
        ),
      );
    const section =
      s.tab === "object"
        ? objectTab(doc, s, go)
        : s.tab === "role"
          ? roleTab(doc, s, go)
          : s.tab === "defaults"
            ? defaultsTab(doc, s, go)
            : rolesTab(doc, s, go);
    root.replaceChildren(
      el(doc, "div", { class: "privileges-bar" }, tabs, refresh),
      el(doc, "p", { class: "privileges-status", "aria-live": "polite" }, statusOf(s)),
      notices,
      el(
        doc,
        "section",
        { class: "privileges-section", role: "tabpanel", "aria-label": LABELS[s.tab] },
        section,
      ),
    );
    if (focus)
      /** @type {HTMLElement[]} */ ([...root.querySelectorAll("[data-focus]")])
        .find((x) => x.getAttribute("data-focus") === focus)
        ?.focus();
  };
  root.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || event.metaKey || event.ctrlKey)
      return;
    if (event.key === "g") {
      event.preventDefault();
      go("privilegesRefresh");
    }
  });
  draw(first);
  return { el: root, update: draw };
}
