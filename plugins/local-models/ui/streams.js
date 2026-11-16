// A streamed body read as lines, as server-sent events (OpenAI-compatible servers) or as one JSON
// object per line (Ollama), each yielded the moment its line is complete.

/** @param {AsyncIterable<Uint8Array>} body */
export async function* lines(body) {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const part of body) {
    rest += decoder.decode(part, { stream: true });
    let at = rest.indexOf("\n");
    while (at >= 0) {
      yield rest.slice(0, at).replace(/\r$/, "");
      rest = rest.slice(at + 1);
      at = rest.indexOf("\n");
    }
  }
  rest += decoder.decode();
  if (rest) yield rest.replace(/\r$/, "");
}

/**
 * Server-sent events: `{ event, data }` per blank-line-ended block, `data` lines joined by "\n".
 * @param {AsyncIterable<Uint8Array>} body
 */
export async function* sse(body) {
  let event = "message";
  /** @type {string[]} */
  let data = [];
  for await (const line of lines(body)) {
    if (line === "") {
      if (data.length) yield { event, data: data.join("\n") };
      event = "message";
      data = [];
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  }
  if (data.length) yield { event, data: data.join("\n") };
}

/** One JSON value per line; blank lines skipped. @param {AsyncIterable<Uint8Array>} body */
export async function* ndjson(body) {
  for await (const line of lines(body)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed);
  }
}
