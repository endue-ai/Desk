import { describe, expect, it } from "vitest";
import { kindOf, proposalOf } from "./talk";

describe("the kind a sentence asks for", () => {
  it("make, build or /make with a profile in it is a profile", () => {
    expect(proposalOf("make a quiet night profile with only notes and terminal")).toEqual({
      kind: "profile",
      text: "make a quiet night profile with only notes and terminal",
    });
    expect(proposalOf("Build me a Profile for presenting")).toEqual({
      kind: "profile",
      text: "Build me a Profile for presenting",
    });
    expect(proposalOf("/make a reading profile")).toEqual({
      kind: "profile",
      text: "a reading profile",
    });
    expect(kindOf("make two profiles, one for work and one for the evening")).toBe("profile");
  });

  it("bind … to …, and shortcuts or key bindings, are key bindings", () => {
    expect(proposalOf("bind Mod+Shift+T to open the terminal")).toEqual({
      kind: "keys",
      text: "bind Mod+Shift+T to open the terminal",
    });
    expect(proposalOf("/make bind Control+1 to the first desktop")).toEqual({
      kind: "keys",
      text: "bind Control+1 to the first desktop",
    });
    expect(proposalOf("make Mod+Shift+T a shortcut for the terminal")).toEqual({
      kind: "keys",
      text: "make Mod+Shift+T a shortcut for the terminal",
    });
    expect(kindOf("make key bindings for the four desktops")).toBe("keys");
  });

  it("the rest are views, a sentence that shows a profile or shortcuts included", () => {
    expect(proposalOf("show me my profile")).toEqual({ kind: "view", text: "show me my profile" });
    expect(kindOf("show me my shortcuts")).toBe("view");
    expect(proposalOf("make a board of my tasks")).toEqual({
      kind: "view",
      text: "make a board of my tasks",
    });
    expect(kindOf("my events this week as a board")).toBe("view");
  });
});
