// A prepared request as curl's config, written to curl's stdin (`curl -q -K -`): the URL, headers,
// body and credentials never appear in the process's arguments, where other programs could read
// them. stdout carries the response's header blocks then its body; stderr the verbose timeline,
// then a marker line and curl's own JSON report of the transfer (timings, sizes, addresses, TLS).
// curl speaks only HTTP and HTTPS here, redirects included: a file:// URL or another protocol
// would let a collection read this computer's files through curl, outside the desk's grants.

/**
 * @typedef {{ key: string, value: string, secret?: boolean }} Header
 * @typedef {{ kind: "none" } | { kind: "raw", text: string } | { kind: "file", path: string }
 *   | { kind: "multipart", parts: { name: string, value: string, file?: boolean, type?: string }[] }} WireBody
 * @typedef {{ mode: "digest" | "ntlm" | "awsv4", user: string, provider?: string }} CurlAuth
 * @typedef {{ method: string, url: string, headers: Header[], body: WireBody,
 *   auth?: CurlAuth, settings: import("./model.js").Settings, proxy?: string,
 *   cookieJar?: string, secrets?: string[] }} Prepared
 *   `secrets`: the values that must not reach another host (secret variables', the auth's).
 */

/** The line curl writes before its JSON report on stderr. */
export const MARKER = "@@endue-api-studio:report@@";

/** The arguments: no .curlrc (-q must come first), the config from stdin. */
export const ARGS = Object.freeze(["-q", "-K", "-"]);

/** A config value in double quotes, with the escapes curl's config reader knows. @param {string} text */
export function quote(text) {
  return `"${text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\v/g, "\\v")}"`;
}

/** The protocols curl may use, for the request and for every redirect. */
export const PROTOCOLS = "=http,https";

/**
 * A header line curl will send as is; a header with an empty value needs curl's `;` form. The name
 * keeps only the characters a header name may have, so it never starts with curl's `@file` form.
 * @param {Header} h
 */
