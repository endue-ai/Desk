import { describe, expect, it } from "vitest";
import { routeOf } from "./route";

const to = (text: string, proposing = true) => routeOf(text, proposing).to;

describe("the talk line's routes", () => {
  it("sends a look request to the theme studio, even one that starts with make", () => {
    for (const text of [
      "make it feel like warm paper",
      "Make the theme darker and calmer",
      "make the desk feel like a rainy café",
      "make the theme feel like a calm board",
      "I want a theme that feels like the ocean at night",
      "테마를 따뜻한 종이 느낌으로",
    ])
      expect(to(text), text).toBe("look");
  });

  it("sends make, build, show me and /make sentences to desk.propose, a look word or not", () => {
    for (const text of [
      "/make show my events this week as a board",
      "/make it feel like warm paper",
      "make a view that looks calm: the events this week as a board",
      "make a board of the week that feels calm",
      "build a table that looks clean",
      "show me a dashboard that looks like a cockpit",
      "show me my events this week",
      "make a list of my notes",
    ])
      expect(to(text), text).toBe("propose");
    expect(routeOf("/make show my events this week as a board")).toEqual({
      to: "propose",
      args: { kind: "view", text: "show my events this week as a board" },
    });
  });

  it("keeps the rest for Eris's conversation, and everything but looks when desk.propose is absent", () => {
    for (const text of [
      "hello there",
      "change the theme of my React app to dark mode",
      "what theme is this?",
      "/make",
      "show my events this week",
    ])
      expect(to(text), text).toBe("talk");
    expect(to("show me my events this week", false)).toBe("talk");
    expect(to("/make a board", false)).toBe("talk");
    expect(to("make a board of the week that feels calm", false)).toBe("look");
  });

  it("sends profile and key binding sentences to desk.propose with their kind, look words and all", () => {
    expect(routeOf("make a quiet night profile with only notes and terminal")).toEqual({
      to: "propose",
      args: { kind: "profile", text: "make a quiet night profile with only notes and terminal" },
    });
    expect(routeOf("make a profile that feels like a calm evening")).toEqual({
      to: "propose",
      args: { kind: "profile", text: "make a profile that feels like a calm evening" },
    });
    expect(routeOf("bind Mod+Shift+T to open the terminal")).toEqual({
      to: "propose",
      args: { kind: "keys", text: "bind Mod+Shift+T to open the terminal" },
    });
    expect(routeOf("make shortcuts that feel quick for the four desktops")).toEqual({
      to: "propose",
      args: { kind: "keys", text: "make shortcuts that feel quick for the four desktops" },
    });
    for (const text of ["bind it", "what does bind mean to you?", "my profile is quiet", "binder"])
      expect(to(text), text).toBe("talk");
    expect(to("bind Mod+Shift+T to open the terminal", false)).toBe("talk");
  });
});
