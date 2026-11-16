// The strip of open requests: each tab shows its method and name, a dot while unsaved, a close
// button on hover; drag to reorder, middle-click or Mod+W to close, right-click for more. The
// environment picker sits at the strip's right end.

import { button, h, icon, methodBadge } from "./dom.js";
import { showMenu } from "./menu.js";
import { methodClass } from "./model.js";

/** @typedef {import("./studio.js").Studio} Studio */

/** @param {Studio} S */
export function tabStrip(S) {
  const list = h("div.as-tablist", { role: "tablist", "aria-label": "Open requests" });
  const right = h("div.as-tabs-right");
  const root = h(
    "div.as-tabs",
    null,
    list,
    button({
      label: "New request",
      icon: "plus",
      hideLabel: true,
      kind: "as-newtab",
      onClick: () => S.app.blank(),
    }),
    h("span.as-grow"),
    right,
  );
  /** @type {string | null} */
  let dragging = null;

  const draw = () => {
    const { tabs, active } = S.app.state;
    list.replaceChildren(
      ...tabs.map((tab, i) => {
        const dirty = S.app.dirty(tab);
        const el = h(
          `div.as-tab${tab.id === active ? ".is-active" : ""}${dirty ? ".is-dirty" : ""}`,
          {
            role: "tab",
            tabindex: "0",
            "aria-selected": String(tab.id === active),
            draggable: "true",
            title: tab.req.url || tab.req.name,
            dataset: { tab: tab.id },
            onClick: () => S.app.activate(tab.id),
            onAuxclick: (/** @type {MouseEvent} */ e) => {
              if (e.button === 1) S.closeTab(tab);
            },
            onContextmenu: (/** @type {MouseEvent} */ e) => {
              e.preventDefault();
              showMenu(
                [
                  { label: "Close", icon: "close", run: () => S.closeTab(tab) },
                  { label: "Close others", run: () => S.app.closeOthers(tab.id) },
                  { label: "Close all", run: () => S.app.closeOthers() },
                  "-",
                  { label: "Duplicate", icon: "plus", run: () => S.duplicate(tab) },
                  { label: "Rename…", icon: "edit", run: () => S.rename(tab) },
                ],
                { x: e.clientX, y: e.clientY },
                { width: 180 },
              );
            },
            onDragstart: (/** @type {DragEvent} */ e) => {
              dragging = tab.id;
              e.dataTransfer?.setData("text/plain", tab.req.url);
            },
            onDragover: (/** @type {DragEvent} */ e) => {
              if (dragging) e.preventDefault();
            },
            onDrop: (/** @type {DragEvent} */ e) => {
              e.preventDefault();
              if (dragging && dragging !== tab.id) S.app.move(dragging, i);
              dragging = null;
            },
            onKeydown: (/** @type {KeyboardEvent} */ e) => {
              if (e.key === "Enter") S.app.activate(tab.id);
            },
          },
          tab.kind === "group"
            ? h(
                "span.as-tab-icon",
                null,
                icon(tab.ref?.path === tab.ref?.collection ? "collections" : "folder", 14),
              )
            : tab.kind === "env"
              ? tab.ref?.path === "globals"
                ? h("span.as-tab-icon", null, icon("globe", 14))
                : h(`span.as-env-dot.env-${tab.extra?.color ?? "gray"}`)
              : methodBadge(tab.req.method, methodClass(tab.req.method)),
          h("span.as-tab-name", null, tab.req.name || "Untitled request"),
          tab.running ? h("span.as-spin.is-small") : null,
          h(
            "button.desk-icon-btn.as-tab-close",
            {
              type: "button",
              "aria-label": `Close ${tab.req.name}`,
              onClick: (/** @type {MouseEvent} */ e) => {
                e.stopPropagation();
                S.closeTab(tab);
              },
            },
            h("span.as-tab-dirty", { "aria-hidden": "true" }),
            icon("close", 12),
          ),
        );
        return el;
      }),
    );
    list.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  S.app.on("tabs", draw);
  S.app.on("tab", draw);
  S.app.on("sending", draw);
  S.app.on("req", (d) => {
    if (
      !d ||
      ["method", "url", "name", "params", "body", "headers", "auth", "settings", "saved"].includes(
        d.field,
      )
    )
      draw();
  });
  draw();
  return {
    el: root,
    /** Put something at the strip's right end (the environment picker). @param {Node} node */
    setRight: (node) => right.replaceChildren(node),
  };
}
