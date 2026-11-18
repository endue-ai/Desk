// What web.read and web.act ask of a web view's page (ADR 0272, `web_page.rs`). The shell runs it
// in a world of its own in the page's main document, so the page's scripts neither see it nor
// change what it reads with, and calls `__deskPage(request)`. It answers `{ ok }` or
// `{ error: { code, message } }` (`moved`, `not_found`, `invalid`), never a thrown error.
//
// `read` writes the page as text in reading order and names what can be acted on: an element
// keeps its ref (`e12`) while it is in the page. The acts that take a person's input (a press,
// typed text, a key) are done by the shell; this finds where and makes the page ready.
globalThis.__deskPage = (request) => {
  // The refs the reads gave, kept in this world from one call to the next.
  globalThis.__deskPageState ??= { next: 1, refs: new Map(), names: new WeakMap() };
  const state = globalThis.__deskPageState;
  const fail = (code, message) => ({ error: { code, message } });

  /** The site of an address the web serves; none for a page of the view's own (blank, failed). */
  const site = (address) => {
    try {
      const url = new URL(address);
      return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
    } catch {
      return null;
    }
  };
  // The core allowed this call for the page at `request.at`: one of another site is left alone.
  const here = site(location.href);
  if (here !== null && here !== site(request.at))
    return fail("moved", "the page went to another site: read it again");

  const { squash, clip, whole, quoted, typeOf, kindOf, textOf } = globalThis.__deskPageText(state);

  /** Input types whose value is set whole, not typed. */
  const SET = new Set(["date", "time", "datetime-local", "month", "week", "color", "range"]);

  function resolve(ref) {
    const el = state.refs.get(ref)?.deref();
    if (el?.isConnected) return { el };
    return fail("not_found", `the page has no element ${ref} now: read it again`);
  }

  const whole_number = (n) => Math.max(0, Math.round(Number(n) || 0));
  function scrolled() {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      x: whole_number(root.scrollLeft),
      y: whole_number(root.scrollTop),
      width: whole_number(globalThis.innerWidth),
      height: whole_number(globalThis.innerHeight),
      pageWidth: whole_number(root.scrollWidth),
      pageHeight: whole_number(root.scrollHeight),
    };
  }

  function read() {
    for (const [ref, kept] of state.refs) if (!kept.deref()?.isConnected) state.refs.delete(ref);
    const all = Array.from(textOf(document.body ?? document.documentElement));
    const from = Math.min(whole_number(request.from), all.length);
    const most = Math.max(1, whole_number(request.max) || 20000);
    return {
      ok: {
        url: clip(location.href, 8192),
        title: clip(whole(squash(document.title)), 1024),
        text: all.slice(from, from + most).join(""),
        from,
        length: all.length,
        scroll: scrolled(),
      },
    };
  }

  /** What scrolls along `axis`: the page, or the largest part in view that does. */
  function scroller(axis) {
    const root = document.scrollingElement ?? document.documentElement;
    const can = (el) =>
      axis === "y" ? el.scrollHeight - el.clientHeight > 1 : el.scrollWidth - el.clientWidth > 1;
    if (can(root)) return root;
    let [best, most] = [root, 0];
    for (const el of document.querySelectorAll("*")) {
      if (!can(el)) continue;
      const style = getComputedStyle(el);
      const flow = axis === "y" ? style.overflowY : style.overflowX;
      if (flow !== "auto" && flow !== "scroll" && flow !== "overlay") continue;
      const box = el.getBoundingClientRect();
      const width = Math.min(box.right, globalThis.innerWidth) - Math.max(box.left, 0);
      const height = Math.min(box.bottom, globalThis.innerHeight) - Math.max(box.top, 0);
      if (width > 0 && height > 0 && width * height > most) [best, most] = [el, width * height];
    }
    return best;
  }

  function scroll() {
    const to = request.to;
    const axis = to === "left" || to === "right" ? "x" : "y";
    const el = scroller(axis);
    const before = [el.scrollLeft, el.scrollTop];
    const view = axis === "y" ? el.clientHeight : el.clientWidth;
    const pages = Number(request.pages) > 0 ? Number(request.pages) : 1;
    const step = Math.max(40, Math.round(view * 0.9 * pages));
    const now = { behavior: "instant" };
    if (to === "top") el.scrollTo({ top: 0, ...now });
    else if (to === "bottom") el.scrollTo({ top: el.scrollHeight, ...now });
    else if (to === "up") el.scrollBy({ top: -step, ...now });
    else if (to === "down") el.scrollBy({ top: step, ...now });
    else if (to === "left") el.scrollBy({ left: -step, ...now });
    else el.scrollBy({ left: step, ...now });
    return { ok: { moved: el.scrollLeft !== before[0] || el.scrollTop !== before[1] } };
  }

  function intoView(el) {
    if (typeof el.scrollIntoViewIfNeeded === "function") el.scrollIntoViewIfNeeded(true);
    else el.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
  }

  /** Where a press on `el` lands, and whether something else lies over it there. */
  function point(el) {
    intoView(el);
    const boxes = Array.from(el.getClientRects()).filter((b) => b.width > 0 && b.height > 0);
    const box = boxes[0] ?? el.getBoundingClientRect();
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
    const inside = x >= 0 && y >= 0 && x < globalThis.innerWidth && y < globalThis.innerHeight;
    const root = el.getRootNode();
    const hit = inside
      ? (root.elementFromPoint ?? document.elementFromPoint).call(root, x, y)
      : null;
    const its = hit && (hit === el || el.contains(hit) || hit.closest?.("label")?.control === el);
    return { ok: { x, y, covered: !its } };
  }

  /** The element the page has the keys on, through shadow roots. */
  function active() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  const typed = (el) =>
    el.localName === "textarea" ||
    el.isContentEditable ||
    (el.localName === "input" && kindOf(el) === "field" && typeOf(el) !== "file");

  /** Give `el` a value as its own setter would take it, and say so as input does. */
  function set(el, value) {
    const own = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    if (own?.set) own.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /** Make the page ready for typed text or a key: the keys on the element, its text selected. */
  function ready() {
    let el = active();
    if (request.ref) {
      const found = resolve(request.ref);
      if (found.error) return found;
      el = found.el;
    }
    const nowhere = !el || el === document.body || el === document.documentElement;
    if (!request.field) {
      if (request.ref) {
        intoView(el);
        el.focus();
      }
      return { ok: {} };
    }
    if (nowhere) return fail("invalid", "the page has the caret in no field: name one with ref");
    const what = request.ref ?? "the element with the caret";
    if (!typed(el)) return fail("invalid", `${what} is not a field text is typed into`);
    if (el.disabled || el.readOnly) return fail("invalid", `${what} cannot be changed`);
    intoView(el);
    el.focus();
    if (active() !== el) return fail("invalid", `${what} does not take the keys`);
    if (el.localName === "input" && SET.has(typeOf(el))) {
      set(el, request.text ?? "");
      return { ok: { done: true } };
    }
    const field = el.localName === "input" || el.localName === "textarea";
    if (request.replace) {
      if (field) el.select();
      else getSelection()?.selectAllChildren(el);
      if (request.text === "") document.execCommand("delete");
    } else if (field && request.ref) {
      // An input of a kind that has no caret to place keeps the one it has.
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch {}
    }
    return { ok: {} };
  }

  function choose() {
    const found = resolve(request.ref);
    if (found.error) return found;
    const el = found.el;
    if (el.localName !== "select")
      return fail("invalid", `${request.ref} is not a list of choices: press it instead`);
    if (el.disabled) return fail("invalid", `${request.ref} cannot be changed`);
    const want = squash(request.option).toLowerCase();
    const options = Array.from(el.options);
    const option =
      options.find((o) => squash(o.label).toLowerCase() === want) ??
      options.find((o) => o.value === request.option);
    if (!option) return fail("invalid", `${request.ref} has no option ${quoted(request.option)}`);
    if (option.disabled) return fail("invalid", `that option of ${request.ref} cannot be chosen`);
    if (el.multiple) option.selected = true;
    else el.value = option.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: {} };
  }

  /** `act` on the element `request.ref` names. */
  const on = (act) => {
    const found = resolve(request.ref);
    return found.error ? found : act(found.el);
  };

  try {
    switch (request.do) {
      case "read":
        return read();
      case "scroll":
        return scroll();
      case "show":
        return on((el) => {
          el.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
          return { ok: {} };
        });
      case "point":
        return on(point);
      case "click":
        return on((el) => {
          el.click();
          return { ok: {} };
        });
      case "ready":
        return ready();
      case "choose":
        return choose();
      default:
        return fail("invalid", `the page is asked nothing it knows (${request.do})`);
    }
  } catch (error) {
    return fail("invalid", `the page could not take it (${error?.message ?? error})`);
  }
};
