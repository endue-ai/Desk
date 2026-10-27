import { describe, expect, it } from "vitest";
import { NAME } from "./index";

describe("@endue-ai/create-plugin", () => {
  it("exports its package name", () => {
    expect(NAME).toBe("@endue-ai/create-plugin");
  });
});
