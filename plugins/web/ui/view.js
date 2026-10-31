// The DOM for the web plugin: the file's name and format, a Source toggle, a bar for what a page
// left out, and one of a page (in a shadow root), a list of entries beside a page, a link card,
// an outline or a file's details. A status live region says what happened. Chords (Mod+S, Mod+O,
// Mod+W, Mod+K) are never prevented, so the SDK passes them to the desk.
import { localPath } from "./links.js";
import { createSource } from "./source.js";
import { createPageView } from "./view-page.js";
import {
  markEntry,
  renderCard,
  renderDetails,
  renderEntries,
  renderOutline,
} from "./view-parts.js";

/**
 * @typedef {import("./web.js").Shown} Shown
 * @typedef {import("./formats.js").Model} Model
 * @typedef {import("./formats.js").PageInput} PageInput
 * @typedef {import("./resources.js").Left} Left
 * @typedef {{ open(path: string): unknown, say(text: string): void }} Actions
 */

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) =>
  n === 1 ? one : many;

/** The bar's sentence: what the page left out, and whether it shows anything without scripts. */
export function leftOut(/** @type {Left} */ left, empty = false) {
  const said = [];
  if (left.remote)
    said.push(
      `${left.remote} remote ${plural(left.remote, "resource was", "resources were")} not loaded: Web does not reach the network.`,
    );
  if (left.missing)
    said.push(
      `${left.missing} ${plural(left.missing, "file the page uses was", "files the page uses were")} not found.`,
    );
  if (left.limit)
    said.push(
      `${left.limit} ${plural(left.limit, "file was", "files were")} left out: past the 20 MB or nesting limit.`,
    );
  if (empty) said.push("The page shows nothing without its scripts, and Web does not run them.");
  return said.join(" ");
}

/** A URL without its fragment, or the text itself when it is not one. */
const withoutHash = (/** @type {string} */ href) => {
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return href;
  }
};

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const name = byId("file-name");
  const detail = byId("file-detail");
  const toggle = byId("source-toggle");
  const bar = byId("bar");
  const entriesNav = byId("entries");
  const entryList = byId("entry-list");
  const pageHost = byId("page");
  const text = byId("text");
  const card = byId("card");
  const outline = byId("outline");
  const details = byId("details");
  const sourceBox = byId("source");
  const status = byId("status");
  const source = createSource(doc, sourceBox);

  /** @type {Shown | null} */
  let file = null;
  let selected = 0;
  let sourceOn = false;
  /** The page on screen, for links within it. @type {PageInput | null} */
  let page = null;

  const link = (/** @type {string} */ href) => {
    if (href.startsWith("#")) return pages.scrollTo(href.slice(1));
    const target = withoutHash(href);
    const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
    if (page && target === withoutHash(page.resolver.base)) return pages.scrollTo(hash);
    const model = file?.model;
    if (model?.kind === "entries") {
      const index = model.entries.findIndex(
        (e) => e.page && withoutHash(e.page.resolver.base) === target,
      );
      if (index >= 0) return void select(index).then(() => hash && pages.scrollTo(hash));
    }
    const path = localPath(href);
    if (path) return void actions.open(path);
    actions.say(href);
  };
  const pages = createPageView(doc, pageHost, {
    link,
    submitted: () => actions.say("Forms on saved pages do not submit."),
  });

  /** The text the Source button shows for what is on screen. */
  const sourceText = () => {
    const model = file?.model;
    if (!model || model.kind === "details") return undefined;
    if (model.kind === "entries") return model.entries[selected]?.source ?? model.source;
    return model.source;
  };

  const sayLeft = (/** @type {string} */ words) => {
    bar.textContent = words;
    bar.hidden = !words;
  };

  /** Show the content of the file (or of its selected entry), or its source. */
  const layout = async () => {
    const model = file?.model;
    const kind = model?.kind;
    const entry = kind === "entries" ? model?.entries[selected] : undefined;
    const shownPage = kind === "page" ? model.page : (entry?.page ?? null);
    const words = sourceText();
    toggle.hidden = words === undefined;
    const showSource = sourceOn && words !== undefined;
    toggle.setAttribute("aria-pressed", String(showSource));
    sourceBox.hidden = !showSource;
    entriesNav.hidden = kind !== "entries" || showSource;
    pageHost.hidden = showSource || !shownPage;
    text.hidden = showSource || !(entry && !entry.page);
    card.hidden = showSource || kind !== "card";
    outline.hidden = showSource || kind !== "outline";
    details.hidden = kind !== "details";
    if (showSource) {
      source.show(words ?? "");
      sayLeft("");
    }
    if (entry && !entry.page) text.textContent = entry.text ?? "";
    page = shownPage;
    const drawn = await pages.draw(shownPage);
    if (drawn && !showSource) {
      sayLeft(leftOut(drawn.left, drawn.empty));
      if (drawn.title)
        detail.textContent = `${file?.model.format ?? ""} · ${drawn.title} · ${file?.path ?? ""}`;
    } else if (!showSource) sayLeft("");
  };

  const select = async (/** @type {number} */ index) => {
    selected = index;
    markEntry(entryList, index);
    await layout();
  };

  toggle.addEventListener("click", () => {
    sourceOn = !sourceOn;
    void layout();
  });

  return {
    /** @param {Shown | null} shown */
    async show(shown) {
      const changed = shown?.model !== file?.model;
      file = shown;
      name.textContent = shown ? shown.name : "No file open";
      const title =
        shown && "title" in shown.model && shown.model.kind !== "card" ? shown.model.title : "";
      detail.textContent = shown
        ? [shown.model.format, title, shown.path].filter(Boolean).join(" · ")
        : "";
      const model = shown?.model;
      if (changed && model?.kind === "entries") {
        selected = Math.min(model.selected, Math.max(0, model.entries.length - 1));
        entriesNav.setAttribute("aria-label", model.label);
        renderEntries(doc, entryList, model.entries, (index) => void select(index));
        markEntry(entryList, selected);
      }
      if (changed && model?.kind === "card")
        renderCard(doc, card, model, (path) => void actions.open(path));
      if (changed && model?.kind === "outline")
        renderOutline(doc, outline, model.title, model.outlines);
      if (changed && shown && model?.kind === "details")
        renderDetails(doc, details, {
          name: shown.name,
          size: shown.size,
          format: model.format,
          reason: model.reason,
        });
      await layout();
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    focus() {
      const model = file?.model;
      const target = !sourceBox.hidden
        ? sourceBox
        : model?.kind === "entries"
          ? entryList.querySelector('[aria-current="true"]')
          : model?.kind === "card"
            ? (card.querySelector("button") ?? card)
            : model?.kind === "page"
              ? pageHost
              : model
                ? byId("body")
                : null;
      /** @type {HTMLElement | null} */ (target)?.focus();
    },
  };
}
