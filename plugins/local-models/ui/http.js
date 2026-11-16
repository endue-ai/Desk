// HTTP/1.1 over a bridge socket, for the model servers on this computer and the network: one request
// per connection (`Connection: close`), the response's head parsed as it arrives and its body read as
// it streams, chunked or not, so a model's tokens show while it writes them. Only http: a local server
// speaks it, and nothing here goes to the internet.

/**
 * @typedef {import("./net.js").Socket} Socket
 * @typedef {{ connect(target: { host: string, port: number, timeoutMs?: number }): Promise<Socket> }} Sockets
 * @typedef {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: string | Uint8Array,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 * }} RequestOptions
 * @typedef {{
 *   status: number,
 *   statusText: string,
 *   headers: Record<string, string>,
 *   body: AsyncGenerator<Uint8Array>,
 *   text(): Promise<string>,
 *   json(): Promise<any>,
 *   close(): void,
 * }} HttpResponse
 */

export class HttpError extends Error {
  /** @param {string} message @param {{ status?: number, code?: string, body?: string }} [info] */
  constructor(message, info = {}) {
    super(message);
    this.name = "HttpError";
    this.status = info.status;
    this.code = info.code ?? (info.status ? "status" : "io_error");
    this.body = info.body;
  }
}

const CRLF = "\r\n";
const HEAD_LIMIT = 64 * 1024;

/** @param {Uint8Array} a @param {Uint8Array} b */
function concat(a, b) {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Where `\r\n\r\n` starts in bytes, or -1. @param {Uint8Array} bytes */
function headEnd(bytes) {
  for (let i = 0; i + 3 < bytes.length; i++)
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10)
      return i;
  return -1;
}

/** Where `\r\n` starts at or after `from`, or -1. @param {Uint8Array} bytes @param {number} from */
function lineEnd(bytes, from = 0) {
  for (let i = from; i + 1 < bytes.length; i++)
    if (bytes[i] === 13 && bytes[i + 1] === 10) return i;
  return -1;
}

/** Split a URL into what a socket and a request line need. @param {string} url */
export function target(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:")
    throw new HttpError(`Only http:// servers are supported (${parsed.protocol})`, {
      code: "invalid_value",
    });
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  return {
    host,
    port: Number(parsed.port || 80),
    path: `${parsed.pathname || "/"}${parsed.search}`,
    hostHeader: parsed.host,
  };
}

/**
 * The body of a chunked response, decoded as it arrives.
 * @param {AsyncIterator<Uint8Array>} source @param {Uint8Array} start
 */
async function* dechunk(source, start) {
  let buffer = start;
  const more = async () => {
    const next = await source.next();
    if (next.done) throw new HttpError("The server closed the connection mid-response");
    buffer = concat(buffer, next.value);
  };
  for (;;) {
    let end = lineEnd(buffer);
    while (end < 0) {
      await more();
      end = lineEnd(buffer);
    }
    const sizeText = new TextDecoder().decode(buffer.subarray(0, end)).split(";")[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) throw new HttpError(`Bad chunk size "${sizeText}"`);
    buffer = buffer.subarray(end + 2);
    if (size === 0) return;
    while (buffer.length < size + 2) await more();
    yield buffer.slice(0, size);
    buffer = buffer.subarray(size + 2);
  }
}

/** A body of known length. @param {AsyncIterator<Uint8Array>} source @param {Uint8Array} start @param {number} length */
async function* sized(source, start, length) {
  let left = length;
  if (start.length) {
    const first = start.subarray(0, left);
    left -= first.length;
    yield first;
  }
  while (left > 0) {
    const next = await source.next();
    if (next.done) throw new HttpError("The server closed the connection mid-response");
    const part = next.value.subarray(0, left);
    left -= part.length;
    yield part;
  }
}

/** A body that runs to the connection's end. @param {AsyncIterator<Uint8Array>} source @param {Uint8Array} start */
async function* untilClose(source, start) {
  if (start.length) yield start;
  for (;;) {
    const next = await source.next();
    if (next.done) return;
    yield next.value;
  }
}

/**
 * Send one request and resolve once the response's head is in; its body streams after.
 * @param {Sockets} sockets @param {string} url @param {RequestOptions} [options]
 * @returns {Promise<HttpResponse>}
 */
