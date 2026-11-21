// @vitest-environment jsdom
// The ER diagram as an image (PG-55, ui/features/diagram/{svg,export}.js): the SVG holds the diagram
// alone (every shown table named, the theme's colours as values, nothing of the panel); Export asks
// for a place through dialog.save and writes SVG as text and PNG at 1x and 2x as base64 there, asks
// perm.request once when the write is refused and writes nothing when cancelled; Copy as image puts
// a PNG on the clipboard or says it could not; and the page's imager resolves a token to a value.
import { afterEach, describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { createImager, fittingScale } from "../ui/features/diagram/image.js";
import { type Imager, provideImager } from "../ui/features/diagram/imager.js";
import type { DiagramState } from "../ui/features/diagram/read.js";
import { documentOf, type Palette } from "../ui/features/diagram/svg.js";
import { DIAGRAM_CONNECTION, storeCatalog } from "./diagram-fixture";
import { type Mounted, mount } from "./harness";
import { catalogScript } from "./pg-catalog";

const PALETTE: Palette = {
  background: "#101014",
  card: "#1c1c22",
  border: "#33333d",
  head: "#26262e",
  text: "#f4f4f6",
  key: "#8ab4ff",
  muted: "#9a9aa6",
  line: "#9a9aa6",
  font: '"Fixture Mono", monospace',
  size: "12px",
};

function fakeImager(copies: string[], copied = true): Imager {
  return {
    palette: () => PALETTE,
    png: async (_svg, width, height, scale) => ({
      base64: btoa(`png ${width}x${height} at ${scale}`),
      scale,
    }),
    copy: async (base64) => {
      copies.push(atob(base64));
      return copied;
    },
  };
}

async function exporting(answers: { cancelled?: boolean; refuse?: boolean } = {}) {
  const writes: Array<{ path: string; content: string; encoding: string }> = [];
  const asked: unknown[] = [];
  let refused = answers.refuse ?? false;
  const m = await mount({
    store: { connections: [DIAGRAM_CONNECTION] },
    script: catalogScript(() => storeCatalog()),
    handlers: {
      "dialog.save": ({ suggestedName }) =>
        answers.cancelled
          ? { cancelled: true }
          : { cancelled: false, path: `~/Pictures/${suggestedName}` },
      "fs.write": (params) => {
        if (refused) {
          refused = false;
          throw new StubError("permission_denied", "not granted");
        }
        writes.push(params as never);
        return { bytesWritten: params.content.length };
      },
      "perm.request": (params) => {
        asked.push(params);
        return { granted: true };
      },
    },
  });
  await m.host.command("endue.database.er-diagram", { connection: "depot", schema: "public" });
  return { m, writes, asked };
}
const shownState = (m: Mounted) => m.shown()?.diagram as DiagramState;

afterEach(() => provideImager(undefined));

describe("the diagram as an image", () => {
  it("exports the diagram alone", async () => {
    const copies: string[] = [];
    provideImager(fakeImager(copies));
    const { m, writes, asked } = await exporting({ refuse: true });
    const svg = await m.host.command("endue.database.er-export", { format: "svg" });
    expect(svg).toEqual({ path: "~/Pictures/er-depot-public.svg", format: "svg", scale: 1 });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      permission: { permission: "fs:write", paths: ["~/Pictures/er-depot-public.svg"] },
    });
    const written = writes[0];
    expect(written?.encoding).toBe("utf8");
    const doc = new DOMParser().parseFromString(written?.content ?? "", "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const names = [...doc.querySelectorAll(".er-name")].map((t) => t.textContent).sort();
    expect(names).toEqual(
      shownState(m)
        .layout.boxes.map((b) => b.label)
        .sort(),
    );
    expect(names).toHaveLength(7);
    const text = written?.content ?? "";
    expect(text).not.toContain("var(");
    expect(text).toContain("#1c1c22");
    expect(text).toContain("Fixture Mono");
    for (const panel of ["tabindex", "role=", "data-b", "Auto layout", "er-map", "aria-"])
      expect(text, panel).not.toContain(panel);
    expect(doc.documentElement.getAttribute("width")).toMatch(/^\d+$/u);

    await m.host.command("endue.database.er-export", { format: "png" });
    await m.host.command("endue.database.er-export", { format: "png2x" });
    expect(
      writes.slice(1).map((w) => [w.path, w.encoding, atob(w.content).replace(/\d+x\d+/u, "W×H")]),
    ).toEqual([
      ["~/Pictures/er-depot-public.png", "base64", "png W×H at 1"],
      ["~/Pictures/er-depot-public.png", "base64", "png W×H at 2"],
    ]);
    expect(asked).toHaveLength(1);
    expect(m.view.said.at(-1)).toBe(
      "Exported the diagram as PNG at 2x to ~/Pictures/er-depot-public.png.",
    );

    await m.host.command("endue.database.er-copy-image");
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^png \d+x\d+ at 1$/u);
    expect(m.view.said.at(-1)).toBe("Copied the diagram as an image.");
    provideImager(fakeImager(copies, false));
    await m.host.command("endue.database.er-copy-image");
    expect(m.view.said.at(-1)).toMatch(/^Could not copy the diagram/u);
  });

  it("writes nothing when the save dialog is cancelled, and names drawn relations in the export", async () => {
    provideImager(fakeImager([]));
    const { m, writes } = await exporting({ cancelled: true });
    await m.host.command("endue.database.er-export", { format: "svg" }).catch(() => undefined);
    expect(writes).toEqual([]);
    await m.host.command("endue.database.er-relation", {
      from: "audit",
      to: "customers",
      columns: "actor",
    });
    const text = documentOf(shownState(m).layout, PALETTE, "fixture");
    expect(text).toContain("audit (actor) → customers (id) · not in the database");
    expect(text).toContain("Dashed: not in the database");
  });

  it("resolves the theme's tokens in the page and fits a PNG in a canvas", () => {
    document.documentElement.style.setProperty("--desk-card", "rgb(1, 2, 3)");
    const palette = createImager(document).palette();
    expect(palette.card).not.toContain("var(");
    expect(palette.card).toMatch(/^(#[0-9a-f]{6,8}|rgb\(1, 2, 3\))$/u);
    expect(document.querySelector(".er-probe")).toBeNull();
    expect(fittingScale(1000, 1000, 2)).toBe(2);
    expect(fittingScale(20_000, 1000, 2)).toBeLessThan(1);
  });
});
