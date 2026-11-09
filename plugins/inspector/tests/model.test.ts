import { describe, expect, it } from "vitest";
import { tableOf } from "../ui/model.js";

const window_ = (id: string, visible: boolean, asleep: boolean) => ({
  id,
  plugin: id,
  placement: "window",
  visible,
  focused: id === "endue.notes",
  asleep,
});

describe("the surfaces section", () => {
  it("says how many frames are live, out of sight against the budget and asleep, and marks the sleeping windows", () => {
    const table = tableOf("surfaces", {
      surfaces: [
        window_("endue.notes", true, false),
        window_("endue.sheets", false, true),
        window_("endue.files", false, false),
      ],
      views: [],
      buffers: [],
      frames: { live: 2, hidden: 1, asleep: 1, budget: 8 },
    });
    expect(table.summary).toBe(
      "3 surfaces, 2 live frames (1 of 8 out of sight, 1 asleep), 0 views, 0 buffers",
    );
    expect(table.groups[0]?.rows.map((row) => row[3])).toEqual([
      "visible · focused",
      "hidden · asleep",
      "hidden",
    ]);
  });

  it("leaves the count out when the runtime does not give one", () => {
    const table = tableOf("surfaces", {
      surfaces: [window_("endue.notes", true, false)],
      views: [],
      buffers: [],
    });
    expect(table.summary).toBe("1 surface, 0 views, 0 buffers");
  });
});
