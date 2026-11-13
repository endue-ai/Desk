// An off-screen plugin surface (#52) is the top of its own browser, so its window has no parent; the
// SDK talks to `window.parent`. Before the page's own scripts run, `parent` becomes the desk: its
// postMessage goes to the runtime's page through the shell's relay (ADR 0160), and the runtime's
// messages arrive as `message` events whose source is `parent`, as a frame's did. Messages travel
// as JSON.
(() => {
  const native = globalThis.__deskNative;
  if (!native || typeof native.post !== "function") return;
  const post = native.post;
  const desk = Object.freeze({
    postMessage(message) {
      // What the shim says of an OS drag (below) is the shim's alone.
      if (String(message?.type).startsWith("desk:os-")) return;
      let text;
      try {
        text = JSON.stringify(message);
      } catch {
        return;
      }
      if (typeof text === "string") post(text);
    },
  });
  Object.defineProperty(globalThis, "parent", { value: desk, enumerable: true });
  // Files dragged in from the OS over a window out of the canvas (#235): its browser takes the OS
  // drag itself and the shell holds the files (`app_windows/drags.rs`). The page's own handlers
  // never see it, as on the canvas; this follows it and tells the shell where it is, and the shell
  // asks the page's targets as the desk's broker does. A drag with no files is the page's own. An
  // off-screen page never gets an OS drag, so this never speaks there.
  let depth = 0;
  let said = "";
  const tell = (type, e) => {
    const keys = { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey };
    const text = JSON.stringify({ type, x: e.clientX, y: e.clientY, keys });
    if (type === "desk:os-dragover" && text === said) return;
    said = text;
    post(text);
  };
  const follow = (e) => {
    if (e.dataTransfer?.types?.includes?.("Files") !== true) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "dragleave") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        said = "";
        post(JSON.stringify({ type: "desk:os-dragleave" }));
      }
      return;
    }
    if (e.type === "drop") {
      depth = 0;
      tell("desk:os-drop", e);
      said = "";
      return;
    }
    if (e.type === "dragenter") depth += 1;
    e.dataTransfer.dropEffect = "copy";
    tell("desk:os-dragover", e);
  };
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
    globalThis.addEventListener(type, follow, true);
  }
  // Tab entered the surface's place (#123): the focus goes to this page's first control (or its last, for
  // Shift+Tab), as Tab into a plugin's frame put it there; with none, it passes the page by. A text
  // field's text is selected, as Tab selects it. Chromium's own order: positive tabindex first, by
  // value, then document order, open shadow roots included; nothing disabled, inert or unrendered;
  // a radio group by its checked button.
  const CONTROLS =
    "a[href],area[href],button,input,select,textarea,iframe,summary,audio[controls]," +
    "video[controls],[contenteditable]:not([contenteditable=false]),[tabindex]";
  /** The fields whose text Tab selects. */
  const TYPED = /^(text|search|url|tel|email|password|number)$/;
  const controls = (root, all) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.matches(CONTROLS)) all.push(el);
      if (el.shadowRoot) controls(el.shadowRoot, all);
    }
    return all;
  };
  const order = (el) => (el.hasAttribute("tabindex") ? el.tabIndex : 0);
  /** A radio button whose group has another button checked: Tab goes to that one. */
  const passed = (el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name || el.checked) {
      return false;
    }
    const scope = el.form ?? el.getRootNode();
    const checked = scope.querySelectorAll("input[type=radio]:checked");
    return [...checked].some((other) => other.name === el.name && other.form === el.form);
  };
  const tabbable = (el) =>
    order(el) >= 0 &&
    !el.matches(":disabled") &&
    !el.closest("[inert]") &&
    (el.checkVisibility?.({ visibilityProperty: true }) ?? true) &&
    !passed(el);
  const enter = (edge) => {
    const found = controls(document, []).filter(tabbable);
    const sorted = [
      ...found.filter((el) => order(el) > 0).sort((a, b) => order(a) - order(b)),
      ...found.filter((el) => order(el) === 0),
    ];
    if (edge === "last") sorted.reverse();
    for (const el of sorted) {
      el.focus();
      const root = el.getRootNode();
      if (root.activeElement !== el) continue;
      if (el instanceof HTMLInputElement && TYPED.test(el.type)) el.select();
      return;
    }
    post(JSON.stringify({ type: "desk:surface-leave", next: edge !== "last" }));
  };
  Object.defineProperty(native, "onMessage", {
    value: (text) => {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return;
      }
      if (data?.type === "desk:surface-enter") {
        enter(data.edge);
        return;
      }
      const event = new MessageEvent("message", { data, origin: "desk-app://app" });
      Object.defineProperty(event, "source", { value: desk });
      globalThis.dispatchEvent(event);
    },
  });
})();
