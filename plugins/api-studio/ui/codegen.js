// A prepared request as code to paste elsewhere: a shell command (curl, HTTPie, PowerShell) or a
// program (JavaScript, Python, Go, Java, C#, Rust, Swift, Kotlin). Every generator takes the same
// wire-level request, so variables are already filled in; secrets can be hidden first.

import { curlCommand, shellWord } from "./curl-config.js";

/** @typedef {import("./curl-config.js").Prepared} Prepared */

/** A string literal in a C-like language. @param {string} s */
const q = (s) => JSON.stringify(s);
/** @param {Prepared} p */
const bodyOf = (p) =>
  p.body.kind === "raw" ? p.body.text : p.body.kind === "file" ? `@${p.body.path}` : "";
/** @param {Prepared} p */
const hasBody = (p) => p.body.kind !== "none" && p.method !== "GET" && p.method !== "HEAD";
/** @param {Prepared} p */
const isJson = (p) => p.headers.some((h) => /^content-type$/i.test(h.key) && /json/i.test(h.value));
/** Indent every line. @param {string} text @param {string} pad */
const indent = (text, pad) => text.replace(/^/gm, pad);

/** @type {Record<string, { label: string, lang: string, make(p: Prepared): string }>} */
export const GENERATORS = {
  curl: { label: "curl", lang: "text", make: (p) => curlCommand(p) },
  httpie: {
    label: "HTTPie",
    lang: "text",
    make: (p) => {
      const parts = ["http", p.method, shellWord(p.url)];
      for (const h of p.headers) parts.push(shellWord(`${h.key}:${h.value}`));
      if (hasBody(p) && p.body.kind === "raw")
        return `printf %s ${shellWord(p.body.text)} | ${parts.join(" ")}`;
      return parts.join(" ");
    },
  },
  fetch: {
    label: "JavaScript (fetch)",
    lang: "js",
    make: (p) => {
      const opts = [`  method: ${q(p.method)}`];
      if (p.headers.length)
        opts.push(
          `  headers: {\n${p.headers.map((h) => `    ${q(h.key)}: ${q(h.value)}`).join(",\n")},\n  }`,
        );
      if (hasBody(p) && p.body.kind === "raw")
        opts.push(
          `  body: ${isJson(p) ? `JSON.stringify(${indent(prettyOr(p.body.text), "  ").trimStart()})` : q(p.body.text)}`,
        );
      return `const response = await fetch(${q(p.url)}, {\n${opts.join(",\n")},\n});\n\nconsole.log(response.status, await response.${isJson(p) || /json/i.test(p.headers.find((h) => /^accept$/i.test(h.key))?.value ?? "") ? "json" : "text"}());`;
    },
  },
  python: {
    label: "Python (requests)",
    lang: "text",
    make: (p) => {
      const lines = ["import requests", ""];
      const args = [q(p.url)];
      if (p.headers.length) {
        lines.push(
          `headers = {\n${p.headers.map((h) => `    ${q(h.key)}: ${q(h.value)},`).join("\n")}\n}`,
        );
        args.push("headers=headers");
      }
      if (hasBody(p) && p.body.kind === "raw") {
        if (isJson(p)) {
          lines.push(`payload = ${pyLiteral(p.body.text)}`);
          args.push("json=payload");
        } else {
          lines.push(`data = ${q(p.body.text)}`);
          args.push("data=data");
        }
      }
      lines.push(
        "",
        `response = requests.request(${q(p.method)}, ${args.join(", ")})`,
        "print(response.status_code, response.text)",
      );
      return lines.join("\n");
    },
  },
  go: {
    label: "Go (net/http)",
    lang: "text",
    make: (p) => {
      const body = hasBody(p) && p.body.kind === "raw";
      return [
        "package main",
        "",
        "import (",
        '\t"fmt"',
        '\t"io"',
        '\t"net/http"',
        body ? '\t"strings"' : "",
        ")",
        "",
        "func main() {",
        body
          ? `\tbody := strings.NewReader(${goString(p.body.kind === "raw" ? p.body.text : "")})`
          : "",
        `\treq, err := http.NewRequest(${q(p.method)}, ${q(p.url)}, ${body ? "body" : "nil"})`,
        "\tif err != nil {\n\t\tpanic(err)\n\t}",
        ...p.headers.map((h) => `\treq.Header.Set(${q(h.key)}, ${q(h.value)})`),
        "\tres, err := http.DefaultClient.Do(req)",
        "\tif err != nil {\n\t\tpanic(err)\n\t}",
        "\tdefer res.Body.Close()",
        "\tdata, _ := io.ReadAll(res.Body)",
        "\tfmt.Println(res.Status, string(data))",
        "}",
      ]
        .filter((l) => l !== "")
        .join("\n");
    },
  },
  java: {
    label: "Java (HttpClient)",
    lang: "text",
    make: (p) => {
      const body =
        hasBody(p) && p.body.kind === "raw"
          ? `HttpRequest.BodyPublishers.ofString(${q(bodyOf(p))})`
          : "HttpRequest.BodyPublishers.noBody()";
      return [
        "import java.net.URI;",
        "import java.net.http.*;",
        "",
        "var client = HttpClient.newHttpClient();",
        "var request = HttpRequest.newBuilder()",
        `    .uri(URI.create(${q(p.url)}))`,
        ...p.headers
          .filter((h) => !/^(content-length|host|connection)$/i.test(h.key))
          .map((h) => `    .header(${q(h.key)}, ${q(h.value)})`),
        `    .method(${q(p.method)}, ${body})`,
        "    .build();",
        "var response = client.send(request, HttpResponse.BodyHandlers.ofString());",
        'System.out.println(response.statusCode() + " " + response.body());',
      ].join("\n");
    },
  },
  csharp: {
    label: "C# (HttpClient)",
    lang: "text",
    make: (p) => {
      const type = p.headers.find((h) => /^content-type$/i.test(h.key))?.value ?? "text/plain";
      const lines = [
        "using var client = new HttpClient();",
        `var request = new HttpRequestMessage(new HttpMethod(${q(p.method)}), ${q(p.url)});`,
      ];
      for (const h of p.headers)
        if (!/^content-type$/i.test(h.key))
          lines.push(`request.Headers.TryAddWithoutValidation(${q(h.key)}, ${q(h.value)});`);
      if (hasBody(p) && p.body.kind === "raw")
        lines.push(
          `request.Content = new StringContent(${q(p.body.text)}, System.Text.Encoding.UTF8, ${q(type.split(";")[0] ?? type)});`,
        );
      lines.push(
        "var response = await client.SendAsync(request);",
        'Console.WriteLine($"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");',
      );
      return lines.join("\n");
    },
  },
  rust: {
    label: "Rust (reqwest)",
    lang: "text",
    make: (p) =>
      [
        "let client = reqwest::Client::new();",
        `let response = client.request(reqwest::Method::from_bytes(b${q(p.method)})?, ${q(p.url)})`,
        ...p.headers.map((h) => `    .header(${q(h.key)}, ${q(h.value)})`),
        ...(hasBody(p) && p.body.kind === "raw" ? [`    .body(${q(p.body.text)})`] : []),
        "    .send()",
        "    .await?;",
        'println!("{} {}", response.status(), response.text().await?);',
      ].join("\n"),
  },
  swift: {
    label: "Swift (URLSession)",
    lang: "text",
    make: (p) =>
      [
        `var request = URLRequest(url: URL(string: ${q(p.url)})!)`,
        `request.httpMethod = ${q(p.method)}`,
        ...p.headers.map((h) => `request.setValue(${q(h.value)}, forHTTPHeaderField: ${q(h.key)})`),
        ...(hasBody(p) && p.body.kind === "raw"
          ? [`request.httpBody = ${q(p.body.text)}.data(using: .utf8)`]
          : []),
        "let (data, response) = try await URLSession.shared.data(for: request)",
        "print((response as! HTTPURLResponse).statusCode, String(decoding: data, as: UTF8.self))",
      ].join("\n"),
  },
  kotlin: {
    label: "Kotlin (OkHttp)",
    lang: "text",
    make: (p) => {
      const type = p.headers.find((h) => /^content-type$/i.test(h.key))?.value ?? "text/plain";
      const body =
        hasBody(p) && p.body.kind === "raw"
          ? `${q(p.body.text)}.toRequestBody(${q(type)}.toMediaType())`
          : p.method === "GET" || p.method === "HEAD"
            ? "null"
            : '"".toRequestBody()';
      return [
        "val client = OkHttpClient()",
        "val request = Request.Builder()",
        `    .url(${q(p.url)})`,
        `    .method(${q(p.method)}, ${body})`,
        ...p.headers.map((h) => `    .addHeader(${q(h.key)}, ${q(h.value)})`),
        "    .build()",
        `client.newCall(request).execute().use { println("\${it.code} \${it.body?.string()}") }`,
      ].join("\n");
    },
  },
  powershell: {
    label: "PowerShell",
    lang: "text",
    make: (p) => {
      const ps = (/** @type {string} */ s) => `'${s.replace(/'/g, "''")}'`;
      const lines = [];
      if (p.headers.length)
        lines.push(
          `$headers = @{\n${p.headers.map((h) => `  ${ps(h.key)} = ${ps(h.value)}`).join("\n")}\n}`,
        );
      const args = [`-Uri ${ps(p.url)}`, `-Method ${p.method}`];
      if (p.headers.length) args.push("-Headers $headers");
      if (hasBody(p) && p.body.kind === "raw") args.push(`-Body ${ps(p.body.text)}`);
      lines.push(`Invoke-RestMethod ${args.join(" ")}`);
      return lines.join("\n");
    },
  },
};

