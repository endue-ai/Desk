// @vitest-environment jsdom
// Overlays one over another (ADR 0160, ADR 0190): one shown later is raised above the others and
// takes the page's focus, which gives its surface the keys; one with the focus that hides gives it
// to the overlay still shown in front, so a permission question answered over the palette leaves
// the keys with the palette. The places are the app's (`pages/remote.ts`).
import { afterEach, describe, expect, it } from "vitest";
import { remotePages } from "./pages/remote";
import { SurfaceHost } from "./surfaces";

const quiet = { post: () => {}, listen: () => () => {} };

function desk() {
  const container = document.createElement("div");
  document.body.append(container);
  const surfaces = new SurfaceHost(container, () => {}, undefined, remotePages(window, quiet));
  const overlay = (id: string) =>
    surfaces.open({
      id,
      title: id,
      placement: "overlay",
      hidden: true,
      src: `desk-plugin://main.${id}/`,
    });
  const palette = overlay("desk-palette");
  const question = overlay("endue-permissions");
  const field = document.createElement("input");
  container.append(field);
  const focused = () =>
    document.activeElement?.closest("[data-surface]")?.getAttribute("data-surface");
  return { surfaces, palette, question, field, focused };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("overlays one over another", () => {
  it("a question shown over the palette is in front with the focus", () => {
    const { surfaces, palette, question, focused } = desk();
    surfaces.show("desk-palette", true);
    surfaces.show("endue-permissions", true);
    expect(focused()).toBe("endue-permissions");
    expect(Number(question.style.zIndex)).toBeGreaterThan(Number(palette.style.zIndex));
  });

  it("the question answered, the palette still up has the focus again", () => {
    const { surfaces, focused } = desk();
    surfaces.show("desk-palette", true);
    surfaces.show("endue-permissions", true);
    surfaces.show("endue-permissions", false);
    expect(focused()).toBe("desk-palette");
  });

  it("the palette opened over a question and closed gives the question the focus back", () => {
    const { surfaces, focused } = desk();
    surfaces.show("endue-permissions", true);
    surfaces.show("desk-palette", true);
    expect(focused()).toBe("desk-palette");
    surfaces.show("desk-palette", false);
    expect(focused()).toBe("endue-permissions");
  });

  it("an overlay without the focus that hides takes it from nobody", () => {
    const { surfaces, field, focused } = desk();
    surfaces.show("desk-palette", true);
    surfaces.show("endue-permissions", true);
    field.focus();
    surfaces.show("endue-permissions", false);
    expect(document.activeElement).toBe(field);
    surfaces.show("desk-palette", false);
    expect(document.activeElement).toBe(field);
    expect(focused()).toBeUndefined();
  });

  it("the last overlay that hides leaves the focus to the desk", () => {
    const { surfaces, palette } = desk();
    surfaces.show("endue-permissions", true);
    surfaces.show("endue-permissions", false);
    expect(palette.hidden).toBe(true);
    expect(palette.contains(document.activeElement)).toBe(false);
  });
});
