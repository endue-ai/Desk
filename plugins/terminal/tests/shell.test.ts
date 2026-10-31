import { describe, expect, it } from "vitest";
import {
  basename,
  candidates,
  DEFAULTS,
  environment,
  isShell,
  parseSettings,
  platformOf,
} from "../ui/shell.js";

describe("the platform", () => {
  it("is read from navigator.platform", () => {
    expect(platformOf("MacIntel")).toBe("mac");
    expect(platformOf("Win32")).toBe("windows");
    expect(platformOf("Linux x86_64")).toBe("linux");
    expect(platformOf(undefined)).toBe("linux");
  });
});

describe("the default shell", () => {
  it("is zsh, bash or sh as a login shell on macOS", () => {
    expect(candidates("mac", DEFAULTS)).toEqual([
      { command: "zsh", args: ["-l"] },
      { command: "bash", args: ["-l"] },
      { command: "sh", args: ["-l"] },
    ]);
  });

  it("is bash, zsh or sh on Linux, not a login shell unless asked", () => {
    expect(candidates("linux", DEFAULTS)).toEqual([
      { command: "bash", args: [] },
      { command: "zsh", args: [] },
      { command: "sh", args: [] },
    ]);
    expect(candidates("linux", { ...DEFAULTS, login: "yes" })[0]).toEqual({
      command: "bash",
      args: ["-l"],
    });
    expect(candidates("mac", { ...DEFAULTS, login: "no" })[0]).toEqual({
      command: "zsh",
      args: [],
    });
  });

  it("is pwsh, powershell or cmd on Windows", () => {
    expect(candidates("windows", DEFAULTS)).toEqual([
      { command: "pwsh", args: ["-NoLogo"] },
      { command: "powershell", args: ["-NoLogo"] },
      { command: "cmd", args: [] },
    ]);
  });

  it("is the one the settings name, with their arguments after its own", () => {
    expect(
      candidates("mac", { ...DEFAULTS, shell: "/opt/homebrew/bin/fish", args: ["-i"] }),
    ).toEqual([{ command: "/opt/homebrew/bin/fish", args: ["-l", "-i"] }]);
    expect(candidates("windows", { ...DEFAULTS, shell: "C:/nu/nu.exe" })).toEqual([
      { command: "C:/nu/nu.exe", args: [] },
    ]);
  });

  it("knows the shells by name, wherever they are", () => {
    expect(basename("/usr/local/bin/fish")).toBe("fish");
    expect(basename("C:\\Windows\\System32\\cmd.exe")).toBe("cmd");
    expect(isShell("zsh")).toBe(true);
    expect(isShell("/bin/sh")).toBe(true);
    expect(isShell("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe(true);
    expect(isShell("git")).toBe(false);
  });

  it("gets a terminal's environment, under the settings' own", () => {
    expect(environment(DEFAULTS)).toEqual({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "endue-desk",
    });
    expect(environment({ ...DEFAULTS, env: { TERM: "xterm", EDITOR: "vim" } })).toMatchObject({
      TERM: "xterm",
      EDITOR: "vim",
    });
  });
});

describe("the settings", () => {
  it("are the defaults when init.get has none", () => {
    expect(parseSettings({})).toEqual(DEFAULTS);
  });

  it("take every key init.get hands over", () => {
    expect(
      parseSettings({
        "endue.terminal.shell": " fish ",
        "endue.terminal.args": ["-i"],
        "endue.terminal.login": "no",
        "endue.terminal.cwd": "~/Projects",
        "endue.terminal.env": { EDITOR: "vim" },
        "endue.terminal.scrollback": 500,
        "endue.terminal.font-family": "JetBrains Mono",
        "endue.terminal.font-size": 15,
        "endue.terminal.cursor-style": "bar",
        "endue.terminal.cursor-blink": false,
        "endue.terminal.bell": "none",
        "endue.terminal.copy-on-select": true,
        "endue.terminal.keys-to-desk": ["Control+Q"],
      }),
    ).toEqual({
      shell: "fish",
      args: ["-i"],
      login: "no",
      cwd: "~/Projects",
      env: { EDITOR: "vim" },
      scrollback: 500,
      fontFamily: "JetBrains Mono",
      fontSize: 15,
      cursorStyle: "bar",
      cursorBlink: false,
      bell: "none",
      copyOnSelect: true,
      keysToDesk: ["Control+Q"],
    });
  });

  it("falls back to the default for a value of the wrong kind or out of range", () => {
    expect(
      parseSettings({
        "endue.terminal.shell": 3,
        "endue.terminal.args": ["-i", 2],
        "endue.terminal.login": "maybe",
        "endue.terminal.cwd": "  ",
        "endue.terminal.env": { "BAD KEY": "x", OK: "y", NUM: 1 },
        "endue.terminal.scrollback": -1,
        "endue.terminal.font-size": 200,
        "endue.terminal.cursor-style": "blob",
        "endue.terminal.cursor-blink": "yes",
        "endue.terminal.bell": "ring",
        "endue.terminal.keys-to-desk": "Control+Q",
      }),
    ).toEqual({ ...DEFAULTS, env: { OK: "y" } });
    expect(parseSettings({ "endue.terminal.font-size": 12.5 }).fontSize).toBe(13);
    expect(parseSettings({ "endue.terminal.scrollback": 0 }).scrollback).toBe(0);
  });
});
