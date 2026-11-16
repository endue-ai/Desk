// A made-up curl for the preview and the tests: it takes the arguments the window gives the real one
// (-C - to resume, -o the file, the URL last), and for a file of the made-up Hugging Face writes its
// GGUF header, then grows the file in steps to its size (sparse, so it costs nothing) and ends 0.
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { hubFile } from "./fake-hub.mjs";
import { ggufBytes } from "./gguf-write.mjs";

/**
 * @param {string[]} args @param {string} cwd
 * @param {{ onLine: (stream: "stdout" | "stderr", text: string) => void, onExit: (code: number | null) => void, steps?: number, stepMs?: number }} o
 */
export function startFakeCurl(args, cwd, o) {
  const out = args[args.indexOf("-o") + 1];
  const url = args.at(-1) ?? "";
  const file = hubFile(url);
  if (!out || !file) {
    setTimeout(() => {
      o.onLine("stderr", "curl: (22) The requested URL returned error: 404");
      o.onExit(22);
    }, 10);
    return { kill() {} };
  }
  const path = resolve(cwd, out);
  mkdirSync(dirname(path), { recursive: true });
  const fresh = !existsSync(path);
  const fd = openSync(path, fresh ? "w" : "r+");
  if (fresh) writeSync(fd, ggufBytes(file.meta), 0, undefined, 0);
  const start = fresh ? 0 : statSync(path).size;
  const steps = o.steps ?? 24;
  let step = 0;
  let done = false;
  const timer = setInterval(() => {
    step++;
    const size = Math.round(start + ((file.size - start) * step) / steps);
    ftruncateSync(fd, Math.max(size, ggufBytes(file.meta).length));
    if (step >= steps) {
      clearInterval(timer);
      closeSync(fd);
      done = true;
      o.onExit(0);
    }
  }, o.stepMs ?? 250);
  return {
    kill() {
      if (done) return;
      done = true;
      clearInterval(timer);
      closeSync(fd);
      o.onExit(null);
    },
  };
}
