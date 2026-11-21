// @vitest-environment jsdom
// The overview panel's DOM (ui/features/overview/panel.js) on jsdom, over states read from the
// scripted server: each section's title, statistic and reset time, sizes in KiB, MiB and GiB, what a
// section could not read, the pg_stat_statements steps, what the role cannot see, the settings'
// search kept across an update, and the buttons' actions.
import { describe, expect, it } from "vitest";
import { formatBytes, formatSeconds, formatValue } from "../ui/features/overview/format.js";
import { overviewView } from "../ui/features/overview/panel.js";
import { readOverview } from "../ui/features/overview/read.js";
import { OVERVIEW_CONNECTION, overviewServer, type ServerOptions } from "./overview-fixture";
import { scriptedExecutor } from "./scripted";

const NOON = Date.UTC(2026, 10, 21, 12, 0);

async function draw(options: ServerOptions = {}) {
  const { execute } = scriptedExecutor(overviewServer(undefined, options));
  const state = await readOverview(execute, OVERVIEW_CONNECTION, () => NOON);
  const acts: unknown[][] = [];
  const handle = overviewView(document, state, (...args) => acts.push(args), {
    connection: "c-reports",
  });
  document.body.replaceChildren(handle.el);
  const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
  return { state, handle, acts, text };
}

describe("the overview panel", () => {
  it("draws each section with its statistic, its reset time and its rows", async () => {
    const { text } = await draw();
    expect(text(".desk-header-title")).toBe("Server overview");
    expect(text(".desk-header-desc")).toMatch(
      /^PostgreSQL 17\.6 · primary · database reports · up 20 days 3 h · read at \d\d:\d\d · statistics counted since 2026-11-01 09:00$/u,
    );
    expect(text("#ov-unused .ov-source")).toBe(
      "From pg_stat_user_indexes (idx_scan) · counted since 2026-11-01 09:00",
    );
    expect(text("#ov-tables .ov-source")).toMatch(/^From pg_total_relation_size\(\).* · as read$/u);
    expect(text("#ov-server .ov-source")).toMatch(/each figure's reset time beside it$/u);
    const firstTable = [...document.querySelectorAll("#ov-tables tbody tr:first-child td")].map(
      (td) => td.textContent,
    );
    expect(firstTable).toEqual([
      "public",
      "orders",
      "240,000",
      "1.0 GiB",
      "768 MiB",
      "240 MiB",
      "16 MiB",
    ]);
    expect(text("#ov-tables tbody tr:last-child td:nth-child(3)")).toBe("not analyzed");
    expect(text("#ov-tables .desk-list-count")).toBe("4 rows");
    // A server figure is formatted by its own unit and names its statistic.
    const temp = [...document.querySelectorAll("#ov-server tbody tr")].find((tr) =>
      tr.textContent?.startsWith("Temporary files written"),
    );
    expect([...(temp?.children ?? [])].map((td) => td.textContent)).toEqual([
      "Temporary files written",
      "256 MiB",
      "pg_stat_database",
      "2026-11-01 09:00",
    ]);
    expect(text("#ov-vacuum .ov-note")).toMatch(/^Autovacuum is on/u);
    expect(text("#ov-wraparound .ov-note")).toMatch(/2,147,483,648 transaction ids/u);
    expect(document.querySelectorAll(".ov-nav a")).toHaveLength(17);
    expect(document.querySelector(".ov-nav a")?.getAttribute("href")).toBe("#ov-server");
  });

  it("says what a section could not read, how pg_stat_statements is enabled and what the role cannot see", async () => {
    const { text } = await draw({ deny: ["tables"], pgss: "none", monitor: false });
    expect(text("#ov-tables .desk-error")).toMatch(
      /^app may not read .*permission denied for table orders/u,
    );
    expect(document.querySelector("#ov-tables table")).toBeNull();
    expect(document.querySelector("#ov-tables .ov-open")).toBeNull();
    expect(text("#ov-statements .desk-callout")).toMatch(/CREATE EXTENSION pg_stat_statements/u);
    expect(document.querySelector("#ov-statements .ov-open")).toBeNull();
    expect(text(".overview > .ov-note")).toBe(
      "app is not a member of pg_monitor: other roles' sessions, transactions and statements show without their details, and settings only a superuser reads are left out.",
    );
  });

  it("searches the settings and keeps the search across an update", async () => {
    const { state, handle } = await draw();
    const field = document.querySelector<HTMLInputElement>("#ov-settings input[type=search]");
    expect(field?.className).toBe("desk-field");
    const names = () =>
      [...document.querySelectorAll("#ov-settings tbody tr td:first-child")].map(
        (td) => td.textContent,
      );
    expect(names()).toHaveLength(6);
    if (!field) return;
    field.value = "WORK";
    field.dispatchEvent(new Event("input"));
    expect(names()).toEqual(["work_mem"]);
    field.focus();
    handle.update({ ...state, at: NOON + 60_000 });
    const again = document.querySelector<HTMLInputElement>("#ov-settings input[type=search]");
    expect(again?.value).toBe("WORK");
    expect(document.activeElement).toBe(again);
    expect(names()).toEqual(["work_mem"]);
    if (!again) return;
    again.value = "zzz";
    again.dispatchEvent(new Event("input"));
    expect(document.querySelector("#ov-settings .ov-empty")?.textContent).toBe(
      "No setting holds “zzz”.",
    );
  });

  it("refreshes, opens a section in the console and a statement, through the actions", async () => {
    const { acts, state, handle } = await draw();
    document.querySelector<HTMLButtonElement>(".desk-header-actions button")?.click();
    document.querySelector<HTMLButtonElement>("#ov-tables .ov-open")?.click();
    const open = document.querySelectorAll<HTMLButtonElement>("#ov-statements tbody button");
    expect(open).toHaveLength(3);
    expect(open[1]?.getAttribute("aria-label")).toBe("Open statement 2 in the console");
    open[1]?.click();
    expect(acts).toEqual([
      ["overviewRefresh", "c-reports"],
      ["overviewResult", "c-reports", "tables"],
      ["overviewStatement", "c-reports", 1],
    ]);
    const query = document.querySelector("#ov-statements tbody tr td.ov-query");
    expect(query?.getAttribute("title")).toMatch(/^SELECT \* FROM orders WHERE customer_id = \$1/u);
    handle.update({ ...state, reading: true });
    expect(document.querySelector<HTMLButtonElement>(".desk-header-actions button")?.disabled).toBe(
      true,
    );
    expect(document.querySelector(".ov-status")?.getAttribute("role")).toBe("status");
    expect(document.querySelector("#ov-tables .ov-open")).toBeNull();
  });

  it("writes sizes, spans and estimates", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(1073741824)).toBe("1.0 GiB");
    expect(formatSeconds(42)).toBe("42 s");
    expect(formatSeconds(5400)).toBe("1 h 30 min");
    expect(formatSeconds(86400 * 3 + 7200)).toBe("3 days 2 h");
    expect(formatValue("estimate", "-1")).toBe("not analyzed");
    expect(formatValue("bool", "t")).toBe("yes");
    expect(formatValue("time", "2026-11-20 03:12:44.123+00")).toBe("2026-11-20 03:12");
    expect(formatValue("count", null)).toBe("–");
  });
});
