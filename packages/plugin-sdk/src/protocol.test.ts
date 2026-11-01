import { describe, expect, it } from "vitest";
import { type ThemeState, windowTransport } from "./protocol";

const theme = (variables: Record<string, string>): ThemeState => ({
  scheme: "dark",
  contrast: "normal",
  reducedMotion: false,
  variables,
});

describe("a frame's replaceable theme", () => {
  it("removes only previously applied Desk variables absent from the replacement", () => {
    const properties = new Map([
      ["padding", "4px"],
      ["--plugin-local", "10px"],
      ["--desk-local", "12px"],
    ]);
    const root = {
      dataset: {},
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
      },
    };
    const transport = windowTransport({ document: { documentElement: root } } as unknown as Window);
    transport.theme?.(theme({ "--desk-background": "#111111", "--desk-custom": "#abcdef" }));
    transport.theme?.(theme({ "--desk-background": "#ffffff" }));
    expect(Object.fromEntries(properties)).toEqual({
      padding: "4px",
      "--plugin-local": "10px",
      "--desk-local": "12px",
      "--desk-background": "#ffffff",
    });
    transport.theme?.(theme({}));
    expect(properties.has("--desk-background")).toBe(false);
    expect(properties.get("--desk-local")).toBe("12px");
  });
});
