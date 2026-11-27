// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CUSTOM_STYLE_ID, customApplier, pageOutline } from "./custom";

/** A window over jsdom's document whose reload is counted, not done. */
function page() {
  document.head.innerHTML = '<style id="page">p { color: red }</style>';
  document.body.innerHTML = "<p>hello</p>";
  const reload = vi.fn();
  const win = { document, location: { reload } } as unknown as Window;
  return { win, reload };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

describe("the person's changes to a plugin page (ADR 0398)", () => {
  it("puts the style last in the head, replaces it, and removes it when it is cleared", () => {
    const { win } = page();
    const apply = customApplier(win, Promise.resolve());
    apply({ css: "p { color: blue }" });
    expect(document.head.lastElementChild?.id).toBe(CUSTOM_STYLE_ID);
    expect(document.getElementById(CUSTOM_STYLE_ID)?.textContent).toBe("p { color: blue }");
    apply({ css: "p { color: green }" });
    expect(document.querySelectorAll(`#${CUSTOM_STYLE_ID}`)).toHaveLength(1);
    expect(document.getElementById(CUSTOM_STYLE_ID)?.textContent).toBe("p { color: green }");
    apply({});
    expect(document.getElementById(CUSTOM_STYLE_ID)).toBeNull();
  });

  it("runs the script once, after the plugin mounted, in a scope of its own", async () => {
    const { win, reload } = page();
    let mount: () => void = () => {};
    const apply = customApplier(win, new Promise<void>((done) => (mount = done)));
    apply({ js: "const p = document.querySelector('p'); p.textContent = 'changed';" });
    await tick();
    expect(document.querySelector("p")?.textContent).toBe("hello");
    mount();
    await tick();
    expect(document.querySelector("script[data-desk-custom]")?.textContent).toContain(
      "p.textContent = 'changed'",
    );
    apply({ js: "const p = document.querySelector('p'); p.textContent = 'changed';", css: "" });
    expect(document.querySelectorAll("script[data-desk-custom]")).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the page for a changed or removed script instead of running a second one", async () => {
    const { win, reload } = page();
    const apply = customApplier(win, Promise.resolve());
    apply({ js: "window.first = 1;" });
    await tick();
    apply({ js: "window.second = 2;" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("script[data-desk-custom]")).toHaveLength(1);
    const other = page();
    const later = customApplier(other.win, Promise.resolve());
    later({ js: "window.first = 1;" });
    await tick();
    later({});
    expect(other.reload).toHaveBeenCalledTimes(1);
  });

  it("runs nothing and reloads nothing for a page that never had a script", () => {
    const { win, reload } = page();
    const apply = customApplier(win, Promise.resolve());
    apply({ css: "p { margin: 0 }" });
    apply({});
    expect(reload).not.toHaveBeenCalled();
    expect(document.querySelector("script[data-desk-custom]")).toBeNull();
  });
});

describe("a page's outline for the person's style (ADR 0398)", () => {
  it("lists elements by tag, id, class and role, with no text, scripts or styles", () => {
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<main id="app" class="notes wide"><nav role="toolbar"><button class="desk-btn">Save</button></nav>' +
      "<p>private words</p><script>x()</script><style>p{}</style></main>";
    const outline = pageOutline(document);
    expect(outline).toBe(
      [
        "body",
        "  main#app.notes.wide",
        "    nav [role=toolbar]",
        "      button.desk-btn",
        "    p",
      ].join("\n"),
    );
    expect(outline).not.toContain("private");
  });
});
