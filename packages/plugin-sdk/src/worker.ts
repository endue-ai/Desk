// Workers for plugin frames (ADR 0048). A frame is sandboxed, so its origin is opaque and
// `new Worker("desk-plugin://...")` is cross-origin; a worker from a blob: URL the frame made is its
// own. The blob holds one line, a static import of the plugin's module, so the module runs in the
// worker with its own URL as `import.meta.url` and imports its neighbours relatively.

/**
 * Start a module worker running one of the plugin's files:
 * `startWorker(new URL("./worker.js", import.meta.url))`. A relative URL resolves against the
 * frame's location. Import maps do not reach workers: the module imports by relative or absolute
 * URL. Messages posted at once wait until the module has run.
 */
export function startWorker(url: string | URL, options: { name?: string } = {}): Worker {
  const base = typeof location === "undefined" ? undefined : location.href;
  const target = new URL(url, base).href;
  const source = `import ${JSON.stringify(target)};\n`;
  const trampoline = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return new Worker(trampoline, { ...options, type: "module" });
  } finally {
    // The worker resolved the URL when it was made: the blob need not outlive this call.
    URL.revokeObjectURL(trampoline);
  }
}
