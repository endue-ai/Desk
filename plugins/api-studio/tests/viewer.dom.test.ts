// @vitest-environment jsdom
// The body viewer's parts: Markdown drawn as nodes (no HTML from the text), server-sent events
// read out of a body, a JSON tree whose values know their paths, and the views a body offers.
import { describe, expect, it } from "vitest";
import { failure } from "../ui/actions.js";
import { markdown } from "../ui/markdown.js";
import { bodyInfo, responseBody, viewsOf } from "../ui/res-body.js";
import { parseEvents } from "../ui/res-find.js";
import { childPath, jsonTree } from "../ui/res-tree.js";
import type { Response } from "../ui/send.js";

function response(text: string, type: string): Response {
  return {
    ...failure(""),
    error: undefined,
    status: 200,
    contentType: type,
    body: new TextEncoder().encode(text),
  };
}

describe("markdown", () => {
  it("draws headings, lists, code, tables and links as nodes, never as HTML", () => {
    const el = markdown(
      '# Title\n\nSome **bold** and `code` with {{token}}.\n\n- one\n- [x] done\n\n```json\n{"a": 1}\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[docs](https://example.com) <img src=x onerror=alert(1)>',
    );
    expect(el.querySelector("h2")?.textContent).toBe("Title");
    expect(el.querySelector("strong")?.textContent).toBe("bold");
    expect(el.querySelector(".var")?.textContent).toBe("{{token}}");
    expect(el.querySelectorAll("li")).toHaveLength(2);
    expect(el.querySelector(".md-pre .t-key")?.textContent).toBe('"a"');
    expect(el.querySelectorAll("td")).toHaveLength(2);
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("events and trees", () => {
  it("reads server-sent events", () => {
    expect(
      parseEvents(
        ': hello\n\nid: 1\nevent: order\ndata: {"a":1}\n\ndata: line one\ndata: line two\n\n',
      ),
    ).toEqual([
      { id: "1", event: "order", data: '{"a":1}' },
      { id: "", event: "message", data: "line one\nline two" },
    ]);
  });

  it("gives every value its path and copies it", () => {
    expect(childPath("res.body", "a b")).toBe('res.body["a b"]');
    expect(childPath("res.body.items", 2)).toBe("res.body.items[2]");
    const copied: string[] = [];
    const tree = jsonTree(
      { data: [{ id: 7 }] },
      { onCopy: (t) => copied.push(t) },
      { depthOpen: 5 },
    );
    const row = [...tree.el.querySelectorAll<HTMLElement>(".jt-row")].find(
      (r) => r.dataset.path === "res.body.data[0].id",
    );
    expect(row?.textContent).toContain("7");
    row?.querySelector<HTMLButtonElement>(".jt-tool")?.click();
    expect(copied).toEqual(["res.body.data[0].id"]);
  });

  it("offers the views a body's kind has and filters JSON by a path", () => {
    expect(viewsOf("json").map(([v]) => v)).toEqual(["pretty", "tree", "raw"]);
    expect(bodyInfo(response("id: 1\ndata: x\n\n", "text/event-stream")).kind).toBe("events");
    expect(bodyInfo(response('{"a":1}', "")).kind).toBe("json");
    const el = responseBody(
      response('{"data":[{"name":"Ada"},{"name":"Bo"}]}', "application/json"),
      {
        view: "pretty",
        wrap: false,
        filter: "$.data[*].name",
        onView: () => {},
        onWrap: () => {},
        onFilter: () => {},
        onSave: () => {},
        onCopy: () => {},
      },
    );
    expect(el.querySelector(".as-code")?.textContent).toBe('[\n  "Ada",\n  "Bo"\n]');
  });
});
