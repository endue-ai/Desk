// The vendored xterm.js itself, for the tests that need the real emulator (issue 319): it parses in
// Node without a page, so OSC handlers, the title stack, size reports and its mouse service run as
// they do in the terminal. The module is minified JavaScript, so its shape is written out here.
import { Terminal } from "../ui/vendor/xterm.mjs";

export interface Emulator {
  cols: number;
  rows: number;
  parser: { registerOscHandler(code: number, handler: (data: string) => boolean): unknown };
  write(data: string, done?: () => void): void;
  onData(listener: (data: string) => void): unknown;
  onBinary(listener: (data: string) => void): unknown;
  onTitleChange(listener: (title: string) => void): unknown;
  onBell(listener: () => void): unknown;
  dispose(): void;
}

/** A terminal made with `options`, without a page. */
export const emulator = (options: Record<string, unknown> = {}) =>
  new Terminal({ allowProposedApi: true, ...options }) as unknown as Emulator;

/** Write `data` and wait until xterm.js has parsed it. */
export const written = (term: Emulator, data: string) =>
  new Promise<void>((resolve) => term.write(data, resolve));

/** A press of the left button at column `col` + 1, row 5, from xterm.js's own mouse service. */
export function press(term: Emulator, col = 9) {
  const { _core } = term as unknown as {
    _core: { coreMouseService: { triggerMouseEvent(event: object): boolean } };
  };
  return _core.coreMouseService.triggerMouseEvent({
    ...{ col, row: 4, x: 0, y: 0, button: 0, action: 1 },
    ...{ ctrl: false, alt: false, shift: false },
  });
}
