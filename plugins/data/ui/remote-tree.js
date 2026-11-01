// A viewport of worker-owned tree rows. Keyboard navigation and grouping use the worker's model.
import { createVirtual } from "./virtual.js";

export function createRemoteTree(doc, el, hooks) {
  let source = null;
  let selected;
  let version = 0;
  let drawing = 0;
  const failure = (error) => {
    if (error.name !== "AbortError") hooks.status(error.message);
  };
  const select = (row) => {
    selected = row;
    if (row) hooks.select(row);
  };
  const draw = (row, i) => {
    const item = doc.createElement("div");
    item.className = "row";
    item.id = `worker-row-${i}`;
    item.dataset.key = row.key;
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-level", row.level);
    item.setAttribute("aria-setsize", row.setsize);
    item.setAttribute("aria-posinset", row.posinset);
    item.setAttribute("aria-selected", String(row.key === selected?.key));
    item.style.paddingLeft = `${(row.level - 1) * 16 + 4}px`;
    const twisty = doc.createElement("span");
    twisty.className = "twisty";
    twisty.setAttribute("aria-hidden", "true");
    if (row.branch) {
      item.setAttribute("aria-expanded", String(row.expanded));
      twisty.textContent = row.expanded ? "▾" : "▸";
    }
    const key = doc.createElement("span");
    key.className = "key";
    key.textContent = row.label;
    const sep = doc.createElement("span");
    sep.className = "sep";
    sep.textContent = row.branch ? " " : ": ";
    const value = doc.createElement("span");
    value.className = `value kind-${row.kind}${row.masked && row.preview === "••••••••" ? " masked" : ""}`;
    value.textContent = row.preview;
    item.append(twisty, key, sep, value);
    for (const text of [
      row.tag,
      row.anchor && `&${row.anchor}`,
      row.alias && `*${row.alias}`,
      row.duplicate && "duplicate key",
    ]) {
      if (!text) continue;
      const badge = doc.createElement("span");
      badge.className = "badge";
      badge.textContent = text;
      item.append(badge);
    }
    if (row.masked && !row.group && row.preview === "••••••••") {
      const reveal = doc.createElement("button");
      reveal.type = "button";
      reveal.className = "reveal";
      reveal.tabIndex = -1;
      reveal.textContent = "Reveal";
      reveal.setAttribute("aria-label", `Reveal the value of ${row.label}`);
      reveal.addEventListener("click", (event) => {
        event.stopPropagation();
        const current = version;
        void act({ action: "select", key: row.key }).then((applied) => {
          if (applied && current === version && selected?.key === row.key) hooks.reveal(row);
        });
      });
      item.append(reveal);
    }
    return item;
  };
  const virtual = createVirtual(el, 22, (first, last) => {
    const at = ++drawing;
    const current = version;
    if (!source) {
      virtual.window.replaceChildren();
      return;
    }
    void source
      .request("rows", { from: first, count: last - first })
      .then((result) => {
        if (at !== drawing || current !== version) return;
        virtual.window.replaceChildren(...result.items.map((row, i) => draw(row, first + i)));
        const row = result.items.findIndex((row) => row.key === selected?.key);
        if (row >= 0) el.setAttribute("aria-activedescendant", `worker-row-${first + row}`);
        else el.removeAttribute("aria-activedescendant");
      })
      .catch(failure);
  });
  const apply = (result) => {
    virtual.setCount(result.count);
    select(result.selected);
    virtual.reveal(result.index);
    virtual.render();
  };
  const act = async (args) => {
    if (!source) return;
    const current = version;
    try {
      const result = await source.request("tree", args);
      if (current === version) {
        apply(result);
        return true;
      }
    } catch (error) {
      failure(error);
    }
  };
  el.addEventListener("click", (event) => {
    if (!source) return;
    const item = event.target.closest("[role=treeitem]");
    if (!item) return;
    void act({
      action: event.target.classList.contains("twisty") ? "toggle" : "select",
      key: item.dataset.key,
    });
  });
  el.addEventListener("keydown", (event) => {
    if (!source || event.ctrlKey || event.metaKey || event.altKey) return;
    if (
      ![
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageDown",
        "PageUp",
        "Enter",
        " ",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    void act({ action: event.key, page: Math.max(1, virtual.rowsInView() - 1) });
  });
  const mask = async (keys, revealed) => {
    const current = ++version;
    virtual.window.replaceChildren();
    if (!source) return;
    try {
      const result = await source.request("mask", { keys, revealed });
      if (current === version) apply(result);
    } catch (error) {
      failure(error);
    }
  };
  return {
    load(next, keys) {
      source = null;
      version++;
      selected = undefined;
      virtual.setCount(0);
      virtual.render();
      source = next;
      if (next) void mask(keys, null);
    },
    mask,
    expandAll: () => act({ action: "expand" }),
    collapseAll: () => act({ action: "collapse" }),
    reveal: (path) => act({ action: "reveal", path }),
    selected: () => selected,
    focus() {
      el.focus();
    },
  };
}
