import { describe, expect, it } from "vitest";
import { NAME } from "./index";

describe("@endue-ai/bridge", () => {
  it("exports its package name", () => {
    expect(NAME).toBe("@endue-ai/bridge");
  });
});
