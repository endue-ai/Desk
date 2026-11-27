import { describe, expect, it, vi } from "vitest";
import { originApi, REQUEST_PAGE } from "../ui/origin-api.js";
import { originLink, parseOrigin, readRequest, stackRequests } from "../ui/origin-model.js";

const sha = "a".repeat(40);
const github = parseOrigin("git@github.com:owner/repo.git");
const gitlab = parseOrigin("https://gitlab.com/group/sub/repo.git");
if (!github || !gitlab) throw new Error("Fixture remotes must resolve");

function pull(number: number, source: string, target: string, owner = "owner", headSha = sha) {
  return {
    number,
    state: "open",
    title: `Request ${number}`,
    head: { ref: source, repo: { full_name: `${owner}/repo` }, sha: headSha },
    base: { ref: target, repo: { full_name: "owner/repo" } },
  };
}

const outcome = (value: unknown) => ({
  stdout: JSON.stringify(value),
  stderr: "",
  code: 0,
  signal: null,
});

describe("origin identity and merge stacks", () => {
  it("normalizes Git remotes while refusing unrelated hosts, override ports and unsafe links", () => {
    expect(github).toMatchObject({ host: "github.com", path: "owner/repo", program: "gh" });
    expect(parseOrigin("ssh://git@gitlab.com:22/group/sub/repo.git")).toEqual(gitlab);
    expect(parseOrigin("https://github.com:8443/owner/repo")).toBeNull();
    expect(parseOrigin("https://github.com@else.example/owner/repo.git")).toBeNull();
    expect(parseOrigin("https://else.example/owner/repo.git")).toBeNull();
    expect(originLink(github, "https://github.com/owner/repo/pull/5")).toContain("/pull/5");
    expect(originLink(github, "https://else.example/owner/repo/pull/5")).toBe("");
    expect(originLink(github, "javascript:alert(1)")).toBe("");
  });

  it("nests A → B under B → C without confusing an identically named fork branch", () => {
    const input = [pull(1, "A", "B"), pull(2, "B", "C"), pull(3, "B", "main", "fork")];
    const stacks = stackRequests(input.map((item) => readRequest(github, item)));
    expect(stacks.map(({ request }) => request.number)).toEqual([2, 3]);
    expect(stacks[0]?.children.map(({ request }) => request.number)).toEqual([1]);
  });

  it("keeps cycles, merged requests and competing targets visible as independent rows", () => {
    const input = [
      pull(1, "A", "B"),
      pull(2, "B", "A"),
      pull(3, "Y", "X"),
      pull(4, "X", "main"),
      pull(5, "X", "other"),
      { ...pull(6, "P", "X"), merged_at: "2026-11-27" },
    ];
    expect(
      stackRequests(input.map((item) => readRequest(github, item))).map(
        (node) => node.children.length,
      ),
    ).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("provider CLI calls", () => {
  it("reads GitLab's nested project using its encoded path and GitHub's current job attempt", async () => {
    const run = vi.fn().mockResolvedValue(outcome([]));
    const lab = originApi({ run }, gitlab);
    await lab.requests("open", 2);
    expect(run.mock.calls[0]).toEqual([
      [
        "api",
        "--hostname",
        "gitlab.com",
        "--method",
        "GET",
        `projects/group%2Fsub%2Frepo/merge_requests?state=opened&scope=all&order_by=updated_at&sort=desc&per_page=${REQUEST_PAGE}&page=2`,
      ],
      { program: "glab" },
    ]);
    run.mockResolvedValueOnce(outcome({ jobs: [{ id: 2, name: "Build", conclusion: "success" }] }));
    const hub = originApi({ run }, github);
    const result = await hub.jobs({
      id: 5,
      attempt: 3,
      name: "CI",
      ref: "",
      sha,
      status: "",
      date: "",
      url: "",
    });
    expect(run.mock.calls[1]?.[0]).toContain(
      "repos/owner/repo/actions/runs/5/attempts/3/jobs?per_page=50",
    );
    expect(result.items[0]).toMatchObject({ name: "Build", status: "success" });
  });

  it("refuses to merge when the source SHA or base has changed, and sends the reviewed SHA otherwise", async () => {
    const original = pull(1, "A", "B");
    const run = vi
      .fn()
      .mockResolvedValueOnce(outcome(pull(1, "A", "B", "owner", "b".repeat(40))))
      .mockResolvedValueOnce(outcome(pull(1, "A", "main")))
      .mockResolvedValueOnce(outcome(original))
      .mockResolvedValueOnce(outcome({ merged: true }));
    const api = originApi({ run }, github);
    const request = readRequest(github, original);
    await expect(api.changeRequest(request, "merge")).rejects.toThrow(/changed/);
    await expect(api.changeRequest(request, "merge")).rejects.toThrow(/changed/);
    expect(run).toHaveBeenCalledTimes(2);
    await api.changeRequest(request, "merge", "squash");
    expect(run.mock.calls[3]).toEqual([
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "PUT",
        "repos/owner/repo/pulls/1/merge",
        "--input",
        "-",
      ],
      { program: "gh", input: JSON.stringify({ sha, merge_method: "squash" }) },
    ]);
  });

  it("supports GitLab state changes and a merge accepted for asynchronous processing", async () => {
    const opened = {
      iid: 4,
      title: "Change",
      state: "opened",
      sha,
      source_branch: "A",
      target_branch: "main",
      source_project_id: 1,
      target_project_id: 1,
    };
    const closed = { ...opened, state: "closed" };
    const run = vi
      .fn()
      .mockResolvedValueOnce(outcome(opened))
      .mockResolvedValueOnce(outcome(closed))
      .mockResolvedValueOnce(outcome(closed))
      .mockResolvedValueOnce(outcome(opened))
      .mockResolvedValueOnce(outcome(opened))
      .mockResolvedValueOnce(outcome({ ...opened, state: "locked" }));
    const api = originApi({ run }, gitlab);
    await api.changeRequest(readRequest(gitlab, opened), "close");
    await api.changeRequest(readRequest(gitlab, closed), "reopen");
    await expect(api.changeRequest(readRequest(gitlab, opened), "merge")).resolves.toBe(
      "submitted",
    );
    expect(
      run.mock.calls.filter((_, i) => i % 2 === 1).map((call) => JSON.parse(call[1].input)),
    ).toEqual([{ state_event: "close" }, { state_event: "reopen" }, { sha }]);
  });

  it("publishes with an existing tag and treats release fields as data", async () => {
    const run = vi.fn().mockResolvedValue(outcome({}));
    const fields = { tag: "release/v1", title: "--title", notes: "@notes.txt" };
    await originApi({ run }, github).publish(fields);
    expect(run.mock.calls[0]).toEqual([
      [
        "release",
        "create",
        "--repo",
        "github.com/owner/repo",
        "--verify-tag",
        "--title",
        "--title",
        "--notes-file",
        "-",
        "--",
        "release/v1",
      ],
      { program: "gh", input: "@notes.txt" },
    ]);
    await originApi({ run }, gitlab).publish(fields);
    expect(run.mock.calls[1]?.[1]).toEqual({
      program: "glab",
      input: JSON.stringify({ tag_name: "release/v1", name: "--title", description: "@notes.txt" }),
    });
  });
});
