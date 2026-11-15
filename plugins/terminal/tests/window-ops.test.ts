// The window operations a plain terminal answers (#319): vim and neovim push the title before they
// set their own and pop it when they quit (CSI 22 t, CSI 23 t), so the tab gets the shell's back;
// programs ask for the text area in characters and pixels and for a cell's size (CSI 18 t, 14 t,
// 16 t). xterm.js keeps every window operation off by default. Nothing that moves, resizes,
// raises or iconifies the window, or reads its title back, is turned on.
import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../ui/shell.js";
import { terminalOptions, WINDOW_OPTIONS, xtermOptions } from "../ui/theme.js";
import { emulator, written } from "./xterm";

const theme = { scheme: "dark", contrast: "normal", reducedMotion: false, variables: {} } as const;

describe("the terminal's window operations", () => {
  it("are the title stack and the size reports, nothing else", () => {
    expect(WINDOW_OPTIONS).toEqual({
      pushTitle: true,
      popTitle: true,
      getWinSizeChars: true,
      getWinSizePixels: true,
      getCellSizePixels: true,
    });
    const options = terminalOptions(DEFAULTS, theme);
    expect(options.windowOptions).toEqual(WINDOW_OPTIONS);
    expect(xtermOptions(options).windowOptions).toEqual(WINDOW_OPTIONS);
  });

  it("give the title back when an editor quits", async () => {
    const term = emulator(xtermOptions(terminalOptions(DEFAULTS, theme)));
    const titles: string[] = [];
    term.onTitleChange((title) => titles.push(title));
    await written(term, "\x1b]2;~/src\x07"); // the shell's prompt
    await written(term, "\x1b[22;0t\x1b]2;notes.md - VIM\x07"); // vim starts
    await written(term, "\x1b[23;0t"); // vim quits
    expect(titles).toEqual(["~/src", "notes.md - VIM", "~/src"]);
    term.dispose();
  });

  it("answer the size in characters", async () => {
    const term = emulator({ ...xtermOptions(terminalOptions(DEFAULTS, theme)), cols: 100 });
    const answers: string[] = [];
    term.onData((data) => answers.push(data));
    await written(term, "\x1b[18t");
    expect(answers).toEqual(["\x1b[8;24;100t"]);
    term.dispose();
  });

  it("move, resize and raise nothing", async () => {
    const term = emulator(xtermOptions(terminalOptions(DEFAULTS, theme)));
    const answers: string[] = [];
    term.onData((data) => answers.push(data));
    // Iconify, move, resize in pixels and characters, raise, the title back (21 t).
    await written(term, "\x1b[2t\x1b[3;0;0t\x1b[4;10;10t\x1b[8;5;5t\x1b[5t\x1b[21t");
    expect(answers).toEqual([]);
    expect([term.cols, term.rows]).toEqual([80, 24]);
    term.dispose();
  });
});
