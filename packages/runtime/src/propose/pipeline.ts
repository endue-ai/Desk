/**
 * Eris proposes desk data from a sentence (ADR 0073). The pipeline asks the brain for a value of a
 * kind's schema, with the sentence and what the desk has (the kind's context); checks the answer and
 * asks once more with what was wrong; previews it; and applies it when the person says so, keeping
 * what it applied so it can be undone. A kind says what differs: its schema, context, check, preview,
 * apply and undo. Views are the first (`view.ts`); profiles and key bindings follow (#340).
 */
import type { NoticeInput } from "../notify";
import type { Asker, AskTool } from "./asker";

export interface Request {
  /** What the person said. */
  text: string;
  /** What they asked to change since, oldest first. */
  corrections: string[];
  /** The proposal they asked to change. */
  previous?: unknown;
}

/** The person's answer to a preview. */
export type Choice =
  | { choice: "apply" }
  | { choice: "retry"; correction?: string }
  | { choice: "discard" };

/** What apply did, for the notice and for undo. */
export interface Applied {
  id: string;
  /** What the person calls it. */
  title: string;
  /** Where it went: `~/.desk/views/eris.x.yaml`. */
  where: string;
}

export interface ProposalKind<T = unknown> {
  readonly kind: string;
  /** What one is called in sentences: "view". */
  readonly noun: string;
  /** What the brain is told about the kind beside its schema. */
  readonly guide: string;
  /** The tool brain.ask answers through. */
  tool(): AskTool;
  /** The schema brain.say's prompt carries. */
  compact(): Record<string, unknown>;
  /** What the desk has that the brain may use; never the person's items themselves. */
  context(): Promise<unknown>;
  /** Fill in the desk's part and check the answer: the value, or each problem as `<pointer>: <what>`. */
  check(answer: unknown, request: Request): Promise<{ value: T } | { problems: string[] }>;
  /** Show it and wait for the person. */
  preview(value: T, request: Request): Promise<Choice>;
  /** Take a preview away (the pipeline gave up after Try again). */
  dismiss(): Promise<void>;
  apply(value: T, request: Request): Promise<Applied>;
  undo(applied: Applied): Promise<void>;
}

/** Eris's side: one line of soul text, and her pose while she works. */
export interface Eris {
  say(text: string): void;
  setState(state: "thinking" | "idle"): void;
}

export type Outcome =
  | { status: "applied"; kind: string; id: string }
  | { status: "discarded" }
  | { status: "failed"; problems: string[] }
  | { status: "busy" };

export interface ProposalsOptions {
  asker: Asker;
  /** Each with its own value type: a kind's methods take it bivariantly. */
  kinds: ProposalKind[];
  notify(input: NoticeInput): void;
  eris?: Eris;
}

export interface Proposals {
  propose(kind: string, text: string): Promise<Outcome>;
  /** Take back the last thing applied, or the one with `id`; only this session's. */
  undo(args?: { kind?: string; id?: string }): Promise<{ kind: string; id: string }>;
}

/** Problems a retry repeats to the brain, and a notice names. */
const SHOWN = 6;