export async function request(sockets, url, options = {}) {
  const { host, port, path, hostHeader } = target(url);
  const method = (options.method ?? "GET").toUpperCase();
  const body =
    typeof options.body === "string" ? new TextEncoder().encode(options.body) : options.body;
  if (options.signal?.aborted) throw new HttpError("Stopped", { code: "aborted" });
  const socket = await sockets.connect({ host, port, timeoutMs: options.timeoutMs ?? 4000 });
  const onAbort = () => socket.close();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const done = () => {
    options.signal?.removeEventListener("abort", onAbort);
    socket.close();
  };
  try {
    const headers = {
      host: hostHeader,
      "user-agent": "endue-local-models",
      accept: "*/*",
      connection: "close",
      ...Object.fromEntries(
        Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      ),
    };
    if (body) headers["content-length"] = String(body.length);
    const head = [
      `${method} ${path} HTTP/1.1`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    ].join(CRLF);
    await socket.write(
      concat(new TextEncoder().encode(`${head}${CRLF}${CRLF}`), body ?? new Uint8Array()),
    );

    const source = socket.chunks()[Symbol.asyncIterator]();
    let buffer = new Uint8Array();
    let end = headEnd(buffer);
    while (end < 0) {
      const next = await source.next();
      if (next.done)
        throw new HttpError(
          options.signal?.aborted
            ? "Stopped"
            : "The server closed the connection without an answer",
          { code: options.signal?.aborted ? "aborted" : "io_error" },
        );
      buffer = concat(buffer, next.value);
      if (buffer.length > HEAD_LIMIT) throw new HttpError("The response's head is too long");
      end = headEnd(buffer);
    }
    const lines = new TextDecoder().decode(buffer.subarray(0, end)).split(CRLF);
    const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/.exec(lines[0] ?? "");
    if (!status) throw new HttpError(`Not an HTTP answer: ${lines[0]?.slice(0, 60)}`);
    /** @type {Record<string, string>} */
    const responseHeaders = {};
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(":");
      if (colon > 0)
        responseHeaders[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
    const rest = buffer.slice(end + 4);
    const length = Number(responseHeaders["content-length"]);
    const raw =
      method === "HEAD" || status[1] === "204" || status[1] === "304"
        ? untilClose({ next: async () => ({ done: true, value: undefined }) }, new Uint8Array())
        : /chunked/i.test(responseHeaders["transfer-encoding"] ?? "")
          ? dechunk(source, rest)
          : Number.isFinite(length) && responseHeaders["content-length"] !== undefined
            ? sized(source, rest, length)
            : untilClose(source, rest);
    async function* stream() {
      try {
        yield* raw;
      } catch (error) {
        if (options.signal?.aborted) throw new HttpError("Stopped", { code: "aborted" });
        throw error;
      } finally {
        done();
      }
    }
    const bodyStream = stream();
    const text = async () => {
      const decoder = new TextDecoder();
      let out = "";
      for await (const part of bodyStream) out += decoder.decode(part, { stream: true });
      return out + decoder.decode();
    };
    return {
      status: Number(status[1]),
      statusText: status[2] ?? "",
      headers: responseHeaders,
      body: bodyStream,
      text,
      json: async () => {
        const t = await text();
        try {
          return JSON.parse(t);
        } catch {
          throw new HttpError(`The server answered something that is not JSON: ${t.slice(0, 80)}`, {
            code: "protocol",
          });
        }
      },
      close: done,
    };
  } catch (error) {
    done();
    if (options.signal?.aborted) throw new HttpError("Stopped", { code: "aborted" });
    throw error;
  }
}

/**
 * GET or POST JSON and read JSON back; a status of 400 or more is an HttpError with the server's
 * message.
 * @param {Sockets} sockets @param {string} url @param {RequestOptions & { json?: unknown }} [options]
 */
export async function fetchJson(sockets, url, options = {}) {
  const { json, ...rest } = options;
  const response = await request(sockets, url, {
    ...rest,
    method: rest.method ?? (json === undefined ? "GET" : "POST"),
    headers: {
      accept: "application/json",
      ...(json === undefined ? {} : { "content-type": "application/json" }),
      ...rest.headers,
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new HttpError(errorText(response.status, text), { status: response.status, body: text });
  }
  return response.json();
}

/** A server's error answer in words: its JSON `error` when it has one. @param {number} status @param {string} text */
export function errorText(status, text) {
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? parsed?.detail;
    if (typeof message === "string" && message) return message;
  } catch {}
  return text.trim().slice(0, 200) || `The server answered ${status}`;
}
