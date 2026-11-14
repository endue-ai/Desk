import { describe, expect, it } from "vitest";
import { described, ofBundle } from "./bundle-processes.ts";

const APP = "/w/a/target/bundle-motion/endue-desk.app";
const PS = [
  `  501     1 ${APP}/Contents/MacOS/endue-desk`,
  `  612   501 ${APP}/Contents/Frameworks/endue-desk Helper (Renderer).app/Contents/MacOS/endue-desk Helper (Renderer) --type=renderer`,
  `  700   680 /w/b/target/bundle-motion/endue-desk.app/Contents/MacOS/endue-desk`,
  `  701   680 /Users/me/Desk/target/bundle/endue-desk.app/Contents/MacOS/endue-desk`,
  `  702   690 grep ${APP}/Contents/MacOS`,
  "",
].join("\n");

describe("ofBundle", () => {
  it("finds the bundle's desks and helpers, reparented to launchd or not", () => {
    expect(ofBundle(PS, APP).map((p) => [p.pid, p.ppid])).toEqual([
      [501, 1],
      [612, 501],
    ]);
    expect(ofBundle(PS, `${APP}/`).length).toBe(2);
  });

  it("leaves another worktree's bundle, the person's desk and a command that only names it", () => {
    expect(ofBundle(PS, APP).some((p) => p.pid >= 700)).toBe(false);
  });

  it("finds nothing in an empty listing", () => {
    expect(ofBundle("", APP)).toEqual([]);
  });
});

describe("described", () => {
  it("names each process by pid, parent and its command from the bundle on", () => {
    const [desk] = ofBundle(PS, APP);
    expect(described(desk ? [desk] : [], APP)).toBe("501 (parent 1) Contents/MacOS/endue-desk");
  });
});