/** JSON text pretty, or the text as a string literal when it is not JSON. @param {string} text */
function prettyOr(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return JSON.stringify(text);
  }
}

/** A value as a Python literal: True, False, None, dicts and lists, four-space indents. @param {unknown} v @param {number} depth @returns {string} */
function py(v, depth = 0) {
  const pad = (/** @type {number} */ n) => "    ".repeat(n);
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v))
    return v.length
      ? `[\n${v.map((x) => `${pad(depth + 1)}${py(x, depth + 1)}`).join(",\n")}\n${pad(depth)}]`
      : "[]";
  const entries = Object.entries(/** @type {object} */ (v));
  return entries.length
    ? `{\n${entries.map(([k, x]) => `${pad(depth + 1)}${JSON.stringify(k)}: ${py(x, depth + 1)}`).join(",\n")}\n${pad(depth)}}`
    : "{}";
}

/** JSON text as a Python literal, or as a string when it is not JSON. @param {string} text */
function pyLiteral(text) {
  try {
    return py(JSON.parse(text));
  } catch {
    return JSON.stringify(text);
  }
}

/** A Go string: a raw string when it has no backquote. @param {string} text */
function goString(text) {
  return text.includes("`") ? JSON.stringify(text) : `\`${text}\``;
}

/**
 * The request with secret values swapped for named stand-ins, for code that will be shared.
 * @param {Prepared} p @param {RegExp} secretHeaders
 */
export function hideSecrets(p, secretHeaders) {
  return {
    ...p,
    headers: p.headers.map((h) =>
      secretHeaders.test(h.key)
        ? {
            key: h.key,
            value: /^bearer /i.test(h.value)
              ? "Bearer <token>"
              : /^basic /i.test(h.value)
                ? "Basic <credentials>"
                : `<${h.key.toLowerCase()}>`,
          }
        : h,
    ),
    ...(p.auth ? { auth: { ...p.auth, user: "<user>:<password>" } } : {}),
  };
}
