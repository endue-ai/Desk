// How web.read writes a web view's page (ADR 0272, `web_page.js`, `web_page.rs`): its text in
// reading order, one block a line, a heading after #, a list item after -, and every element
// that can be acted on as `[e12 link "Sign in"]`: a field with what it holds (never a
// password), a box or a choice with its state. What the page hides is left out, a frame is
// named, not read, and a bracket of the page's own is written wide (［ ］). An element keeps its
// ref while it is in the page (`state`).
globalThis.__deskPageText = (state) => {
  const squash = (text) =>
    String(text ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const clip = (text, most) => {
    const chars = Array.from(text);
    return chars.length > most ? `${chars.slice(0, most - 1).join("")}…` : text;
  };
  const whole = (text) => (typeof text.toWellFormed === "function" ? text.toWellFormed() : text);
  // What stands in [ ] is an element this named, never the page's own words: a page's brackets
  // are written wide, so its text cannot pass for an element or give one another's name.
  const plain = (text) => text.replaceAll("[", "［").replaceAll("]", "］");
  const quoted = (text, most = 160) => `"${plain(clip(squash(text), most)).replaceAll('"', "'")}"`;

  const ROLES = {
    button: "button",
    link: "link",
    checkbox: "checkbox",
    switch: "checkbox",
    radio: "radio",
    tab: "tab",
    textbox: "field",
    searchbox: "field",
    spinbutton: "field",
    combobox: "item",
    menuitem: "item",
    menuitemcheckbox: "item",
    menuitemradio: "item",
    option: "item",
    treeitem: "item",
  };
  const PRESSED = new Set(["button", "submit", "reset", "image"]);
  /** What is acted on by itself, wherever it lies: a box holding one is read through. */
  const ACTED = [
    "a[href],button,input,select,textarea,summary,[onclick],[contenteditable]",
    '[tabindex]:not([tabindex^="-"])',
    ...Object.keys(ROLES).map((role) => `[role="${role}"]`),
  ].join(",");

  const typeOf = (el) => (el.getAttribute("type") || "text").toLowerCase();

  /** What kind of thing to act on `el` is, or null when it is none. */
  function kindOf(el) {
    const tag = el.localName;
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "select";
    if (tag === "textarea") return "field";
    if (tag === "input") {
      const type = typeOf(el);
      if (type === "hidden") return null;
      if (type === "checkbox" || type === "radio") return type;
      return PRESSED.has(type) ? "button" : "field";
    }
    const role = ROLES[el.getAttribute("role")];
    if (role) return role;
    if (el.isContentEditable && !el.parentElement?.isContentEditable) return "field";
    if (el.hasAttribute("onclick")) return "item";
    return el.hasAttribute("tabindex") && el.tabIndex >= 0 ? "item" : null;
  }

  /** Whether a role's or an attribute's element is one thing to act on, not a box of others. */
  const leaf = (el) => !el.querySelector(ACTED) && Array.from(squash(el.textContent)).length <= 300;

  /** The words an element shows, as they are laid out: parts side by side stay apart. */
  const wordsOf = (el) => squash(el?.innerText ?? el?.textContent);

  function refOf(el) {
    let ref = state.names.get(el);
    if (!ref) {
      ref = `e${state.next++}`;
      state.names.set(el, ref);
      state.refs.set(ref, new WeakRef(el));
    }
    return ref;
  }

  const shown = (el) => {
    if (el.getAttribute("aria-hidden") === "true" || el.hidden) return false;
    return typeof el.checkVisibility === "function"
      ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
      : true;
  };

  function labelled(el) {
    const said = el.getAttribute("aria-label");
    if (said) return said;
    const ids = el.getAttribute("aria-labelledby");
    if (!ids) return "";
    const root = el.getRootNode();
    const parts = ids.split(/\s+/).map((id) => wordsOf(root.getElementById?.(id)));
    return squash(parts.join(" "));
  }

  function nameOf(el, kind) {
    const said = labelled(el);
    if (said) return said;
    if (kind === "checkbox" || kind === "radio") return el.getAttribute("title") ?? "";
    if (kind === "field" || kind === "select") {
      const label = wordsOf(el.labels?.[0]);
      return label || el.getAttribute("placeholder") || el.getAttribute("title") || el.name || "";
    }
    const words = wordsOf(el);
    if (words) return words;
    const picture = el.querySelector?.("img[alt]")?.getAttribute("alt");
    return picture || el.getAttribute("title") || el.value || "";
  }

  /** `[e12 link "Sign in"]`: an element to act on, as the text names it. */
  function marker(el, kind) {
    const parts = [refOf(el), kind];
    const name = nameOf(el, kind);
    if (name) parts.push(quoted(name));
    if (kind === "checkbox" || kind === "radio") {
      const on = "checked" in el ? el.checked : el.getAttribute("aria-checked") === "true";
      parts.push(on ? "on" : "off");
    } else if (kind === "select") {
      const options = Array.from(el.options ?? []);
      parts.push(`= ${quoted(el.selectedOptions?.[0]?.label ?? "", 80)}`);
      const most = options.slice(0, 20).map((o) => quoted(o.label, 80));
      if (options.length > 20) most.push("…");
      if (most.length > 0) parts.push(`of ${most.join(", ")}`);
    } else if (kind === "field") {
      if (el.localName === "input" && typeOf(el) === "password") parts.push("= (hidden)");
      else if (el.localName === "input" && typeOf(el) === "file") parts.push("file");
      else parts.push(`= ${quoted("value" in el ? el.value : el.textContent, 200)}`);
    }
    const expanded = el.getAttribute("aria-expanded");
    if (expanded !== null) parts.push(expanded === "true" ? "open" : "closed");
    if (el.getAttribute("aria-selected") === "true") parts.push("selected");
    if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("disabled");
    return `[${parts.join(" ")}]`;
  }

  const LEFT_OUT = new Set(
    "script style noscript template head meta link title svg canvas object embed map datalist".split(
      " ",
    ),
  );
  const BLOCKS = new Set(
    (
      "address article aside blockquote body br dd details dialog div dl dt fieldset figcaption " +
      "figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tr ul"
    ).split(" "),
  );
  /** The most the text holds, in characters, and the most elements looked at. */
  const MOST = { chars: 400000, elements: 60000 };

  /** The page's text in reading order, with what can be acted on named. */
  function textOf(root) {
    const lines = [""];
    let [chars, elements, pre] = [0, 0, 0];
    const add = (text) => {
      lines[lines.length - 1] += text;
      chars += text.length;
    };
    const line = () => {
      if (lines[lines.length - 1].trim() !== "") lines.push("");
      else lines[lines.length - 1] = "";
    };
    const each = (nodes, pressed) => {
      for (const node of nodes) walk(node, pressed);
    };
    // `pressed`: an element above shows the pointer a hand, so this one is part of what it is.
    function walk(node, pressed) {
      if (chars > MOST.chars || elements > MOST.elements) return;
      if (node.nodeType === 3) {
        const text = plain(node.nodeValue ?? "");
        if (pre > 0) {
          const [first, ...rest] = text.split("\n");
          add(first);
          for (const more of rest) {
            lines.push("");
            add(more);
          }
        } else if (/\S/.test(text)) add(text.replace(/\s+/g, " "));
        else if (text !== "") add(" ");
        return;
      }
      if (node.nodeType !== 1) return;
      elements += 1;
      const tag = node.localName;
      if (LEFT_OUT.has(tag) || !shown(node)) return;
      // A page's own scripts make many things pressable without saying so: what shows the
      // pointer a hand, and no element above it does, is taken for one.
      const hand = getComputedStyle(node).cursor === "pointer";
      const kind = kindOf(node) ?? (hand && !pressed ? "item" : null);
      const block = BLOCKS.has(tag);
      if (kind && (node.matches("a[href],button,input,select,textarea,summary") || leaf(node))) {
        if (block) line();
        add(` ${marker(node, kind)} `);
        if (block) line();
        return;
      }
      if (tag === "img") {
        const alt = squash(node.getAttribute("alt"));
        if (alt) add(` (image ${quoted(alt, 120)}) `);
        return;
      }
      if (tag === "iframe" || tag === "frame") {
        add(` (frame ${quoted(node.getAttribute("title") || node.getAttribute("src") || "")}) `);
        return;
      }
      if (tag === "video" || tag === "audio") {
        add(` (${tag}) `);
        return;
      }
      if (block) line();
      if (/^h[1-6]$/.test(tag)) add(`${"#".repeat(Number(tag[1]))} `);
      else if (tag === "li") add("- ");
      else if ((tag === "td" || tag === "th") && node.previousElementSibling) add(" | ");
      if (tag === "pre") pre += 1;
      if (tag === "slot" && typeof node.assignedNodes === "function") {
        const given = node.assignedNodes({ flatten: true });
        each(given.length > 0 ? given : node.childNodes, pressed || hand);
      } else each((node.shadowRoot ?? node).childNodes, pressed || hand);
      if (tag === "pre") pre -= 1;
      if (block) line();
    }
    walk(root, false);
    const kept = lines.map((l) => l.replace(/ {2,}/g, " ").trim()).filter((l) => l !== "");
    return whole(kept.join("\n"));
  }
  return { squash, clip, whole, quoted, typeOf, kindOf, textOf };
};
