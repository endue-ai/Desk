import { describe, expect, it } from "vitest";
import { windowTransport } from "./protocol";

class FakeFace {
  constructor(
    readonly family: string,
    readonly source: string,
  ) {}
  load() {
    return Promise.resolve(this);
  }
}

describe("a plugin frame", () => {
  it("loads the desk theme's fonts as FontFace and drops the last theme's", () => {
    const faces = new Set<FakeFace>();
    const style = new Map<string, string>();
    const dataset: Record<string, string> = {};
    const win = {
      FontFace: FakeFace,
      document: {
        fonts: { add: (f: FakeFace) => faces.add(f), delete: (f: FakeFace) => faces.delete(f) },
        documentElement: {
          dataset,
          style: {
            setProperty: (name: string, value: string) => style.set(name, value),
            removeProperty: (name: string) => style.delete(name),
          },
        },
      },
    } as unknown as Window;
    const transport = windowTransport(win);
    const theme = {
      scheme: "dark" as const,
      contrast: "normal" as const,
      reducedMotion: false,
      variables: { "--desk-font-sans": '"Ember Sans", sans-serif' },
    };
    transport.theme?.({
      ...theme,
      fonts: [{ family: "Ember Sans", url: "/example.ember/fonts/e.woff2" }],
    });
    expect([...faces].map((f) => [f.family, f.source])).toEqual([
      ["Ember Sans", 'url("/example.ember/fonts/e.woff2")'],
    ]);
    expect(style.get("--desk-font-sans")).toBe('"Ember Sans", sans-serif');
    transport.theme?.(theme);
    expect(faces.size).toBe(0);
  });
});
