// Workers for plugin frames (ADR 0048). A frame is sandboxed, so its origin is opaque and
// `new Worker("desk-plugin://...")` is cross-origin; a worker from a blob: URL the frame made is its
// own. Chromium refuses a *module* worker from such a blob ("cross-origin redirects of the top-level
// worker script"), so the blob is a classic worker that imports the plugin's module dynamically:
// the module still runs with its own URL as `import.meta.url` and imports its neighbours
// relatively. Messages that arrive before the module has run are kept and handed to it after.

/** The classic trampoline that runs `target` and replays what came before it was ready. */
export function trampoline(target: string): string {
  return [
    "const early = [];",
    // First listener: it holds every early message back, so a module still running (top-level
    // await) that listens already never gets one twice.
    "const keep = (event) => { event.stopImmediatePropagation(); early.push(event); };",
    'self.addEventListener("message", keep);',
    `import(${JSON.stringify(target)}).then(() => {`,
    '  self.removeEventListener("message", keep);',
    "  for (const event of early) {",
    '    self.dispatchEvent(new MessageEvent("message", { data: event.data, ports: [...event.ports] }));',
    "  }",
    "}, (error) => {",
    "  setTimeout(() => { throw error; });",
    "});",
    "",
  ].join("\n");
}

/**
 * Start a worker running one of the plugin's module files:
 * `startWorker(new URL("./worker.js", import.meta.url))`. A relative URL resolves against the
 * frame's location. Import maps do not reach workers: the module imports by relative or absolute
 * URL. Messages posted at once wait until the module has run.
 */
export function startWorker(url: string | URL, options: { name?: string } = {}): Worker {
  const base = typeof location === "undefined" ? undefined : location.href;
  const target = new URL(url, base).href;
  const blob = URL.createObjectURL(new Blob([trampoline(target)], { type: "text/javascript" }));
  const worker = new Worker(blob, options.name === undefined ? {} : { name: options.name });
  // The engine may fetch the blob after this call returns: it goes once the worker is surely up.
  setTimeout(() => URL.revokeObjectURL(blob), 60_000);
  return worker;
}
