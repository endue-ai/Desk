// The page around the four tabs: the bar with the network and Scan now, the tabs, the refusal
// banner, the administrator question, the status line, and one click handler that turns
// `data-act` buttons and the "Who is this?" form into actions. Every word is the catalog's: elements
// marked `data-t` take theirs, and the rest is drawn from state.
import { fill, h } from "./dom.js";

/** @typedef {(id: string, params?: Record<string, unknown>) => string} T */

export const TABS = Object.freeze(["map", "checkup", "channels", "log"]);
/** @typedef {(typeof TABS)[number]} Tab */

/**
 * @param {Document} doc
 * @param {(action: string, detail: Record<string, unknown>) => void} act
 */
export function createView(doc, act) {
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const tabs = $("tabs");
  /** @param {T} t */
  const words = (t) => {
    for (const el of doc.querySelectorAll("[data-t]"))
      el.textContent = t(/** @type {string} */ (el.getAttribute("data-t")));
    doc.title = t("app.title");
    tabs.setAttribute("aria-label", t("tabs.label"));
    fill(
      tabs,
      TABS.map((tab) =>
        h(
          doc,
          "button",
          {
            type: "button",
            role: "tab",
            class: "desk-tab",
            id: `tab-${tab}`,
            "aria-controls": `panel-${tab}`,
            "data-act": "tab",
            "data-tab": tab,
          },
          t(`tab.${tab}`),
        ),
      ),
    );
  };

  /** @param {Tab} tab */
  const showTab = (tab) => {
    for (const name of TABS) {
      const button = doc.getElementById(`tab-${name}`);
      button?.setAttribute("aria-selected", name === tab ? "true" : "false");
      button?.setAttribute("tabindex", name === tab ? "0" : "-1");
      $(`panel-${name}`).hidden = name !== tab;
    }
  };

  doc.addEventListener("click", (event) => {
    const target = /** @type {Element | null} */ (event.target);
    const el = target?.closest?.("[data-act]");
    if (!el) return;
    const detail = { .../** @type {HTMLElement} */ (el).dataset };
    act(String(detail.act), detail);
  });
  doc.addEventListener("submit", (event) => {
    const form = /** @type {HTMLFormElement} */ (event.target);
    if (form.dataset.form !== "who") return;
    event.preventDefault();
    const field = (/** @type {string} */ name) =>
      /** @type {HTMLInputElement | null} */ (form.elements.namedItem(name));
    act("who-save", {
      mac: form.dataset.mac,
      name: field("name")?.value ?? "",
      kind: field("kind")?.value ?? "",
      mine: field("mine")?.checked === true,
    });
  });
  tabs.addEventListener("keydown", (event) => {
    const key = /** @type {KeyboardEvent} */ (event).key;
    if (key !== "ArrowRight" && key !== "ArrowLeft") return;
    const current = TABS.findIndex(
      (tab) => doc.getElementById(`tab-${tab}`)?.getAttribute("aria-selected") === "true",
    );
    const next = TABS[(current + (key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    act("tab", { tab: next });
    doc.getElementById(`tab-${next}`)?.focus();
  });

  return {
    words,
    showTab,
    /** @param {string} text */
    here: (text) => {
      $("here").textContent = text;
    },
    /** @param {string | null} text @param {{ done: number, total: number } | null} progress */
    busy: (text, progress) => {
      const bar = /** @type {HTMLProgressElement} */ ($("busy"));
      bar.hidden = text === null;
      if (progress && progress.total > 0) {
        bar.max = progress.total;
        bar.value = progress.done;
      } else bar.removeAttribute("value");
      $("busy-text").textContent = text ?? "";
      /** @type {HTMLButtonElement} */ ($("scan")).disabled = text !== null;
    },
    /** @param {{ text: string, todo: string } | null} refusal */
    problem: (refusal) => {
      $("problem").hidden = !refusal;
      $("problem-text").textContent = refusal?.text ?? "";
      $("problem-todo").textContent = refusal?.todo ?? "";
    },
    /** @param {{ state: "ask" | "declined" | null, cidr: string }} ask @param {T} t */
    ask: (ask, t) => {
      const box = $("ask");
      box.hidden = ask.state === null;
      if (ask.state === null) return;
      fill(
        box,
        h(doc, "h2", {}, t("ask.title")),
        h(
          doc,
          "p",
          {},
          ask.state === "ask"
            ? t("ask.body", { cidr: ask.cidr })
            : t("ask.declined", { cidr: ask.cidr }),
        ),
        h(
          doc,
          "div",
          { class: "actions" },
          ask.state === "ask"
            ? [
                h(
                  doc,
                  "button",
                  { type: "button", class: "desk-btn desk-btn-primary", "data-act": "admin-yes" },
                  t("ask.yes"),
                ),
                h(
                  doc,
                  "button",
                  { type: "button", class: "desk-btn", "data-act": "admin-no" },
                  t("ask.no"),
                ),
              ]
            : h(
                doc,
                "button",
                { type: "button", class: "desk-btn desk-btn-quiet", "data-act": "admin-yes" },
                t("ask.change"),
              ),
        ),
      );
    },
    /** @param {string} text */
    status: (text) => {
      $("status").textContent = text;
    },
    panel: (/** @type {Tab} */ tab) => $(`panel-${tab}`),
    device: () => $("device"),
  };
}

/** @typedef {ReturnType<typeof createView>} View */
