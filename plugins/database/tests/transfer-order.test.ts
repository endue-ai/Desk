// The order several tables are copied in (PG-63): a referenced table first, a self reference and a
// table outside the copy needing nothing, a cycle still giving every table once.
import { describe, expect, it } from "vitest";
import { foreignKeyOrder } from "../ui/transfer/order.js";

describe("the order of a copy of several tables", () => {
  it("orders tables so a referenced table comes first", () => {
    expect(
      foreignKeyOrder([
        { key: "lines", needs: ["orders", "products"] },
        { key: "orders", needs: ["customers"] },
        { key: "products", needs: [] },
        { key: "customers", needs: ["regions"] },
      ]),
    ).toEqual(["products", "customers", "orders", "lines"]);
  });

  it("a self reference and a table outside the copy need nothing; a cycle keeps every table once", () => {
    expect(foreignKeyOrder([{ key: "tree", needs: ["tree", "elsewhere"] }])).toEqual(["tree"]);
    const cycle = foreignKeyOrder([
      { key: "a", needs: ["b"] },
      { key: "b", needs: ["a"] },
      { key: "c", needs: ["a"] },
    ]);
    expect(cycle).toEqual(["a", "b", "c"]);
  });
});
