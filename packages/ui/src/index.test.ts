import { describe, expect, it } from "vitest";
import { NAME } from "./index";

describe("@endue-ai/ui", () => {
  it("exports its package name", () => {
    expect(NAME).toBe("@endue-ai/ui");
  });
});
