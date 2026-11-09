// The account's language and time-zone choices, as endue.ai's General settings offer them.
import { describe, expect, it } from "vitest";
import { languageChoices, offsetOf, zoneChoices } from "./account-choices";

describe("account choices", () => {
  it("offers endue.ai's languages, and Korean only to an account already in it", () => {
    const values = (current?: string) => languageChoices(current).map((c) => c.value);
    expect(values()).toEqual(["en-US", "ja-JP", "de-DE", "fr-FR"]);
    expect(values("fr-FR")).toEqual(["en-US", "ja-JP", "de-DE", "fr-FR"]);
    expect(languageChoices("ko-KR").at(-1)).toEqual({ value: "ko-KR", label: "한국어" });
    expect(languageChoices("es-ES").at(-1)).toEqual({ value: "es-ES", label: "es-ES" });
  });

  it("labels time zones with today's offset and keeps the saved and the computer's", () => {
    const now = new Date("2026-07-01T12:00:00Z");
    expect(offsetOf("Asia/Seoul", now)).toBe("UTC+9");
    expect(offsetOf("America/New_York", now)).toBe("UTC-4");
    expect(offsetOf("Asia/Kolkata", now)).toBe("UTC+5:30");
    expect(offsetOf("Not/AZone", now)).toBeUndefined();
    const choices = zoneChoices("Asia/Kolkata", "Europe/Berlin", now);
    expect(choices.map((c) => c.value)).toEqual([
      "Asia/Seoul",
      "Asia/Tokyo",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "UTC",
      "Asia/Kolkata",
      "Europe/Berlin",
    ]);
    expect(choices.find((c) => c.value === "UTC")?.label).toBe("UTC");
    expect(choices.find((c) => c.value === "Europe/Berlin")?.label).toBe("Europe/Berlin (UTC+2)");
  });
});
