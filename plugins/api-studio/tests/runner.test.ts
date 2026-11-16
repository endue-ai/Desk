// The runner: data files read as rows, the requests of a folder in order, a run that goes through
// each request as many times as asked with each row as variables, stops at a failure when asked,
// and reports in Markdown.
import { describe, expect, it } from "vitest";
import { failure } from "../ui/actions.js";
import type { Tab } from "../ui/app.js";
import type { Collection, Node } from "../ui/collection-fs.js";
import { newRequest } from "../ui/model.js";
import {
  parseCsv,
  parseData,
  reportMarkdown,
  requestsOf,
  startRun,
  summarize,
} from "../ui/runner.js";

describe("data rows", () => {
  it("reads CSV with quotes, commas and line breaks in cells", () => {
    expect(parseCsv('name,note\r\nAda,"says ""hi"", twice"\nBo,"two\nlines"\n')).toEqual([
      { name: "Ada", note: 'says "hi", twice' },
      { name: "Bo", note: "two\nlines" },
    ]);
  });
  it("reads a JSON array, turning values into text", () => {
    expect(parseData('[{"id": 1, "tags": ["a"]}]')).toEqual([{ id: "1", tags: '["a"]' }]);
    expect(() => parseData("[1")).toThrow();
  });
});

describe("a run", () => {
  const req = (name: string) => newRequest({ name, url: `https://x/${name}` });
  const nodes: Node[] = [
    { type: "request", path: "/c/a.request.json", name: "A", method: "GET", seq: 1, req: req("A") },
    {
      type: "folder",
      path: "/c/f",
      name: "F",
      seq: 2,
      meta: {
        name: "F",
        auth: { type: "inherit" },
        headers: [],
        vars: [],
        scripts: { pre: "", post: "" },
        docs: "",
      },
      children: [
        {
          type: "request",
          path: "/c/f/b.request.json",
          name: "B",
          method: "POST",
          seq: 1,
          req: req("B"),
        },
      ],
    },
  ];
  const coll = {
    path: "/c",
    name: "C",
    children: nodes,
    envs: [],
    meta: nodes[1],
  } as unknown as Collection;

  it("lists a folder's requests depth first", () => {
    expect(requestsOf(nodes).map((i) => [i.name, i.folder])).toEqual([
      ["A", ""],
      ["B", "F"],
    ]);
  });

  it("sends each request per row, with the row as data, and stops at a failure when asked", async () => {
    const seen: string[] = [];
    const S = {
      send: async (tab: Tab) => {
        seen.push(`${tab.req.name}:${tab.data?.user}`);
        const res = {
          ...failure(""),
          error: undefined,
          status: tab.req.name === "B" && tab.data?.user === "bo" ? 500 : 200,
        };
        tab.response = res;
        tab.results = {
          tests: [{ name: "ok", ok: res.status < 400, from: "Tests" }],
          asserts: [],
          logs: [],
          errors: [],
        };
      },
      cancel: () => {},
    };
    const items = requestsOf(nodes);
    const rows = await startRun(
      S as never,
      coll,
      items,
      { iterations: 1, delayMs: 0, stopOnFail: false, data: [{ user: "ada" }, { user: "bo" }] },
      { onRow: () => {} },
    ).promise;
    expect(seen).toEqual(["A:ada", "B:ada", "A:bo", "B:bo"]);
    expect(summarize(rows)).toMatchObject({ requests: 4, failedRequests: 1, passed: 3, failed: 1 });
    expect(reportMarkdown("Run of C", rows)).toContain("| 2 | POST F / B | 500 |");

    seen.length = 0;
    const stopped = await startRun(
      S as never,
      coll,
      items,
      { iterations: 3, delayMs: 0, stopOnFail: true, data: [{ user: "bo" }] },
      { onRow: () => {} },
    ).promise;
    expect(stopped).toHaveLength(2);
    expect(seen).toEqual(["A:bo", "B:bo"]);
  });
});
