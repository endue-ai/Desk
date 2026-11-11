// The view builder (ADR 0102): pick a source (a file, a URL, a command or the desk's items), load it,
// pick a shape, map fields to the roles it draws and see each change at once in the preview beside
// it, then save the universal view as `~/.desk/views/<id>.yaml` with view.save, the same file Eris's
// Apply writes. The preview is loaded once per source: a shape or a field only redraws it. The name
// and Save stay in sight below the steps, whatever the height. Controls are the design system's kit
// classes (ADR 0090); a source that fails says why in words (words.js).
import {
  fieldsOf,
  idFor,
  inputOf,
  KINDS,
  ROLES,
  SHAPES,
  sourceOf,
  suggestMap,
  viewOf,
} from "./build-model.js";
import { scopeOf } from "./open.js";
import { failureText } from "./words.js";

/**
 * @typedef {import("./open.js").UniversalView} UniversalView
 * @typedef {import("./open.js").UniversalData} UniversalData
 * @typedef {import("./open.js").UniversalType} UniversalType
 * @typedef {import("./build-model.js").SourceKind} SourceKind
 * @typedef {import("../../../packages/plugin-sdk/src/index").PluginContext} PluginContext
 * @typedef {{ saved(view: UniversalView): void, cancelled(): void }} BuilderHooks
 */

const SOURCES = /** @type {const} */ ([
  { kind: "file", label: "File", hint: "~/boards/launch.yaml" },
  { kind: "url", label: "URL", hint: "https://example.com/feed.yaml" },
  { kind: "command", label: "Command", hint: "desk.universal.folder" },
  { kind: "items", label: "Items", hint: "" },
]);
const LABELS = /** @type {Record<string, string>} */ ({
  title: "Title",
  detail: "Detail",
  status: "Status",
  start: "Start",
  end: "End",
  tags: "Tags",
  group: "Column",
  text: "Text",
  author: "Author",
  value: "Value",
});

/**
 * @param {HTMLElement} host
 * @param {PluginContext} ctx
 * @param {BuilderHooks} hooks
 */
