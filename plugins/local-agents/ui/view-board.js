// The Board view: To do, Running, Done and Failed as columns of cards. A card is dragged to another
// column, or moved with [ and ]; Run puts it in Running, where its agent answers it; the selected
// card opens beside the board with its prompt and answer.

import { badge, button, el, markdown } from "./dom.js";

/**
 * @typedef {import("./dom.js").Act} Act
 * @typedef {import("./model.js").ViewModel} ViewModel
 * @typedef {import("./model.js").CardModel} CardModel
 */

const DRAG_TYPE = "text/plain";

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createBoardView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const form = /** @type {HTMLFormElement} */ (byId("card-form"));
  const title = /** @type {HTMLInputElement} */ (byId("card-title"));
  const prompt = /** @type {HTMLTextAreaElement} */ (byId("card-prompt"));
  const agent = /** @type {HTMLSelectElement} */ (byId("card-agent"));
  const addRun = byId("card-add-run");
  const columnsEl = byId("board-columns");
  const detail = byId("card-detail");
  /** @type {ViewModel["board"]["columns"]} */
  let columns = [];
  let selected = "";
  let agentsKey = "";

  const add = (/** @type {boolean} */ run) => {
    if (!prompt.value.trim()) return prompt.focus();
    const spec = { title: title.value, prompt: prompt.value, agent: agent.value, run };
    title.value = "";
    prompt.value = "";
    void act("addCard", spec);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    add(false);
  });
  addRun.addEventListener("click", () => add(true));
  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      add(false);
    }
  });

  /** Where a card dropped over `list` at `y` goes: before the first card below the pointer. */
  const dropIndex = (/** @type {HTMLElement} */ list, /** @type {number} */ y) => {
    const cards = [...list.querySelectorAll(".card")];
    const at = cards.findIndex((c) => {
      const box = c.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return at < 0 ? undefined : at;
  };

  /** @param {CardModel} card @param {string} column */
  const drawCard = (card, column) => {
    const node = el(
      doc,
      "article",
      {
        class: `card ${card.state}`,
        id: `card-${card.id}`,
        role: "listitem",
        draggable: "true",
        tabindex: card.id === selected ? "0" : "-1",
        "aria-current": card.id === selected ? "true" : undefined,
        "aria-label": `${card.title}, ${card.agentName}, ${card.state}`,
      },
      el(doc, "header", {}, el(doc, "strong", {}, card.title), badge(doc, card.state)),
      el(doc, "p", { class: "facts" }, card.agentName, card.meta ? ` · ${card.meta}` : ""),
      card.error && card.state !== "done"
        ? el(doc, "p", { class: "problem" }, card.error)
        : undefined,
      el(
        doc,
        "p",
        { class: "actions" },
        column === "running"
          ? button(doc, "Stop", act, "stopCard", [card.id])
          : button(doc, column === "todo" ? "Run" : "Run again", act, "runCard", [card.id]),
        button(doc, "◀", act, "shiftCard", [card.id, -1], {
          "aria-label": "Move left",
          disabled: column === "todo",
        }),
        button(doc, "▶", act, "shiftCard", [card.id, 1], {
          "aria-label": "Move right",
          disabled: column === "failed",
        }),
        button(doc, "Remove", act, "removeCard", [card.id]),
      ),
    );
    node.addEventListener("click", () => void act("selectCard", card.id));
    node.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData(DRAG_TYPE, card.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    return node;
  };

  /** @param {CardModel | undefined} card */
  const drawDetail = (card) => {
    detail.hidden = !card;
    if (!card) return detail.replaceChildren();
    detail.replaceChildren(
      el(doc, "h2", {}, card.title),
      el(
        doc,
        "p",
        { class: "facts" },
        card.agentName,
        " · ",
        badge(doc, card.state),
        card.meta ? ` · ${card.meta}` : "",
      ),
      el(doc, "h3", {}, "Prompt"),
      el(doc, "pre", { class: "plain" }, card.prompt),
      el(doc, "h3", {}, "Answer"),
      card.answer
        ? markdown(doc, card.answer)
        : el(doc, "p", { class: "note" }, card.state === "running" ? "Thinking…" : "Not run yet."),
      card.error ? el(doc, "p", { class: "problem" }, card.error) : undefined,
      el(doc, "p", { class: "actions" }, button(doc, "Change agent", act, "cardAgent", [card.id])),
    );
  };

  /** @param {ViewModel} model */
  const render = (model) => {
    const { board } = model;
    columns = board.columns;
    selected = board.selected;
    const found = model.agents.filter((a) => a.state === "ready");
    const key = found.map((a) => a.id).join(",");
    if (key !== agentsKey) {
      agentsKey = key;
      agent.replaceChildren(...found.map((a) => el(doc, "option", { value: a.id }, a.name)));
    }
    if (model.chat.agent && found.some((a) => a.id === model.chat.agent) && !agent.dataset.touched)
      agent.value = model.chat.agent;
    const focused = columnsEl.contains(doc.activeElement);
    columnsEl.replaceChildren(
      ...columns.map((column) => {
        const list = el(
          doc,
          "div",
          { class: "cards", role: "list", "aria-label": column.title },
          ...column.cards.map((card) => drawCard(card, column.id)),
        );
        const section = el(
          doc,
          "section",
          { class: `column ${column.id}`, "data-column": column.id },
          el(
            doc,
            "h2",
            {},
            column.title,
            el(doc, "span", { class: "count" }, String(column.cards.length)),
          ),
          column.id === "running"
            ? el(doc, "p", { class: "note" }, `${board.parallel} at a time`)
            : undefined,
          list,
        );
        section.addEventListener("dragover", (event) => {
          event.preventDefault();
          section.classList.add("over");
        });
        section.addEventListener("dragleave", () => section.classList.remove("over"));
        section.addEventListener("drop", (event) => {
          event.preventDefault();
          section.classList.remove("over");
          const id = event.dataTransfer?.getData(DRAG_TYPE);
          if (id) void act("moveCard", id, column.id, dropIndex(list, event.clientY));
        });
        return section;
      }),
    );
    if (focused)
      /** @type {HTMLElement | null} */ (doc.getElementById(`card-${selected}`))?.focus();
    drawDetail(board.open);
  };
  agent.addEventListener("change", () => {
    agent.dataset.touched = "true";
  });

  /** Where the selected card is: its column and place. */
  const where = () => {
    for (const [c, column] of columns.entries()) {
      const at = column.cards.findIndex((card) => card.id === selected);
      if (at >= 0) return { c, at };
    }
    return { c: 0, at: -1 };
  };

  /** Select the card a move lands on. */
  const move = (/** @type {string} */ to) => {
    const { c, at } = where();
    let column = c;
    let index = at;
    if (to === "left" || to === "right") {
      for (let step = 1; step < columns.length; step++) {
        const next = c + (to === "left" ? -step : step);
        if (next < 0 || next >= columns.length) break;
        if ((columns[next]?.cards.length ?? 0) > 0) {
          column = next;
          index = Math.min(Math.max(at, 0), (columns[next]?.cards.length ?? 1) - 1);
          break;
        }
      }
    } else {
      const length = columns[column]?.cards.length ?? 0;
      const by = { next: 1, previous: -1, first: -length, last: length }[to] ?? 0;
      index = Math.max(0, Math.min(length - 1, index + by));
    }
    const card = columns[column]?.cards[index];
    if (card) void act("selectCard", card.id);
    doc.getElementById(`card-${card?.id}`)?.focus();
  };

  /** @type {Record<string, () => unknown>} */
  const onSelected = {
    runSelected: () => act("runCard", selected),
    stopSelected: () => act("stopCard", selected),
    removeSelected: () => act("removeCard", selected),
    agentSelected: () => act("cardAgent", selected),
    shiftLeft: () => act("shiftCard", selected, -1),
    shiftRight: () => act("shiftCard", selected, 1),
    openSelected: () => act("selectCard", selected),
  };

  return {
    render,
    focus: () => prompt.focus(),
    /** @param {string} action @param {unknown[]} args */
    key(action, args) {
      if (action === "move") {
        move(/** @type {string} */ (args[0]));
        return true;
      }
      const fn = onSelected[action];
      if (!fn) return false;
      if (selected) void fn();
      return true;
    },
  };
}