export function headerLine(h) {
  const name = h.key.trim().replace(/[^!#$%&'*+.^_`|~0-9A-Za-z-]/g, "");
  const value = h.value.replace(/[\r\n]+/g, " ");
  if (!name) return "";
  return value === "" ? `${name};` : `${name}: ${value}`;
}

/** A part's content type when it is a plain type/subtype, else none. @param {string | undefined} type */
export const mimeType = (type) => {
  const t = String(type ?? "").trim();
  return /^[A-Za-z0-9][\w!#$&^.+-]*\/[A-Za-z0-9][\w!#$&^.+-]*$/.test(t) ? t : "";
};

/** The path curl reads for a multipart file part. @param {string} value */
export const filePart = (value) => value.replace(/[;"\r\n]/g, "");

/** A multipart part: `form-string` for a text value (no @ or < tricks), `form` for a file. */
function partLine(
  /** @type {{ name: string, value: string, file?: boolean, type?: string }} */ part,
) {
  const name = part.name.replace(/[=;"\r\n]/g, "_");
  if (part.file) {
    const path = filePart(part.value);
    // A content type is type/subtype and nothing more: in curl's form syntax a comma after it
    // names one more file to send, and a ; more options.
    const type = mimeType(part.type);
    return `form = ${quote(`${name}=@"${path}"${type ? `;type=${type}` : ""}`)}`;
  }
  return `form-string = ${quote(`${name}=${part.value}`)}`;
}

/**
 * The config curl reads for one request. `verbose` adds the timeline; HEAD asks with `head`, and
 * every other method is named with `request` so curl never guesses one from the body.
 * @param {Prepared} prep @param {{ verbose?: boolean }} [options] @returns {string}
 */
export function curlConfig(prep, options = {}) {
  const s = prep.settings;
  const lines = ["silent", "show-error"];
  if (options.verbose !== false) lines.push("verbose");
  const head = prep.method.toUpperCase() === "HEAD";
  if (head) lines.push("head");
  else {
    lines.push('dump-header = "-"');
    lines.push(`request = ${quote(prep.method.toUpperCase())}`);
  }
  lines.push(`proto = ${quote(PROTOCOLS)}`);
  lines.push(`proto-redir = ${quote(PROTOCOLS)}`);
  lines.push(`url = ${quote(prep.url)}`);
  lines.push(`write-out = ${quote(`%{stderr}\n${MARKER}\n%{json}`)}`);
  if (s.followRedirects) {
    lines.push("location");
    lines.push(`max-redirs = ${Math.max(0, Math.min(50, Math.floor(s.maxRedirects)))}`);
  }
  if (!s.verifyTls) lines.push("insecure");
  if (s.timeoutMs > 0) lines.push(`max-time = ${(s.timeoutMs / 1000).toFixed(3)}`);
  if (s.httpVersion === "1.1") lines.push("http1.1");
  else if (s.httpVersion === "2") lines.push("http2");
  else if (s.httpVersion === "3") lines.push("http3");
  if (s.decompress) lines.push("compressed");
  if (prep.proxy) lines.push(`proxy = ${quote(prep.proxy)}`);
  if (prep.cookieJar) {
    lines.push(`cookie = ${quote(prep.cookieJar)}`);
    lines.push(`cookie-jar = ${quote(prep.cookieJar)}`);
  }
  for (const line of prep.headers.map(headerLine)) if (line) lines.push(`header = ${quote(line)}`);
  // A body curl would otherwise send with `Expect: 100-continue` goes at once.
  if (prep.body.kind !== "none") lines.push(`header = ${quote("Expect:")}`);
  if (prep.body.kind === "raw") lines.push(`data-raw = ${quote(prep.body.text)}`);
  else if (prep.body.kind === "file") lines.push(`data-binary = ${quote(`@${prep.body.path}`)}`);
  else if (prep.body.kind === "multipart")
    for (const part of prep.body.parts) lines.push(partLine(part));
  if (prep.auth) {
    if (prep.auth.mode === "digest") lines.push("digest");
    else if (prep.auth.mode === "ntlm") lines.push("ntlm");
    else if (prep.auth.mode === "awsv4")
      lines.push(`aws-sigv4 = ${quote(prep.auth.provider ?? "aws:amz")}`);
    lines.push(`user = ${quote(prep.auth.user)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** A shell-quoted word for a copied command line: plain when safe, single quotes otherwise. @param {string} word */
export function shellWord(word) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The same request as one curl command line a person can paste in a terminal (secrets included,
 * since that is what was asked for), wrapped one option per line.
 * @param {Prepared} prep
 */
export function curlCommand(prep) {
  const first = ["curl"];
  const head = prep.method.toUpperCase() === "HEAD";
  if (head) first.push("--head");
  else if (prep.method.toUpperCase() !== "GET" || prep.body.kind !== "none")
    first.push("-X", shellWord(prep.method.toUpperCase()));
  first.push(shellWord(prep.url));
  const words = [first];
  for (const line of prep.headers.map(headerLine)) if (line) words.push(["-H", shellWord(line)]);
  if (prep.body.kind === "raw") words.push(["--data-raw", shellWord(prep.body.text)]);
  else if (prep.body.kind === "file")
    words.push(["--data-binary", shellWord(`@${prep.body.path}`)]);
  else if (prep.body.kind === "multipart")
    for (const part of prep.body.parts)
      words.push(
        part.file
          ? [
              "-F",
              shellWord(
                `${part.name}=@${part.value}${mimeType(part.type) ? `;type=${mimeType(part.type)}` : ""}`,
              ),
            ]
          : ["--form-string", shellWord(`${part.name}=${part.value}`)],
      );
  if (prep.auth) {
    if (prep.auth.mode === "digest") words.push(["--digest"]);
    if (prep.auth.mode === "ntlm") words.push(["--ntlm"]);
    if (prep.auth.mode === "awsv4")
      words.push(["--aws-sigv4", shellWord(prep.auth.provider ?? "aws:amz")]);
    words.push(["--user", shellWord(prep.auth.user)]);
  }
  const s = prep.settings;
  if (s.followRedirects) words.push(["-L"]);
  if (!s.verifyTls) words.push(["-k"]);
  if (s.httpVersion === "1.1") words.push(["--http1.1"]);
  if (s.httpVersion === "2") words.push(["--http2"]);
  if (s.httpVersion === "3") words.push(["--http3"]);
  if (s.decompress) words.push(["--compressed"]);
  return words.map((w) => w.join(" ")).join(" \\\n  ");
}
