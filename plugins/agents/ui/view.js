// The page: the bar (title, counts, Refresh, New agent, Back), what each source says when it has
// nothing to show (signed out, offline, …), the Home's two tabs, and the three pages (Home,
// Studio, New agent), each drawn by its own view. Escape steps back one level; / searches.

import { el } from "./dom.js";
import { createChatView } from "./view-chat.js";
import { createCreateView } from "./view-create.js";
import { createHomeView } from "./view-home.js";
import { createStudioView } from "./view-studio.js";

/**
 * @typedef {import("./app.js").Shown} Shown
 * @typedef {import("./view-home.js").HomeActions & import("./view-studio.js").StudioViewActions & {
 *   home(tab: "agents" | "activity"): void, back(): void, refresh(): void, signIn(): void,
 *   chat: import("./view-chat.js").ChatViewActions,
 *   flow: Omit<import("./view-create.js").CreateViewActions, "signIn" | "catalogPage">,
 *   catalogPage(): void }} Actions
 */

const TITLES = { home: "Agents", studio: "Studio", create: "New agent" };

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const home = createHomeView(doc, actions);
  const studio = createStudioView(doc, actions);
  const chat = createChatView(doc, actions.chat);
  const create = createCreateView(doc, {
    ...actions.flow,
    signIn: actions.signIn,
    catalogPage: actions.catalogPage,
  });
  /** @type {Shown | undefined} */
  let last;

  pick("refresh").addEventListener("click", () => actions.refresh());
  pick("new-agent").addEventListener("click", () => actions.create());
  pick("back").addEventListener("click", () => actions.back());
  const tabs = /** @type {HTMLElement[]} */ ([...pick("home-tabs").querySelectorAll("[data-tab]")]);
  for (const tab of tabs)
    tab.addEventListener("click", () =>
      actions.home(/** @type {"agents" | "activity"} */ (tab.getAttribute("data-tab"))),
    );
  pick("home-tabs").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = last?.route.tab === "agents" ? "activity" : "agents";
    actions.home(next);
    pick(`tab-${next}`).focus();
  });
  doc.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = /** @type {HTMLElement | null} */ (event.target);
    const typing = target?.matches?.("input, textarea, select") ?? false;
    if (event.key === "Escape" && !pick("delete-dialog").hasAttribute("open")) {
      if (typing && /** @type {HTMLInputElement} */ (target).value) return;
      event.preventDefault();
      actions.back();
    } else if (event.key === "/" && !typing && last?.route.page === "home") {
      event.preventDefault();
      actions.home("agents");
      pick("search").focus();
    }
  });

  /** What a source says, with its one action. */
  const note = (/** @type {"endue" | "local"} */ side, /** @type {Shown} */ shown) => {
    const said = shown.sides[side];
    if (!said.text) return null;
    const action =
      said.action === "sign-in"
        ? el(
            doc,
            "button",
            { type: "button", class: "desk-btn desk-btn-primary", onclick: () => actions.signIn() },
            "Sign in",
          )
        : said.action === "retry"
          ? el(
              doc,
              "button",
              { type: "button", class: "desk-btn", onclick: () => actions.refresh() },
              "Try again",
            )
          : said.state === "ready" && side === "endue"
            ? el(
                doc,
                "button",
                { type: "button", class: "desk-btn", onclick: () => actions.create() },
                "New agent",
              )
            : null;
    const kind = ["error", "offline", "forbidden"].includes(said.state)
      ? "desk-error"
      : "desk-empty";
    return el(
      doc,
      "div",
      {
        class: `note ${kind}`,
        "data-side": side,
        "data-state": said.state,
        ...(kind === "desk-error" ? { role: "alert" } : {}),
      },
      el(doc, "p", { text: said.text }),
      action,
    );
  };

  return {
    /** @param {Shown} shown */
    show(shown) {
      last = shown;
      const { page, tab } = shown.route;
      pick("title").textContent = TITLES[page];
      doc.title = shown.studio ? `${shown.studio.card.name} · Agents` : `${TITLES[page]} · Agents`;
      pick("back").hidden = page === "home";
      pick("new-agent").hidden = page === "create";
      const { endue, local, working } = shown.counts;
      pick("counts").textContent =
        `endue ${endue} · Local ${local}${working ? ` · ${working} working` : ""}`;
      pick("status").textContent = shown.notice;

      pick("page-home").hidden = !shown.home;
      pick("page-studio").hidden = !shown.studio;
      pick("page-create").hidden = !shown.create;

      if (shown.home) {
        for (const t of tabs) {
          const on = t.getAttribute("data-tab") === tab;
          t.setAttribute("aria-selected", String(on));
          t.setAttribute("tabindex", on ? "0" : "-1");
        }
        pick("panel-agents").hidden = tab !== "agents";
        pick("panel-activity").hidden = tab !== "activity";
        pick("notes").replaceChildren(
          ...[note("endue", shown), note("local", shown)].filter((n) => n !== null),
        );
        home.show(shown, shown.home);
      }
      if (shown.studio) {
        studio.show(shown.studio);
        chat.show(shown.studio);
      }
      if (shown.create)
        create.show(shown.create, {
          signedOut: shown.sides.endue.state === "signed-out",
          unavailable: shown.sides.endue.state === "unavailable",
        });
    },
    focusChat: () => chat.focus(),
  };
}
