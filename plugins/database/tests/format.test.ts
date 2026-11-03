import { describe, expect, it, vi } from "vitest";

import { formatCount, formatDuration } from "../ui/format.js";

describe("database number formatting", () => {
  it("formats counts in the person's locale", () => {
    const format = vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function () {
      return new Intl.NumberFormat("en-US").format(Number(this));
    });
    try {
      expect(formatCount(12345678)).toBe("12,345,678");
    } finally {
      format.mockRestore();
    }
  });

  it("formats longer durations in seconds and minutes", () => {
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(184233)).toBe("3 min 4 s");
  });
});