export function createBuilder(host, ctx, hooks) {
  const doc = host.ownerDocument ?? document;
  /** @param {string} tag @param {Record<string, string>} [attrs] @param {string} [text] */
  const el = (tag, attrs = {}, text) => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  /** @param {string} title */
  const section = (title) => {
    const box = el("fieldset", { class: "build-step" });
    box.append(el("legend", {}, title));
    return box;
  };

  const root = el("section", { class: "builder", "aria-label": "View builder" });
  // The steps scroll; the name and the actions under them do not.
  const side = el("div", { class: "build-side" });
  const form = el("div", { class: "build-form" });
  const foot = el("div", { class: "build-foot" });
  side.append(form, foot);
  const pane = el("div", { class: "build-preview" });
  const preview = /** @type {HTMLElement & { view: unknown, data: unknown }} */ (
    el("desk-universal-view", { state: "empty", label: "Preview" })
  );
  pane.append(preview);
  root.append(side, pane);

  // Source.
  const source = section("Source");
  const tabs = el("div", { class: "desk-tabs", role: "tablist", "aria-label": "Source" });
  const input = /** @type {HTMLInputElement} */ (
    el("input", { class: "desk-field", type: "text", "aria-label": "Where" })
  );
  const args = /** @type {HTMLTextAreaElement} */ (
    el("textarea", { class: "desk-field", rows: "2", "aria-label": "Arguments (JSON)" })
  );
  args.placeholder = '{ "path": "~/notes" }';
  const kinds = el("div", { class: "build-kinds" });
  for (const kind of KINDS) {
    const label = el("label", { class: "build-kind" });
    label.append(el("input", { class: "desk-check", type: "checkbox", value: kind }), kind);
    kinds.append(label);
  }
  const load = el("button", { class: "desk-btn", type: "button" }, "Load");
  const status = el("p", { class: "build-status", role: "status" });
  const allow = el("button", { class: "desk-btn", type: "button" }, "Allow");
  allow.hidden = true;
  source.append(tabs, input, args, kinds, load, status, allow);

  // Shape, fields, name, save.
  const shape = section("Shape");
  const shapes = el("div", { class: "desk-tabs", role: "group", "aria-label": "Shape" });
  shape.append(shapes);
  const fields = section("Fields");
  const roles = el("div", { class: "build-roles" });
  fields.append(roles);
  const name = section("Name");
  const title = /** @type {HTMLInputElement} */ (
    el("input", { class: "desk-field", type: "text", "aria-label": "Name" })
  );
  title.placeholder = "Name this view";
  name.append(title);
  const actions = el("div", { class: "build-actions" });
  const save = el("button", { class: "desk-btn desk-btn-primary", type: "button" }, "Save view");
  const cancel = el("button", { class: "desk-btn desk-btn-quiet", type: "button" }, "Cancel");
  actions.append(save, cancel);
  form.append(source, shape, fields);
  foot.append(name, actions);

  /** @type {{ kind: SourceKind, id?: string, type: UniversalType, map: Record<string, string>,
   *   source?: import("./open.js").UniversalView["source"], data: UniversalData | null }} */
  const state = { kind: "file", type: "list", map: {}, data: null };

  const drawTabs = () => {
    tabs.replaceChildren(
      ...SOURCES.map((s) => {
        const tab = el("button", {
          class: "desk-tab",
          type: "button",
          role: "tab",
          "aria-selected": String(s.kind === state.kind),
          "data-source": s.kind,
        });
        tab.textContent = s.label;
        tab.addEventListener("click", () => builder.pick(s.kind));
        return tab;
      }),
    );
    const hint = SOURCES.find((s) => s.kind === state.kind)?.hint ?? "";
    input.hidden = state.kind === "items";
    input.placeholder = hint;
    args.hidden = state.kind !== "command";
    kinds.hidden = state.kind !== "items";
  };
  const drawShapes = () => {
    shapes.replaceChildren(
      ...SHAPES.map((s) => {
        const button = el("button", {
          class: "desk-tab",
          type: "button",
          "aria-pressed": String(s.type === state.type),
          "data-shape": s.type,
        });
        button.textContent = s.label;
        button.addEventListener("click", () => builder.shape(s.type));
        return button;
      }),
    );
  };
  const drawRoles = () => {
    const known = fieldsOf(state.data);
    roles.replaceChildren(
      ...ROLES[state.type].map((role) => {
        const row = el("label", { class: "build-role" });
        const select = /** @type {HTMLSelectElement} */ (
          el("select", { class: "desk-field", "data-role": role })
        );
        const own = known.includes(role) ? `${role} (its own name)` : "none";
        select.append(el("option", { value: "" }, own));
        for (const field of known) select.append(el("option", { value: field }, field));
        select.value = state.map[role] ?? "";
        select.addEventListener("change", () => builder.role(role, select.value));
        row.append(el("span", {}, LABELS[role] ?? role), select);
        return row;
      }),
    );
  };
  /** The view as it stands, or undefined before a source loads. */
  const current = () =>
    state.source
      ? viewOf({
          ...(state.id ? { id: state.id } : {}),
          title: title.value,
          type: state.type,
          source: state.source,
          map: state.map,
        })
      : undefined;
  const redraw = () => {
    const view = current();
    if (!view) return;
    const { source: _, ...shown } = view;
    preview.view = shown;
    save.toggleAttribute("disabled", !state.data);
  };
  /** @param {string} said @param {boolean} [bad] */
  const say = (said, bad = false) => {
    status.textContent = said;
    status.classList.toggle("desk-error", bad);
  };
  /** @param {SourceKind} kind */
  const inputFor = (kind) => {
    const checked = [...kinds.querySelectorAll("input")]
      .filter((box) => /** @type {HTMLInputElement} */ (box).checked)
      .map((box) => /** @type {HTMLInputElement} */ (box).value);
    return {
      kind,
      path: input.value,
      url: input.value,
      command: input.value,
      args: args.value,
      kinds: checked,
    };
  };

  const builder = {
    element: root,
    get state() {
      return state;
    },
    get preview() {
      return preview;
    },
    /** Start over, or edit `view` (its source loaded, its shape and fields shown). */
    async start(/** @type {UniversalView | undefined} */ view) {
      Object.assign(state, { kind: "file", type: "list", map: {}, data: null });
      delete state.id;
      delete state.source;
      title.value = view?.title ?? "";
      input.value = "";
      args.value = "";
      preview.data = null;
      preview.setAttribute("state", "empty");
      say("Pick a source and load it.");
      if (view) {
        const filled = inputOf(view.source);
        state.id = view.id;
        state.type = view.type;
        state.map = { ...(view.map ?? {}) };
        state.kind = filled.kind;
        input.value = filled.path ?? filled.url ?? filled.command ?? "";
        args.value = filled.args ?? "";
        /** @type {HTMLInputElement} */ for (const box of kinds.querySelectorAll("input"))
          box.checked = (filled.kinds ?? []).includes(/** @type {HTMLInputElement} */ (box).value);
      }
      drawTabs();
      drawShapes();
      drawRoles();
      save.toggleAttribute("disabled", true);
      if (view) await builder.load();
      else input.focus();
    },
    /** @param {SourceKind} kind */
    pick(kind) {
      state.kind = kind;
      drawTabs();
      (kind === "items" ? kinds.querySelector("input") : input)?.focus();
    },
    /** Read the source the inputs name and show what it holds. */
    async load() {
      const named = sourceOf(inputFor(state.kind));
      if ("problem" in named) return say(named.problem, true);
      allow.hidden = true;
      preview.removeAttribute("message");
      preview.setAttribute("state", "loading");
      say("Loading…");
      try {
        const data = await ctx.universal.load(named.source);
        const changed = JSON.stringify(named.source) !== JSON.stringify(state.source);
        state.source = named.source;
        state.data = data;
        if (changed) state.map = { ...suggestMap(data), ...state.map };
        if (!title.value && data.title) title.value = data.title;
        preview.data = data;
        preview.setAttribute("state", "ready");
        const known = fieldsOf(data);
        say(
          `${data.entries.length} entries · ${known.slice(0, 6).join(", ")}${known.length > 6 ? ", …" : ""}`,
        );
        drawRoles();
        redraw();
      } catch (error) {
        const refused = /** @type {{ code?: string } | undefined} */ (error)?.code;
        const why = failureText(error, named.source);
        preview.setAttribute("state", refused === "permission_denied" ? "denied" : "error");
        // The preview says the same as the status, not "The source did not answer."
        if (refused !== "permission_denied") preview.setAttribute("message", why);
        allow.hidden = refused !== "permission_denied";
        say(why, true);
      }
    },
    /** @param {UniversalType} type */
    shape(type) {
      state.type = type;
      drawShapes();
      drawRoles();
      redraw();
    },
    /** @param {string} role @param {string} field */
    role(role, field) {
      if (field) state.map[role] = field;
      else delete state.map[role];
      redraw();
    },
    /** Save the view: a new one under a free `my.<slug>`, an edited one under its own id. */
    async save() {
      const view = current();
      if (!view || !state.data) return;
      const id = state.id ?? (await freeId(view.title ?? "view"));
      const kept = { ...view, id };
      try {
        await ctx.views.save(kept);
      } catch (error) {
        const refused = /** @type {{ code?: string }} */ (error)?.code === "permission_denied";
        return say(
          refused
            ? "Not saved: Desk needs your permission to keep views."
            : `Not saved: ~/.desk/views/${id}.yaml could not be written.`,
          true,
        );
      }
      state.id = id;
      hooks.saved(kept);
    },
  };

  /** @param {string} said */
  const freeId = async (said) => {
    const base = idFor(said);
    for (let n = 1; n < 100; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      const taken = await ctx.views.get(id).then(
        () => true,
        (/** @type {{ code?: string }} */ e) => e?.code !== "not_found",
      );
      if (!taken) return id;
    }
    return `${base}-${Date.now()}`;
  };

  load.addEventListener("click", () => void builder.load());
  input.addEventListener("keydown", (event) => {
    if (/** @type {KeyboardEvent} */ (event).key === "Enter") void builder.load();
  });
  allow.addEventListener("click", async () => {
    const named = sourceOf(inputFor(state.kind));
    const permission = "source" in named ? scopeOf(named.source) : undefined;
    if (!permission) return;
    const answer = await ctx.perm.request(permission, "Show this source in the view builder");
    if (answer.granted) await builder.load();
  });
  title.addEventListener("input", redraw);
  save.addEventListener("click", () => void builder.save());
  cancel.addEventListener("click", () => hooks.cancelled());
  host.append(root);
  return builder;
}
