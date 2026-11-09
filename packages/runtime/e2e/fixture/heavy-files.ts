// Large files for the frame-time checks (?heavy=1, perf/heavy-open.spec.ts, #38): a long note for
// Notes and a large image for Explorer's preview, answered as the core would, over the file viewers'
// small fixtures. Made before the page is ready, so making them is not measured.
import type { StubHandlers } from "@endue-ai/bridge";

export const LONG_NOTE = "~/Notes/long.txt";
export const LARGE_IMAGE = "~/Documents/large.png";
/** The note's size in bytes (all ASCII, so also its length). */
export const NOTE_BYTES = 4 * 1024 * 1024;

/** Words, sentences and paragraphs, the same every time. */
function longNote(bytes: number): string {
  const words = "the desk keeps every window drawing while a plugin reads a long note".split(" ");
  const parts: string[] = [];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    const word = `${words[i % words.length]}${i % 13 === 12 ? ".\n" : " "}`;
    parts.push(word);
    size += word.length;
  }
  return parts.join("").slice(0, bytes);
}

/** Bytes as base64 in slices, so no call takes millions of arguments. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

export async function heavyHandlers(base: StubHandlers): Promise<StubHandlers> {
  const note = longNote(NOTE_BYTES);
  const image = new Uint8Array(await (await fetch("/perf/large.png")).arrayBuffer());
  const image64 = base64(image);
  const { "fs.url": url, "fs.read": read, "fs.list": list } = base;
  if (!url || !read || !list) throw new Error("the file viewers' handlers are missing");
  return {
    ...base,
    "fs.url": (params, caller) =>
      params.path === LARGE_IMAGE
        ? { url: "/perf/large.png", type: "image/png", size: image.length }
        : url(params, caller),
    "fs.read": (params, caller) => {
      if (params.path === LONG_NOTE) return { content: note, encoding: "utf8", size: NOTE_BYTES };
      // Explorer before #38 read the image as base64 and decoded it in its frame.
      if (params.path === LARGE_IMAGE)
        return { content: image64, encoding: "base64", size: image.length };
      return read(params, caller);
    },
    "fs.list": async (params, caller) => ({
      entries: [
        ...(await list(params, caller)).entries,
        { name: "large.png", kind: "file", size: image.length },
      ],
    }),
  };
}
