import { describe, expect, it } from "vitest";
import { kindOf, proposalOf } from "./talk";

describe("the talk line's words for profiles and key bindings", () => {
  it("make, build or /make with a profile in it goes to the profile kind", () => {
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
  });

  it("bind … to … goes to key bindings", () => {
    expect(proposalOf("bind Mod+Shift+T to open the terminal")).toEqual({
      kind: "keys",
      text: "bind Mod+Shift+T to open the terminal",
    });
    expect(proposalOf("/make bind Control+1 to the first desktop")).toEqual({
      kind: "keys",
      text: "bind Control+1 to the first desktop",
    });
  });

  it("the rest is as before: views, or a conversation", () => {
    expect(proposalOf("show me my profile")).toEqual({ kind: "view", text: "show me my profile" });
    expect(proposalOf("make a board of my tasks")).toEqual({
      kind: "view",
      text: "make a board of my tasks",
    });
    for (const kept of ["bind it", "what does bind mean to you?", "my profile is quiet", "binder"])
      expect(proposalOf(kept), kept).toBeNull();
    expect(kindOf("a quiet night profile")).toBe("profile");
    expect(kindOf("bind Mod+K to the palette")).toBe("keys");
    expect(kindOf("my events this week as a board")).toBe("view");
  });
});
