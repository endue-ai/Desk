import { describe, expect, it } from "vitest";
import { MIC, SAY, SOURCES_NOTE } from "../ui/script.js";

describe("what Eris says", () => {
  // #161 finding 19: "Morning, Dana." at 13:40.
  it("greets a returning person by the hour", () => {
    expect(SAY.welcome(5, "Ada")).toBe("Morning, Ada.");
    expect(SAY.welcome(11, "Ada")).toBe("Morning, Ada.");
    expect(SAY.welcome(12, "Ada")).toBe("Afternoon, Ada.");
    expect(SAY.welcome(13, "Ada")).toBe("Afternoon, Ada.");
    expect(SAY.welcome(18, "Ada")).toBe("Evening, Ada.");
    expect(SAY.welcome(4, null)).toBe("Evening.");
  });

  // #161 finding 9: she asks, and the person answers.
  it("puts the microphone question to the person in words", () => {
    expect(MIC).toEqual({
      allow: "Use my microphone",
      notNow: "Not now",
      waiting: "Waiting for your approval",
    });
  });

  it("tells the person the cards bring sample data, without a developer's words", () => {
    expect(SOURCES_NOTE).toBe("For now, each card brings in sample data.");
    expect(SOURCES_NOTE).not.toMatch(/connector|picker/i);
  });
});
