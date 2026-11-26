// The terminal plugin's shapes, shared by sessions.js and its tests: a session, what a reload keeps
// of it, and the view sessions.js draws through (view.js in the page, a recording view in tests).

/**
 * @typedef {import("./spawn.js").Program} Program
 * @typedef {import("./output.js").Chunk} Chunk
 * @typedef {{
 *   id: string, title: string, programs: Program[], program: Program | null, procId: string | null,
 *   buffer: string | null, cols: number, rows: number, exit: string | null, ended: string | null,
 *   chunks: Chunk[], kept: number, relaunch: boolean, cwd: string | null, named: boolean, working: boolean,
 * }} Session
 * @typedef {Pick<Session, "id" | "title" | "program" | "procId" | "buffer" | "exit" | "ended" | "cwd" | "named"> & { tail: Chunk[], working?: boolean }} Saved
 * @typedef {{ id: string, layout: import("./layout.js").Layout, focused: string }} SavedTab
 * @typedef {{ next: number, shown: string | null, sessions: Saved[], tabs?: SavedTab[] }} Snapshot
 *   `tabs` is absent in a snapshot from before split panes (issue 315): each session is a tab then.
 * @typedef {{
 *   open(id: string, title: string, tab?: string): { cols: number, rows: number },
 *   layout(tab: string, layout: import("./layout.js").Layout): void,
 *   write(id: string, data: string | Uint8Array): void,
 *   line(id: string, text: string): void,
 *   show(id: string): void,
 *   close(id: string): void,
 *   clear(id: string): void,
 *   retitle(id: string, title: string): void,
 *   focus(id: string): void,
 *   status(text: string): void,
 *   flash(id: string): void,
 *   badge(id: string, count: number): void,
 *   end(id: string, text: string | null): void,
 *   move(id: string, index: number): void,
 * }} View
 */

export {};
