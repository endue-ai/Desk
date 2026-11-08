// Studio's DOM: the agent's card (a head that opens its identity, the facet cells under their
// captions, the row at the foot) and the inspector beside it, drawn from the Inspector model. The
// inspector is built again only when what it shows changes, so what the person types survives the
// redraws that runs and reads cause. Delete opens a <desk-dialog> that waits for the agent's name.

import { avatar, button, el, fill, presence, sourceBadge } from "./dom.js";
import { deleteConfirmed } from "./studio.js";

/**
 * @typedef {import("./app.js").StudioShown} StudioShown
 * @typedef {import("./studio.js").Inspector} Inspector
 * @typedef {import("./studio.js").Field} Field
 * @typedef {object} StudioViewActions
 * @property {(facet?: string) => void} facet
 * @property {(facet: string, values: Record<string, string>) => void} save
 * @property {(action: string) => void} act
 * @property {(entry: string) => void} entry
 * @property {(typed: string) => void} confirmDelete
 * @property {() => void} cancelDelete
 */

/**
 * @param {Document} doc
 * @param {StudioViewActions} actions
 */
export function createStudioView(doc, actions) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const host = pick("studio-card");
  const panel = pick("inspector");
  const dialog = pick("delete-dialog");
  const typed = /** @type {HTMLInputElement} */ (pick("delete-name"));
  const confirm = /** @type {HTMLButtonElement} */ (pick("delete-confirm"));
  let drawn = "";
  /** @type {string} */
  let name = "";

  // The frame may not submit forms (sandboxed with scripts only): the buttons and Enter do.
  const remove = () => {
    if (deleteConfirmed(typed.value, name)) actions.confirmDelete(typed.value);
  };
  typed.addEventListener("input", () => {
    confirm.disabled = !deleteConfirmed(typed.value, name);
  });
  typed.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    remove();
  });
  confirm.addEventListener("click", remove);
  pick("delete-cancel").addEventListener("click", () => actions.cancelDelete());
  dialog.addEventListener("cancel", () => actions.cancelDelete());

  const cell = (
    /** @type {import("./studio.js").Facet} */ f,
    /** @type {string | undefined} */ open,
    cls = "facet",
  ) =>
    el(
      doc,
      "button",
      {
        type: "button",
        class: `desk-row ${cls}`,
        "data-facet": f.id,
        "aria-pressed": String(open === f.id),
        onclick: () => actions.facet(open === f.id && f.id !== "chat" ? undefined : f.id),
      },
      el(doc, "strong", { class: "facet-label", text: f.label }),
      el(doc, "small", { class: "facet-hint", text: f.hint }),
    );

  const drawCard = (/** @type {StudioShown} */ s) => {
    const head = s.facets.find((f) => f.place === "head");
    const foot = s.facets.find((f) => f.place === "foot");
    /** @type {Node[]} */
    const body = [];
    let caption = "";
    for (const f of s.facets.filter((x) => x.place === "card")) {
      if (f.caption && f.caption !== caption) {
        caption = f.caption;
        body.push(el(doc, "p", { class: "facet-caption", text: caption }));
      }
      body.push(cell(f, s.facet));
    }
    host.replaceChildren(
      el(
        doc,
        "desk-card",
        { class: "studio-card", "data-source": s.card.source },
        el(
          doc,
          "button",
          {
            type: "button",
            class: "desk-row studio-head",
            "data-facet": "identity",
            "aria-pressed": String(s.facet === "identity"),
            "aria-label": `${s.card.name}: identity`,
            onclick: () => actions.facet(s.facet === "identity" ? undefined : "identity"),
          },
          avatar(doc, s.card, "lg"),
          el(
            doc,
            "span",
            { class: "who" },
            el(doc, "small", {
              class: "eyebrow",
              text: s.card.source === "endue" ? "endue agent" : "Local agent",
            }),
            el(doc, "strong", { class: "name", text: s.card.name }),
            head ? el(doc, "small", { class: "handle", text: s.card.handle ?? head.hint }) : null,
          ),
          sourceBadge(doc, s.card),
        ),
        el(doc, "p", {
          class: "description",
          text: s.card.role || "Handles requests and works with your connected tools.",
        }),
        el(doc, "p", { class: "meta" }, presence(doc, s.card)),
        s.loading ? el(doc, "desk-progress", { label: "Reading the agent", delay: "0" }) : null,
        s.error ? el(doc, "p", { class: "desk-error", role: "alert", text: s.error }) : null,
        el(doc, "div", { class: "facets" }, ...body),
        foot ? cell(foot, s.facet, "studio-foot") : null,
      ),
    );
  };

  const field = (/** @type {Field} */ f) => {
    const id = `field-${f.id}`;
    if (f.kind === "readonly")
      return el(
        doc,
        "div",
        { class: "field" },
        el(doc, "span", { class: "field-label", id, text: f.label }),
        el(doc, "output", { "aria-labelledby": id, class: "readonly", text: f.value || "—" }),
      );
    const control =
      f.kind === "choice"
        ? el(
            doc,
            "select",
            { id, name: f.id, class: "desk-field" },
            ...(f.choices ?? []).map((c) =>
              el(doc, "option", { value: c.value, selected: c.value === f.value, text: c.label }),
            ),
          )
        : el(doc, f.kind === "textarea" ? "textarea" : "input", {
            id,
            name: f.id,
            class: "desk-field",
            ...(f.kind === "text" ? { type: "text" } : { rows: f.id === "prompt" ? 12 : 3 }),
            ...(f.max ? { maxlength: f.max } : {}),
          });
    /** @type {HTMLInputElement} */ (control).value = f.value;
    return el(
      doc,
      "div",
      { class: "field" },
      el(doc, "label", { for: id, class: "field-label", text: f.label }),
      control,
      f.help ? el(doc, "small", { class: "desk-muted", text: f.help }) : null,
    );
  };

  const drawInspector = (/** @type {Inspector} */ i, /** @type {boolean} */ saving) => {
    const form = el(doc, "div", {
      class: "inspector-form",
      role: "group",
      "aria-labelledby": "inspector-title",
    });
    const save = () => {
      const named = /** @type {HTMLInputElement[]} */ ([...form.querySelectorAll("[name]")]);
      actions.save(i.facet, Object.fromEntries(named.map((f) => [f.name, f.value])));
    };
    form.append(...i.fields.map(field));
    // Enter in a one-line field saves, as a form would; a text area keeps its new lines.
    form.addEventListener("keydown", (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (event.key !== "Enter" || event.isComposing || target.tagName !== "INPUT" || !i.save)
        return;
      event.preventDefault();
      save();
    });
    if (i.save)
      form.append(
        el(
          doc,
          "button",
          { type: "button", class: "desk-btn desk-btn-primary", disabled: saving, onclick: save },
          saving ? "Saving…" : i.save,
        ),
      );
    const entries = i.entries
      ? i.entries.length
        ? el(
            doc,
            "ul",
            { class: "entries" },
            ...i.entries.map((e) =>
              el(
                doc,
                "li",
                { class: "entry" },
                el(
                  doc,
                  "span",
                  { class: "entry-text" },
                  el(doc, "strong", { text: e.title }),
                  e.detail ? el(doc, "small", { text: e.detail }) : null,
                ),
                e.state ? el(doc, "span", { class: "desk-badge", text: e.state }) : null,
                e.action
                  ? button(doc, e.action, () => actions.entry(e.id), {
                      variant: "quiet",
                      attrs: { "aria-label": `${e.action}: ${e.title}` },
                    })
                  : null,
              ),
            ),
          )
        : el(doc, "p", { class: "desk-empty", text: i.empty ?? "Nothing here yet." })
      : null;
    fill(
      panel,
      el(
        doc,
        "header",
        { class: "inspector-head" },
        el(doc, "h2", { id: "inspector-title", text: i.title }),
        button(doc, "Close", () => actions.facet(undefined), {
          variant: "quiet",
          attrs: { "aria-label": `Close ${i.title}` },
        }),
      ),
      el(doc, "p", { class: "desk-muted", text: i.intro }),
      i.problem ? el(doc, "p", { class: "desk-error", role: "alert", text: i.problem }) : null,
      i.fields.length || i.save ? form : null,
      entries,
      i.actions?.length
        ? el(
            doc,
            "div",
            { class: "inspector-actions" },
            ...i.actions.map((a) =>
              button(
                doc,
                a.label,
                () => actions.act(a.id),
                a.variant ? { variant: a.variant } : {},
              ),
            ),
          )
        : null,
    );
  };

  return {
    /** @param {StudioShown} s */
    show(s) {
      drawCard(s);
      const inspector = s.inspector;
      panel.hidden = !inspector;
      const key = inspector ? JSON.stringify([s.card.key, inspector, s.saving]) : "";
      if (inspector && key !== drawn) drawInspector(inspector, Boolean(s.saving));
      drawn = key;
      name = s.card.name;
      pick("delete-agent").textContent = s.card.name;
      // <desk-dialog> opens and closes with its open attribute, moving the focus in and back.
      const open = dialog.hasAttribute("open");
      if (s.deleting && !open) {
        typed.value = "";
        confirm.disabled = true;
      }
      if (Boolean(s.deleting) !== open) dialog.toggleAttribute("open", Boolean(s.deleting));
      confirm.textContent = s.deleting && s.saving ? "Deleting…" : "Delete";
    },
  };
}
