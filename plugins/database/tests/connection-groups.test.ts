// Connections in groups and colours (item 8 of #540): the fields kept and checked, the explorer's
// group rows that open and close, and a connection's colour on its row.
import { describe, expect, it } from "vitest";
import { normalize } from "../ui/connections.js";
import { createExplorer } from "../ui/explorer.js";

const conn = (name: string, group = "", color = "") =>
  normalize({ engine: "sqlite", file: `/d/${name}.db`, id: `c-${name}`, name, group, color });

describe("connection groups and colours", () => {
  it("keeps a group and one of the theme's colours, and refuses another colour", () => {
    expect(conn("a", " Shop ", "chart-3")).toMatchObject({ group: "Shop", color: "chart-3" });
    expect(normalize({ engine: "sqlite", file: "/d/x.db", id: "c-x" })).toMatchObject({
      group: "",
      color: "",
    });
    expect(() => conn("b", "", "#ff0000")).toThrow(/Colour/u);
    expect(() => conn("c", "x".repeat(41))).toThrow(/Group: at most 40/u);
  });

  it("lists connections without a group first, then each group, which opens and closes", () => {
    const list = [
      conn("b", "Shop", "chart-2"),
      conn("a"),
      conn("c", "Analytics"),
      conn("d", "Shop"),
    ];
    const catalog = { schemas: async () => [], forget: () => {} } as never;
    const explorer = createExplorer(
      catalog,
      () => list,
      () => {},
    );
    const rows = () => explorer.rows().map((r) => `${r.kind}:${r.label}`);
    expect(rows()).toEqual([
      "connection:a",
      "group:Analytics",
      "connection:c",
      "group:Shop",
      "connection:b",
      "connection:d",
    ]);
    expect(explorer.rows().find((r) => r.label === "b")?.color).toBe("chart-2");
    const shop = explorer.rows().find((r) => r.kind === "group" && r.label === "Shop");
    if (!shop) throw new Error("no group row");
    explorer.toggle(shop, undefined);
    expect(rows()).toEqual(["connection:a", "group:Analytics", "connection:c", "group:Shop"]);
    expect(explorer.rows().at(-1)).toMatchObject({ expanded: false, detail: "2" });
    explorer.toggle(shop, true);
    expect(rows()).toHaveLength(6);
  });
});
