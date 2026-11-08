/**
 * The which-key overlay (ADR 0118): while a prefix is pending it lists every continuation, takes the
 * keyboard focus (so the plain keys a plugin frame would keep reach the desk), and gives the focus
 * back to where it was when the wait ends, before the command runs. It is mounted only while a
 * prefix is pending, so the desk's render tree is unchanged otherwise.
 */
import { h } from "../shell/dom";
import { comboOf, MODIFIER_KEYS, type Platform } from "./chord";
import type { Resolved } from "./conflicts";
import { type SequenceLanguage, sequenceText } from "./copy";
import { formatChords } from "./parse";
import type { SequenceEvent, SequenceRouter } from "./router";
import {
  filterItems,
  type Item,
  type ItemFacts,
  itemsOf,
  moveSelection,
  overlayAction,
} from "./which-key-model";
import "./sequences.css";

export interface WhichKeyOptions {
  root: HTMLElement;
  sequences: SequenceRouter;
  platform: Platform;
  language: SequenceLanguage;
  /** The bindings in force (the keymap's). */
  bindings(): Resolved[];
  facts: Omit<ItemFacts, "platform">;
}

const LIST = "desk-which-key-list";

export function mountWhichKey(options: WhichKeyOptions): { dispose(): void } {
  const { root, sequences, platform } = options;
  const tr = (key: Parameters<typeof sequenceText>[1]) => sequenceText(options.language, key);
  const doc = root.ownerDocument;
  let open: ReturnType<typeof build> | undefined;
  let restore: Element | null = null;

  function build() {
    const title = h("p", { class: "desk-which-key-title", id: "desk-which-key-title" });
    const search = h("input", {
      type: "search",
      class: "desk-field desk-which-key-search",
      role: "combobox",
      "aria-expanded": "true",
      "aria-controls": LIST,
      "aria-autocomplete": "list",
      "aria-labelledby": "desk-which-key-title",
      placeholder: tr("search"),
      autocomplete: "off",
      spellcheck: "false",
    });
    const list = h("ul", { class: "desk-which-key-list", id: LIST, role: "listbox" });
    list.setAttribute("aria-label", tr("continuations"));
    const panel = h(
      "div",
      { class: "desk-which-key", role: "dialog", "aria-labelledby": "desk-which-key-title" },
      title,
      search,
      list,
      h("p", { class: "desk-which-key-help", "aria-hidden": "true" }, tr("help")),
    );
    let items: Item[] = [];
    let shown: Item[] = [];
    let selected = 0;

    const draw = () => {
      shown = filterItems(items, search.value);
      if (selected >= shown.length) selected = shown.length - 1;
      if (selected < 0 && shown.length) selected = 0;
      list.replaceChildren(
        ...(shown.length
          ? shown.map((item, i) =>
              h(
                "li",
                {
                  id: `desk-which-key-${i}`,
                  role: "option",
                  class: `desk-which-key-item${item.off ? " is-off" : ""}`,
                  "aria-selected": String(i === selected),
                  "aria-disabled": item.off ? "true" : undefined,
                  "data-combo": item.combo,
                  onMousedown: (event: Event) => {
                    event.preventDefault();
                    sequences.feed(item.rest);
                  },
                },
                h(
                  "span",
                  { class: "desk-which-key-keys" },
                  ...item.keys.map((k) => h("kbd", {}, k)),
                ),
                h("span", { class: "desk-which-key-command" }, item.title),
                h(
                  "span",
                  { class: "desk-which-key-owner" },
                  item.off ? `${item.owner} · ${tr("off")}` : item.owner,
                ),
              ),
            )
          : [h("li", { class: "desk-which-key-empty", role: "presentation" }, tr("nothing"))]),
      );
      if (selected >= 0 && shown.length) {
        search.setAttribute("aria-activedescendant", `desk-which-key-${selected}`);
        list.children[selected]?.scrollIntoView?.({ block: "nearest" });
      } else search.removeAttribute("aria-activedescendant");
    };

    const show = (event: Extract<SequenceEvent, { kind: "pending" }>) => {
      const prefix = formatChords(event.chords.join(" "), platform).flatMap((chord, i) =>
        i ? [" ", h("kbd", {}, chord)] : [h("kbd", {}, chord)],
      );
      const words = h("span", {}, tr(event.capturing ? "describing" : "after"));
      // "Keys after ⌘K" in English; "⌘K 다음 키" in Korean.
      title.replaceChildren(
        ...(options.language === "ko" ? [...prefix, " ", words] : [words, " ", ...prefix]),
      );
      items = itemsOf(options.bindings(), event.chords, { platform, ...options.facts });
      search.value = "";
      selected = 0;
      draw();
    };

    search.addEventListener("input", () => {
      selected = 0;
      draw();
    });
    search.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      // The desk's own listener must not route what the overlay already handled.
      event.stopPropagation();
      if (MODIFIER_KEYS.has(event.key)) return;
      const chord = comboOf(event);
      const action = overlayAction(chord, {
        searching: search.value !== "",
        continues: sequences.bound([...sequences.pending, chord]),
        printable: event.key.length === 1 && !(event.metaKey || event.ctrlKey || event.altKey),
      });
      if (action === "type") return;
      event.preventDefault();
      if (event.repeat && action !== "up" && action !== "down") return;
      if (action === "cancel") sequences.cancel();
      else if (action === "continue" || action === "unbound") sequences.press(chord, null);
      else if (action === "back") sequences.back();
      else if (action === "up" || action === "down") {
        selected = moveSelection(selected, shown.length, action === "up" ? -1 : 1);
        draw();
      } else if (action === "run") {
        const item = shown[selected];
        if (item) sequences.feed(item.rest);
      }
    });
    // Focus or a click elsewhere ends the wait; the window losing focus (another app) does not.
    panel.addEventListener("focusout", (event) => {
      const next = (event as FocusEvent).relatedTarget as Node | null;
      if (open && next && !panel.contains(next)) sequences.cancel();
    });
    const outside = (event: Event) => {
      if (open && !panel.contains(event.target as Node)) sequences.cancel();
    };
    doc.addEventListener("pointerdown", outside, true);
    const remove = () => {
      doc.removeEventListener("pointerdown", outside, true);
      panel.remove();
    };
    return { panel, search, show, remove };
  }

  const close = () => {
    const was = open;
    if (!was) return;
    open = undefined;
    const hadFocus = was.panel.contains(doc.activeElement);
    was.remove();
    // Back to the frame, field or button the prefix was pressed in.
    if (hadFocus && restore instanceof HTMLElement && restore.isConnected) restore.focus();
    restore = null;
  };

  const off = sequences.onChange((event) => {
    if (event.kind === "done") return close();
    if (!open) {
      restore = doc.activeElement;
      open = build();
      root.append(open.panel);
    }
    open.show(event);
    if (doc.activeElement !== open.search) open.search.focus();
  });

  return {
    dispose: () => {
      off();
      close();
    },
  };
}