export function createProposals(options: ProposalsOptions): Proposals {
  const kinds = new Map(options.kinds.map((kind) => [kind.kind, kind]));
  const applied: Array<{ kind: string; done: Applied }> = [];
  const { eris } = options;
  let drafting = false;
  const notify = (title: string, level: NoticeInput["level"], body?: string) =>
    options.notify({ caller: "desk", title, level, ...(body ? { body } : {}) });
  const kindOf = (name: string) => {
    const kind = kinds.get(name);
    if (!kind) throw new Error(`desk.propose: no kind ${name} (kinds: ${[...kinds.keys()]})`);
    return kind;
  };

  /** Ask, check, and ask once more with what was wrong. */
  const draft = async <T>(kind: ProposalKind<T>, request: Request) => {
    const context = await kind.context();
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const said = problems;
      const answer = await options.asker.ask({
        prompt: (budget) => promptFor(kind, request, context, said, budget),
        tool: kind.tool(),
        compact: kind.compact(),
      });
      if (answer.value === undefined) {
        problems = ["/: the answer held no JSON object"];
        continue;
      }
      const checked = await kind.check(answer.value, request);
      if ("value" in checked) return checked;
      problems = checked.problems;
    }
    return { problems };
  };

  const failed = (title: string, problems: string[], line: string) => {
    notify(title, "error", problems.slice(0, SHOWN).join("; "));
    eris?.say(line);
    return { status: "failed" as const, problems };
  };

  return {
    async propose(name, text) {
      const kind = kindOf(name);
      if (drafting) {
        notify("Eris is still making the last one", "info");
        return { status: "busy" };
      }
      const request: Request = { text, corrections: [] };
      let shown = false;
      for (;;) {
        eris?.setState("thinking");
        drafting = true;
        let drafted: { value: unknown } | { problems: string[] };
        try {
          drafted = await draft(kind, request);
        } catch (error) {
          // The brain could not answer: say its own sentence.
          if (shown) await kind.dismiss().catch(() => {});
          const why = error instanceof Error ? error.message : String(error);
          return failed(`Eris could not make that ${kind.noun}`, [why], why);
        } finally {
          drafting = false;
        }
        if (!("value" in drafted)) {
          if (shown) await kind.dismiss().catch(() => {});
          const line = `I couldn't make a ${kind.noun} from that. Try saying it another way.`;
          return failed(`Eris could not make that ${kind.noun}`, drafted.problems, line);
        }
        const choice = await kind.preview(drafted.value, request);
        shown = true;
        if (choice.choice === "retry") {
          if (choice.correction) request.corrections.push(choice.correction);
          request.previous = drafted.value;
          continue;
        }
        if (choice.choice !== "apply") {
          eris?.setState("idle");
          return { status: "discarded" };
        }
        let done: Applied;
        try {
          done = await kind.apply(drafted.value, request);
        } catch (error) {
          await kind.dismiss().catch(() => {});
          const why = error instanceof Error ? error.message : String(error);
          const line = `I couldn't save that ${kind.noun}.`;
          return failed(`Eris could not save that ${kind.noun}`, [why], line);
        }
        applied.push({ kind: kind.kind, done });
        notify(`Eris made “${done.title}”`, "success", done.where);
        eris?.say(`I made “${done.title}” and saved it in your ${kind.noun}s.`);
        return { status: "applied", kind: kind.kind, id: done.id };
      }
    },

    async undo(args = {}) {
      const at =
        args.id === undefined
          ? applied.length - 1
          : applied.findIndex(
              ({ kind, done }) => done.id === args.id && (!args.kind || kind === args.kind),
            );
      const found = applied[at];
      if (!found) throw new Error("Nothing Eris made is left to undo.");
      await kindOf(found.kind).undo(found.done);
      applied.splice(at, 1);
      notify(`Removed “${found.done.title}”`, "info", found.done.where);
      eris?.say(`I took “${found.done.title}” away.`);
      return { kind: found.kind, id: found.done.id };
    },
  };
}

/**
 * The question for the brain in at most `budget` characters: the sentence, the corrections, the
 * kind's guide, what the desk has, the last proposal and what was wrong with the last answer. When it
 * would not fit, the last proposal goes first, then the context.
 */
export function promptFor(
  kind: Pick<ProposalKind, "noun" | "guide">,
  request: Request,
  context: unknown,
  problems: string[],
  budget: number,
): string {
  const head = [
    `Make a desk ${kind.noun} from what the person said: “${request.text}”.`,
    ...(request.corrections.length
      ? [
          `Then they asked for changes, in order: ${request.corrections.map((c) => `“${c}”`).join(", ")}.`,
        ]
      : []),
    kind.guide,
  ];
  const tail = problems.length
    ? [
        `Your last answer was not valid: ${problems.slice(0, SHOWN).join("; ")}. Answer again with these fixed.`,
      ]
    : [];
  const optional = [
    `The desk: ${JSON.stringify(context)}`,
    ...(request.previous === undefined
      ? []
      : [`Your last proposal: ${JSON.stringify(request.previous)}`]),
  ];
  for (let keep = optional.length; keep >= 0; keep--) {
    const text = [...head, ...optional.slice(0, keep), ...tail].join("\n\n");
    if (text.length <= budget) return text;
  }
  return [...head, ...tail].join("\n\n").slice(0, budget);
}
