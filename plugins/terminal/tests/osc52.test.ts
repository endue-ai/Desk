// What programs copy with OSC 52 lands on the clipboard (#319): neovim, tmux, helix and programs
// over ssh copy with `ESC ] 52 ; c ; <base64> BEL`, which the terminal dropped before. The text goes
// through the webview's own copy (a copy event the terminal fills), as Mod+C does, never the
// Clipboard API (TERM-I03); a program may never read the clipboard back (`?`); the status line says
// what was copied; `endue.terminal.program-copy: false` turns it off.
import { describe, expect, it } from "vitest";
import { copied, createProgramCopy, OSC_COPY } from "../ui/clipboard.js";
import { DEFAULTS, parseSettings } from "../ui/shell.js";
import { Terminal } from "../ui/vendor/xterm.mjs";
import { wireProgram } from "../ui/wire.js";

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** A document whose execCommand("copy") fires a copy event at its listeners, as Chromium's does. */
function page(allowed = true) {
  const listeners = new Set<(event: unknown) => void>();
  const clipboard: string[] = [];
  const doc = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "copy") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "copy") listeners.delete(listener);
    },
    execCommand: (command: string) => {
      if (command !== "copy" || !allowed) return false;
      let data = "";
      let prevented = false;
      const event = {
        clipboardData: { setData: (_type: string, text: string) => (data = text) },
        preventDefault: () => (prevented = true),
        stopImmediatePropagation: () => {},
      };
      for (const listener of [...listeners]) listener(event);
      if (prevented) clipboard.push(data);
      return true;
    },
  };
  return { doc, clipboard, listeners };
}

describe("OSC 52's payload", () => {
  it("is base64 text for the clipboard, whichever selection it names", () => {
    expect(OSC_COPY).toBe(52);
    expect(copied(`c;${b64("hello")}`)).toBe("hello");
    expect(copied(`;${b64("tmux sends no selection")}`)).toBe("tmux sends no selection");
    expect(copied(`p;${b64("primary")}`)).toBe("primary");
    expect(copied(`c;${b64("한글 ✓\nline 2")}`)).toBe("한글 ✓\nline 2");
  });

  it("is never a query, a clear or anything but base64", () => {
    expect(copied("c;?")).toBeNull();
    expect(copied("c;")).toBeNull();
    expect(copied("c;not base64!")).toBeNull();
    expect(copied(b64("no selection field"))).toBeNull();
    expect(copied(`x;${b64("unknown selection")}`)).toBeNull();
  });
});

describe("a program's copy", () => {
  const make = (options: { allowed?: boolean; enabled?: boolean } = {}) => {
    const { doc, clipboard, listeners } = page(options.allowed);
    const said: string[] = [];
    const copy = createProgramCopy({
      doc,
      say: (text) => said.push(text),
      title: () => "nvim",
      enabled: () => options.enabled ?? true,
      chord: "⌘C",
    });
    return { copy, clipboard, said, listeners };
  };

  it("puts the text on the clipboard and says so", () => {
    const { copy, clipboard, said, listeners } = make();
    copy("t-1", `c;${b64("yank")}`);
    copy("t-1", `c;${b64("x")}`);
    expect(clipboard).toEqual(["yank", "x"]);
    expect(said).toEqual(["nvim copied 4 characters.", "nvim copied 1 character."]);
    expect(listeners.size).toBe(0);
  });

  it("answers no query and copies nothing when the setting is off", () => {
    const off = make({ enabled: false });
    off.copy("t-1", `c;${b64("secret")}`);
    expect(off.clipboard).toEqual([]);
    expect(off.said).toEqual([]);
    const query = make();
    query.copy("t-1", "c;?");
    expect(query.clipboard).toEqual([]);
    expect(query.said).toEqual([]);
  });

  it("says how to copy when the webview refuses", () => {
    const { copy, clipboard, said } = make({ allowed: false });
    copy("t-1", `c;${b64("yank")}`);
    expect(clipboard).toEqual([]);
    expect(said).toEqual(["The desk did not let nvim copy: select the text and press ⌘C."]);
  });

  it("is what xterm.js hands over for OSC 52", async () => {
    const term = new Terminal({ allowProposedApi: true });
    const asked: Array<[string, string]> = [];
    const none = () => {};
    wireProgram(term, "t-3", { input: none, osc: none, retitle: none, bell: none }, (id, data) =>
      asked.push([id, data]),
    );
    await new Promise<void>((resolve) => term.write(`\x1b]52;c;${b64("hi")}\x07`, resolve));
    expect(asked).toEqual([["t-3", `c;${b64("hi")}`]]);
    term.dispose();
  });

  it("is on by default and turned off by endue.terminal.program-copy", () => {
    expect(DEFAULTS.programCopy).toBe(true);
    expect(parseSettings({ "endue.terminal.program-copy": false }).programCopy).toBe(false);
    expect(parseSettings({ "endue.terminal.program-copy": "no" }).programCopy).toBe(true);
  });
});
