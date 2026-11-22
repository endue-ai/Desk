// The chart feature's commands (PG-44, ui/features/chart/): Database: draw the result as a chart
// opens a Chart tab right after the result on screen and picks it, with settings from the command's
// arguments; Database: export the chart writes it as SVG or PNG where the person picks; and a chart
// drawn from a starred query keeps its settings with it, so the query's next run draws the same.
import { afterEach, describe, expect, it } from "vitest";
import { type ChartPage, provideChartPage } from "../ui/chart/page.js";
import { mount, SAVED } from "./harness";

const script = () => ({
  rows: [
    ["team", "amount"],
    ["red", "1.10"],
    ["blue", "2"],
    ["red", "0.20"],
  ],
});
const page: ChartPage = {
  palette: () => ({
    series: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
    text: "#000000",
    muted: "#777777",
    grid: "#888888",
    background: "#ffffff",
    font: "sans-serif",
    size: "12px",
  }),
  png: async (svg, width, height) => ({ base64: btoa(`png ${width}x${height} ${svg.length}`) }),
};

async function charted(handlers = {}) {
  const writes: Array<{ path: string; content: string; encoding: string }> = [];
  const m = await mount({
    store: { connections: SAVED },
    script,
    pick: (asked) => (asked.title === "Database: star the query as" ? "by team" : ""),
    handlers: {
      "dialog.save": ({ suggestedName }) => ({
        cancelled: false,
        path: `~/Pictures/${suggestedName}`,
      }),
      "fs.write": (params) => {
        writes.push(params as never);
        return { bytesWritten: params.content.length };
      },
      ...handlers,
    },
  });
  await m.host.command("endue.database.console", { connection: "Notes" });
  m.view.text = "select team, amount from sales";
  await m.host.command("endue.database.run");
  await m.settle();
  return { m, writes };
}

afterEach(() => provideChartPage(undefined));

describe("the Chart tab", () => {
  it("opens after the result on screen, picked, with the settings asked for", async () => {
    const { m } = await charted();
    const answer = await m.host.command("endue.database.chart", { type: "pie" });
    const shown = m.shown();
    expect(shown?.shown?.tabs.map((t) => t.label)).toEqual(["Result", "Chart", "Messages"]);
    expect(shown?.tab).toBe(1);
    expect(shown?.shown?.tabs[1]?.chart).toMatchObject({
      set: shown?.shown?.tabs[0]?.set,
      settings: { type: "pie", x: "team", y: "amount", series: "", aggregate: "sum" },
    });
    expect(answer).toMatchObject({ tab: "Chart", settings: { type: "pie" } });
    // Asked again, it picks the same tab and draws it with the new settings.
    await m.host.command("endue.database.chart", { aggregate: "count", y: "" });
    expect(m.shown()?.shown?.tabs.filter((t) => t.kind === "chart")).toHaveLength(1);
    expect(m.shown()?.shown?.tabs[1]?.chart?.settings).toMatchObject({ aggregate: "count", y: "" });
  });

  it("is refused without a result on screen, and for a column the result does not have", async () => {
    const m = await mount({ store: { connections: SAVED }, script });
    await m.host.command("endue.database.console", { connection: "Notes" });
    await expect(m.host.command("endue.database.chart")).rejects.toThrow(/result/u);
    const { m: ran } = await charted();
    await expect(ran.host.command("endue.database.chart", { x: "nope" })).rejects.toThrow(
      /no column nope/u,
    );
  });

  it("exports as SVG and as PNG where the person picks", async () => {
    provideChartPage(page);
    const { m, writes } = await charted();
    await m.host.command("endue.database.chart");
    const svg = await m.host.command("endue.database.chart-export", { format: "svg" });
    expect(svg).toMatchObject({ path: "~/Pictures/chart-Notes-Chart.svg", format: "svg" });
    expect(writes[0]?.encoding).toBe("utf8");
    expect(writes[0]?.content).toMatch(/^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/u);
    expect(writes[0]?.content).toContain('fill="#111111"');
    expect(writes[0]?.content).toContain(">red</text>");
    await m.host.command("endue.database.chart-export", { format: "png" });
    expect(writes[1]).toMatchObject({
      path: "~/Pictures/chart-Notes-Chart.png",
      encoding: "base64",
    });
    expect(atob(writes[1]?.content ?? "")).toMatch(/^png 960x540 /u);
  });

  it("keeps its settings with a starred query, and draws them on the query's next run", async () => {
    const { m } = await charted();
    expect(await m.host.command("endue.database.star")).toBe("by team");
    await m.host.command("endue.database.chart", { type: "line", aggregate: "max" });
    await m.settle();
    expect(m.store["charts:c-lite"]).toEqual([
      {
        name: "by team",
        sql: "select team, amount from sales",
        settings: { type: "line", x: "team", y: "amount", series: "", aggregate: "max" },
      },
    ]);
    await m.host.command("endue.database.run");
    await m.settle();
    await m.host.command("endue.database.chart");
    expect(m.shown()?.shown?.tabs[1]?.chart?.settings).toMatchObject({
      type: "line",
      aggregate: "max",
    });
  });

  it("keeps nothing for a query that is not starred", async () => {
    const { m } = await charted();
    await m.host.command("endue.database.chart", { type: "line" });
    await m.settle();
    expect(m.store["charts:c-lite"]).toBeUndefined();
  });
});
