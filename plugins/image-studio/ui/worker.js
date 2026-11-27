import { decode } from "./decode.js";
import { createEngine } from "./engine.js";

let engine;

async function start() {
  const response = await fetch(new URL("./image-studio.wasm", import.meta.url));
  if (!response.ok) throw new Error("The Image Studio engine could not be loaded.");
  return createEngine(await response.arrayBuffer());
}

async function run(request) {
  engine ??= await start();
  if (request.type !== "open") return engine.call(request);
  const { bytes, expectedDigest, batches, undo } = request;
  const digest = engine.digest(bytes);
  if (expectedDigest && digest !== expectedDigest) {
    throw new Error("The original image changed on disk. Open it again to start a new draft.");
  }
  const { width, height, pixels } = await decode(bytes);
  const opened = engine.load(width, height, pixels);
  const result = batches ? engine.call({ type: "replay", batches, undo }) : opened;
  return { ...result, digest };
}

self.addEventListener("message", async ({ data: { id, request } }) => {
  try {
    const result = await run(request);
    self.postMessage({ id, result }, result.data ? [result.data.buffer] : []);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
});
