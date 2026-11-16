// The top bar's search: words anywhere, `key:value` on one field, `-word` to leave out.
import { describe, expect, it } from "vitest";
import * as parse from "../ui/parse.js";
import { containerFields, matches, parseQuery } from "../ui/query.js";

const web = parse.container({
  Id: "c".repeat(64),
  Name: "/shop-web-1",
  State: { Status: "running" },
  Config: {
    Image: "nginx:1.27",
    Labels: { "com.docker.compose.project": "shop", "com.docker.compose.service": "web" },
  },
  NetworkSettings: {
    Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
    Networks: { shop_default: {} },
  },
});
const db = parse.container({
  Id: "d".repeat(64),
  Name: "/blog-db-1",
  State: { Status: "exited", ExitCode: 1 },
  Config: { Image: "mysql:8.4", Labels: { "com.docker.compose.project": "blog" } },
});

const hit = (text: string, c: typeof web) => {
  const f = containerFields(c);
  return matches(parseQuery(text), f.text, f.field);
};

describe("search", () => {
  it("matches words anywhere and qualifiers on their field", () => {
    expect(hit("shop web", web)).toBe(true);
    expect(hit("nginx", web)).toBe(true);
    expect(hit("is:running", web)).toBe(true);
    expect(hit("is:running", db)).toBe(false);
    expect(hit("is:failed", db)).toBe(true);
    expect(hit("stack:blog", db)).toBe(true);
    expect(hit("port:8080", web)).toBe(true);
    expect(hit("port:8080", db)).toBe(false);
    expect(hit("network:shop", web)).toBe(true);
    expect(hit("-shop", web)).toBe(false);
    expect(hit("unknown:x", web)).toBe(false);
  });
});
