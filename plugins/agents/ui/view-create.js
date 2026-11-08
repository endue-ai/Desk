// New agent's DOM, the web's Create page: two modes as tabs. Find an agent for me has the request
// field and the catalog cards (the whole card picks it; a preview then offers Start with this
// agent); Build from scratch has Name and Role. The fields are the page's own, so typing survives
// every redraw. Enter sends either form, not while an input method is composing.

import { hueOf } from "./cards.js";
import { avatar, button, el, fill } from "./dom.js";

/**
 * @typedef {import("./create.js").CreateState} CreateState
 * @typedef {import("./studio-api.js").CatalogAgent} CatalogAgent
 * @typedef {object} CreateViewActions
 * @property {(mode: "find" | "build") => void} mode
 * @property {(query: string) => void} find
 * @property {(slug: string | undefined) => void} select
 * @property {(slug: string) => void} use
 * @property {(fields: { name: string, role: string }) => void} build
 * @property {() => void} signIn
 * @property {() => void} catalogPage
 */

/**
 * @param {Document} doc
 * @param {CreateViewActions} actions
 */
export function createCreateView(doc, actions) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const query = /** @type {HTMLTextAreaElement} */ (pick("find-query"));
  const name = /** @type {HTMLInputElement} */ (pick("build-name"));
  const role = /** @type {HTMLInputElement} */ (pick("build-role"));
  const go = /** @type {HTMLButtonElement} */ (pick("build-go"));
  const list = pick("catalog");
  const preview = pick("preview");

  for (const tab of pick("create-modes").querySelectorAll("[data-mode]"))
    tab.addEventListener("click", () =>
      actions.mode(/** @type {"find" | "build"} */ (tab.getAttribute("data-mode"))),
    );
  pick("create-modes").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const other = doc.activeElement?.getAttribute("data-mode") === "find" ? "build" : "find";
    actions.mode(other);
    pick(`mode-${other}`).focus();
  });
  // The frame may not submit forms (sandboxed with scripts only): the buttons and Enter do.
  pick("find-go").addEventListener("click", () => actions.find(query.value));
  query.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    actions.find(query.value);
  });
  const ready = () => {
    go.disabled = !name.value.trim() || !role.value.trim();
  };
  name.addEventListener("input", ready);
  role.addEventListener("input", ready);
  const build = () => actions.build({ name: name.value, role: role.value });
  go.addEventListener("click", build);
  for (const field of [name, role])
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      if (!go.disabled) build();
    });
  pick("create-signin-btn").addEventListener("click", () => actions.signIn());
  pick("find-browse").addEventListener("click", () => actions.catalogPage());
  pick("find-build").addEventListener("click", () => actions.mode("build"));
  pick("find-clear").addEventListener("click", () => {
    query.value = "";
    actions.find("");
  });

  /** A catalog agent's avatar, as an agent card draws one. */
  const face = (/** @type {CatalogAgent} */ c) =>
    avatar(
      doc,
      /** @type {import("./cards.js").Card} */ ({
        key: c.slug,
        initial: [...c.name][0]?.toUpperCase() ?? "?",
        hue: hueOf(c.slug),
        ...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}),
      }),
      "lg",
    );

  const card = (/** @type {CatalogAgent} */ c, /** @type {string | undefined} */ selected) =>
    el(
      doc,
      "li",
      {},
      el(
        doc,
        "desk-card",
        { class: "catalog-card", "data-slug": c.slug },
        el(
          doc,
          "button",
          {
            type: "button",
            class: "desk-row catalog-open",
            "aria-pressed": String(selected === c.slug),
            onclick: () => actions.select(selected === c.slug ? undefined : c.slug),
          },
          el(
            doc,
            "span",
            { class: "catalog-head" },
            face(c),
            el(
              doc,
              "span",
              { class: "who" },
              el(doc, "strong", { class: "name", text: c.name }),
              el(doc, "small", { text: c.role }),
            ),
            c.featured ? el(doc, "span", { class: "desk-badge", text: "Featured" }) : null,
          ),
          c.reason ? el(doc, "span", { class: "reason", text: c.reason }) : null,
          el(doc, "span", { class: "tagline", text: c.tagline }),
          c.strengths.length
            ? el(doc, "span", { class: "strengths", text: c.strengths.join(" · ") })
            : null,
          el(doc, "span", {
            class: "catalog-foot",
            text: [c.category, ...c.connectors.map((k) => k.type)].filter(Boolean).join(" · "),
          }),
        ),
      ),
    );

  const drawPreview = (/** @type {CatalogAgent | undefined} */ c, /** @type {CreateState} */ s) => {
    preview.hidden = !c;
    if (!c) return;
    fill(
      preview,
      el(
        doc,
        "header",
        { class: "catalog-head" },
        face(c),
        el(
          doc,
          "span",
          { class: "who" },
          el(doc, "h3", { text: c.name }),
          el(doc, "small", { text: c.role }),
        ),
      ),
      c.reason ? el(doc, "p", { class: "reason", text: `Why it fits: ${c.reason}` }) : null,
      el(doc, "p", { text: c.description || c.tagline }),
      c.strengths.length
        ? el(
            doc,
            "ul",
            { class: "strengths-list" },
            ...c.strengths.map((s) => el(doc, "li", { text: s })),
          )
        : null,
      c.connectors.length
        ? el(doc, "p", {
            class: "desk-muted",
            text: `Works with ${c.connectors.map((k) => (k.required ? `${k.type} (needed)` : k.type)).join(", ")}`,
          })
        : null,
      c.channels.length
        ? el(doc, "p", { class: "desk-muted", text: `Channels: ${c.channels.join(", ")}` })
        : null,
      c.publisher
        ? el(doc, "p", { class: "desk-muted", text: `Published by ${c.publisher}` })
        : null,
      el(
        doc,
        "div",
        { class: "inspector-actions" },
        button(
          doc,
          s.phase === "using" ? "Starting…" : "Start with this agent",
          () => actions.use(c.slug),
          {
            variant: "primary",
            attrs: { disabled: s.phase === "using" },
          },
        ),
        button(doc, "Back", () => actions.select(undefined), { variant: "quiet" }),
      ),
    );
  };

  return {
    /** @param {CreateState} s @param {{ signedOut: boolean, unavailable: boolean }} side */
    show(s, side) {
      for (const tab of pick("create-modes").querySelectorAll("[data-mode]")) {
        const on = tab.getAttribute("data-mode") === s.mode;
        tab.setAttribute("aria-selected", String(on));
        tab.setAttribute("tabindex", on ? "0" : "-1");
      }
      const blocked = side.signedOut || side.unavailable;
      const signin = pick("create-signin");
      signin.hidden = !blocked;
      signin
        .querySelector("p")
        ?.replaceChildren(
          side.signedOut
            ? "Sign in to endue to make an agent."
            : "This desk does not reach endue agents yet, so it cannot make one.",
        );
      pick("create-signin-btn").hidden = !side.signedOut;
      pick("create-find").hidden = blocked || s.mode !== "find";
      pick("create-build").hidden = blocked || s.mode !== "build";

      const shown = s.matches ?? s.catalog;
      pick("find-heading").textContent = s.matches
        ? "These look like a fit"
        : "Pick one from the catalog";
      pick("find-clear").hidden = !s.matches;
      const note = pick("find-note");
      note.hidden = !(s.matches && s.source === "keyword");
      note.textContent = "Shown by how much they overlap with what you wrote.";
      const busy = s.phase === "finding" || s.phase === "browsing";
      pick("find-progress").hidden = !busy;
      /** @type {HTMLButtonElement} */ (pick("find-go")).disabled = s.phase === "finding";
      list.setAttribute("aria-busy", String(busy));
      list.replaceChildren(...shown.map((c) => card(c, s.selected)));
      const failed =
        Boolean(s.error) || (!busy && s.matches !== undefined && s.matches.length === 0);
      const error = pick("find-error");
      error.hidden = !failed || s.mode !== "find";
      error.querySelector("p")?.replaceChildren(s.error ?? "No catalog agent fits that yet.");
      drawPreview(
        shown.find((c) => c.slug === s.selected),
        s,
      );

      for (const [field, id] of /** @type {const} */ ([
        ["name", "build-name-error"],
        ["role", "build-role-error"],
      ])) {
        const text = s.invalid[field];
        pick(id).textContent = text ?? "";
        pick(id).hidden = !text;
        (field === "name" ? name : role).setAttribute("aria-invalid", String(Boolean(text)));
      }
      const buildError = pick("build-error");
      buildError.textContent = s.mode === "build" ? (s.error ?? "") : "";
      buildError.hidden = !(s.mode === "build" && s.error);
      go.textContent = s.phase === "creating" ? "Creating…" : "Create agent";
      if (s.phase === "creating") go.disabled = true;
      else ready();
    },
  };
}
