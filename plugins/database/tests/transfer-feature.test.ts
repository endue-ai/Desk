// Database: copy tables to another database (PG-63) on two scripted servers (transfer-fixture.ts):
// the form's answer, the report and the target's script in the panel before anything runs, then
// Start: the structure, the rows streamed from the source's COPY ... TO STDOUT into the target's
// COPY ... FROM STDIN, and COMMIT, all on the target's own session; a read-only target refused, a
// failure rolled back, a production target asked first.
import { describe, expect, it } from "vitest";
import type { TransferState } from "../ui/transfer/state.js";
import { mount } from "./harness";
import { made, PG } from "./session-helpers";
import { ARCHIVE, ITEMS, LOCKED, transferScript } from "./transfer-fixture";

const acts = (m: Awaited<ReturnType<typeof mount>>) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

async function copying(
  options: { fail?: RegExp; answer?: Record<string, unknown>; pick?: () => string } = {},
) {
  const m = await mount({
    store: {
      connections: [
        PG,
        ARCHIVE,
        LOCKED,
        { ...ARCHIVE, id: "c-prod", name: "Prod", tag: "production" },
      ],
    },
    script: transferScript(options.fail),
    dialog: () => ({
      target: ARCHIVE.id,
      database: "",
      schema: "public",
      name: "items",
      content: "both",
      foreignKeys: true,
      ...options.answer,
    }),
    ...(options.pick ? { pick: options.pick } : {}),
  });
  const opened = (await m.host.command("endue.database.transfer", {
    connection: PG.name,
    schema: "public",
    table: "items",
  })) as { panel: string };
  await m.settle();
  const state = () => m.shown()?.transfer as TransferState;
  return { m, id: opened?.panel, state };
}

describe("copying a table to another connection", () => {
  it("copies a table to another connection in one transaction", async () => {
    const { m, id, state } = await copying();
    expect(m.view.dialogs[0]?.model).toMatchObject({
      kind: "tables",
      source: "Shop",
      what: "public.items",
      target: ARCHIVE.id,
    });
    expect(state()).toMatchObject({
      status: "ready",
      problems: [],
      steps: [{ source: "public.items", target: "public.items", state: "waiting" }],
    });
    expect(state().notes).toEqual([
      "The target runs PostgreSQL 15.4, older than the source's 17.2: a type or a default it lacks fails before any row moves.",
    ]);
    expect(state().script).toContain(
      'CREATE INDEX "items_name_idx" ON "public"."items" USING btree (name);',
    );
    // Nothing ran on the target before Start.
    expect(made(m, "db.copy")).toEqual([]);
    await acts(m).transferStart?.(id);
    const target =
      m.sessions().find((s) => s.includes("BEGIN") && s.some((q) => /FROM STDIN/u.test(q))) ?? [];
    expect(target[0]).toBe("BEGIN");
    expect(target.find((q) => q.startsWith("CREATE TABLE"))).toMatch(
      /^CREATE TABLE "public"\."items" \(/u,
    );
    expect(target).toContain('COPY "public"."items" ("id", "name") FROM STDIN');
    expect(target.at(-1)).toBe("COMMIT");
    const sent = made(m, "db.copy");
    expect(sent.map((p) => p.data ?? "").join("")).toBe(ITEMS);
    expect(sent.at(-1)).toMatchObject({ done: true });
    expect(state()).toMatchObject({ status: "done", steps: [{ rows: 3, state: "done" }] });
    expect(state().result).toMatch(/^Copied 3 rows into Archive in [\d.,]+ (ms|s)\.$/u);
  });

  it("holds a copy whose report has a problem, and a failure rolls back", async () => {
    const held = await copying({ answer: { content: "data" } });
    expect(held.state()).toMatchObject({
      status: "held",
      problems: ["public.items is not on the target: copy its structure too."],
    });
    await expect(
      held.m.host.command("endue.database.transfer-start", { id: held.id }),
    ).rejects.toThrow("public.items is not on the target");
    const { m, id, state } = await copying({ fail: /^CREATE TABLE/u });
    await expect(m.host.command("endue.database.transfer-start", { id })).rejects.toThrow(
      /Not copied: Archive: relation "public.items" already exists/u,
    );
    const target = m.sessions().find((s) => s.includes("BEGIN")) ?? [];
    expect(target.at(-1)).toBe("ROLLBACK");
    expect(target.some((q) => /FROM STDIN/u.test(q))).toBe(false);
    expect(state().status).toBe("failed");
  });

  it("a read-only target is refused, and a production one asks first", async () => {
    const locked = await mount({
      store: { connections: [PG, LOCKED] },
      script: transferScript(),
      dialog: () => ({ target: LOCKED.id, schema: "public", name: "items", content: "both" }),
    });
    await expect(
      locked.host.command("endue.database.transfer", {
        connection: PG.name,
        schema: "public",
        table: "items",
      }),
    ).rejects.toThrow("Locked is read-only: nothing is copied into it.");
    const { m, id } = await copying({ answer: { target: "c-prod" }, pick: () => "" });
    await expect(m.host.command("endue.database.transfer-start", { id })).rejects.toThrow(
      /Not copied/u,
    );
    expect(m.picks.at(-1)?.title).toBe("Copy into Prod?");
    expect(made(m, "db.copy")).toEqual([]);
  });
});
