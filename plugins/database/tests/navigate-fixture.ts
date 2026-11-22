// Navigation's fixtures (PG-32): the shop catalog (pg-catalog.ts) read by the schema cache over the
// scripted server, its model, and the parse worker's resolver run in the test's thread, with a
// caret marked `|` in a text. Fixture data only.
import { problemModel } from "../ui/diagnose/model.js";
import type { SchemaModel } from "../ui/sql/parse/model.js";
import type { Name } from "../ui/sql/parse/scope.js";
import { createService } from "../ui/sql/parse/worker.js";
import { type PgCatalog, shop } from "./pg-catalog";
import { loadRaw } from "./problems-fixture";
import { cacheOver, PG } from "./schema-cache-helpers";

/** The schema cache's view of the shop, every schema but the system ones read. */
export async function shopView(model: () => PgCatalog = () => shop()) {
  const { cache } = cacheOver(model);
  await cache.open(PG);
  await cache.settled(PG);
  const view = cache.view(PG);
  if (!view) throw new Error("The cache holds nothing.");
  return view;
}

/** The parse worker's resolve over a model, answered in this thread. */
export async function resolver(model: SchemaModel) {
  const service = createService(await loadRaw());
  service.answer({ type: "model", key: 1, model });
  let id = 0;
  return (sql: string) => {
    const request = {
      id: ++id,
      type: "resolve",
      sql,
      model: 1,
      searchPath: ["$user", "public"],
      user: PG.user,
    };
    const reply = service.answer(request as never) as {
      result?: { names: Name[] };
      error?: string;
    };
    if (!reply.result) throw new Error(reply.error);
    return reply.result.names;
  };
}

/** The shop's view, its model and a resolver over it. */
export async function shopResolver() {
  const view = await shopView();
  const model = problemModel(PG.id, view as never);
  if (!model) throw new Error("No model.");
  return { view, model, resolve: await resolver(model) };
}

/** A text with its caret marked `|`. */
export const marked = (text: string) => ({ text: text.replace("|", ""), caret: text.indexOf("|") });

/** A parser whose worker is the parse worker's service in this thread (as the plugin's runs it). */
export async function threadWorker() {
  const raw = await loadRaw();
  return () => {
    const service = createService(raw);
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null,
      postMessage(message: Parameters<typeof service.answer>[0]) {
        const sent = structuredClone(message);
        setTimeout(() => {
          const reply = service.answer(sent);
          if (reply) worker.onmessage?.({ data: structuredClone(reply) });
        });
      },
      terminate: () => {},
    };
    return worker as unknown as Worker;
  };
}
