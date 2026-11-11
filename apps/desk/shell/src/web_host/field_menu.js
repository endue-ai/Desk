// The text field's menu (#156), drawn in the page where the shell placed it
// (`field_menu_model.rs`): a box at the shell's place with the shell's rows, in the page's top
// layer, above its dialogs. The shell hears every press and key on it and chooses for it; the page
// only shows it. Called with the shell's spec, or with null to take it away.
(spec) => {
  const KEY = Symbol.for("desk.fieldMenu");
  let menu = globalThis[KEY];
  if (!spec) {
    menu?.host.remove();
    delete globalThis[KEY];
    return;
  }
  if (!menu?.host.isConnected) {
    const host = document.createElement("desk-field-menu");
    host.setAttribute("popover", "manual");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    // The desk's menu tokens (packages/ui/src/tokens.css), and their dark values where a page
    // has none.
    style.textContent = `
      .menu { position: absolute; inset: 0; box-sizing: border-box; overflow: hidden;
        background: var(--desk-menu-bg, #2b2731); color: var(--desk-text, #f2f0f5);
        border-radius: var(--desk-menu-radius, 8px);
        box-shadow: inset 0 0 0 1px var(--desk-menu-border, #333136),
          var(--desk-menu-shadow, 0 8px 24px rgb(0 0 0 / 40%));
        font: 13px/1 var(--desk-font-sans, -apple-system, system-ui, sans-serif);
        user-select: none; cursor: default; }
      .row { position: absolute; left: 5px; right: 5px; box-sizing: border-box; padding: 0 9px;
        display: flex; align-items: center; justify-content: space-between;
        border-radius: var(--desk-row-radius, 5px); }
      .row[aria-disabled="true"] { color: var(--desk-text-muted, #b0adb7); opacity: 0.6; }
      .row.hover { background: var(--desk-row-active-bg, #37313f);
        color: var(--desk-row-active-fg, #f2f0f5); }
      .keys { color: var(--desk-text-muted, #b0adb7); font-size: 12px; }
      .separator { position: absolute; left: 10px; right: 10px; height: 1px;
        background: var(--desk-menu-border, #333136); }`;
    const box = document.createElement("div");
    box.className = "menu";
    box.setAttribute("role", "menu");
    root.append(style, box);
    document.documentElement.append(host);
    menu = { host, box };
    Object.defineProperty(globalThis, KEY, { value: menu, configurable: true });
  }
  const { host, box } = menu;
  host.style.cssText =
    `position: fixed; inset: auto; left: ${spec.x}px; top: ${spec.y}px; width: ${spec.w}px;` +
    ` height: ${spec.h}px; margin: 0; padding: 0; border: 0; background: transparent;` +
    " overflow: visible; color-scheme: inherit;";
  const rows = spec.rows.map((row, i) => {
    const el = document.createElement("div");
    if (row.separator) {
      el.className = "separator";
      el.setAttribute("role", "separator");
      el.style.top = `${row.top + Math.floor(row.h / 2)}px`;
      return el;
    }
    el.className = i === spec.hover ? "row hover" : "row";
    el.setAttribute("role", "menuitem");
    el.setAttribute("aria-disabled", String(!row.enabled));
    el.style.top = `${row.top}px`;
    el.style.height = `${row.h}px`;
    const label = document.createElement("span");
    label.textContent = row.label;
    const keys = document.createElement("span");
    keys.className = "keys";
    keys.textContent = row.keys;
    el.append(label, keys);
    return el;
  });
  box.replaceChildren(...rows);
  // What shows, for a reader of the page (the app e2e): each row's label, top, height and state.
  host.dataset.rows = JSON.stringify(
    spec.rows.map((r) => [r.separator ? "-" : r.label, r.top, r.h, Boolean(r.enabled)]),
  );
  host.dataset.hover = String(spec.hover);
  if (!host.matches(":popover-open")) host.showPopover();
};
