// A command's arguments, asked in the palette one at a time (#304), without a DOM so vitest can test
// it: the `required` properties of its argsSchema, in order, each free text or a pick of the values
// the schema declares (`enum`, or true and false). Enter answers one and moves on; on the last it
// runs the command with them, each read as its schema's type. Escape steps back one, then out.

/**
 * @typedef {{ name: string, title: string, type: string, pick: string[] | null }} Question
 * @typedef {{ id: string, label: string, questions: Question[], at: number, values: Record<string, unknown> }} Asking
 */

/** @param {unknown} value */
const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The questions a command asks before it runs: its schema's required properties, in order.
 * @param {unknown} schema
 * @returns {Question[]}
 */
export function questions(schema) {
  if (!object(schema)) return [];
  const { required, properties } = /** @type {{ required?: unknown, properties?: unknown }} */ (
    schema
  );
  if (!Array.isArray(required)) return [];
  const props = object(properties) ? /** @type {Record<string, any>} */ (properties) : {};
  return required
    .filter((name) => typeof name === "string")
    .map((name) => {
      const prop = object(props[name]) ? props[name] : {};
      const type = typeof prop.type === "string" ? prop.type : "string";
      const choices = Array.isArray(prop.enum)
        ? prop.enum.map(String)
        : type === "boolean"
          ? ["true", "false"]
          : null;
      const title =
        typeof prop.title === "string"
          ? prop.title
          : typeof prop.description === "string"
            ? prop.description
            : name;
      return { name, title, type, pick: choices };
    });
}

/**
 * Asking a command's arguments from the first.
 * @param {{ id: string, label: string, argsSchema?: unknown }} entry
 * @returns {Asking}
 */
export function start(entry) {
  return {
    id: entry.id,
    label: entry.label,
    questions: questions(entry.argsSchema),
    at: 0,
    values: {},
  };
}

/**
 * An answer as its schema's type; a string saying why when it does not read as one.
 * @param {Question} question
 * @param {string} text
 * @returns {{ value: unknown } | { invalid: string }}
 */
function read(question, text) {
  const typed = text.trim();
  if (question.type === "integer" || question.type === "number") {
    const n = Number(typed);
    const whole = question.type === "integer";
    if (typed === "" || !Number.isFinite(n) || (whole && !Number.isInteger(n)))
      return { invalid: `${question.title}: type ${whole ? "a whole number" : "a number"}` };
    return { value: n };
  }
  if (question.type === "boolean") return { value: typed === "true" };
  if (question.pick && !question.pick.includes(typed))
    return { invalid: `${question.title}: pick one of ${question.pick.join(", ")}` };
  if (typed === "") return { invalid: `${question.title}: type something` };
  return { value: question.pick ? typed : text };
}

/**
 * The person's answer to the question asked now: the next question, the command to run with every
 * answer once the last is given, or the same question again saying why.
 * @param {Asking} asking
 * @param {string} text
 * @returns {{ asking: Asking, invalid?: string, run?: undefined } | { run: string, args: Record<string, unknown> }}
 */
export function answer(asking, text) {
  const question = asking.questions[asking.at];
  if (!question) return { run: asking.id, args: { ...asking.values } };
  const got = read(question, text);
  if ("invalid" in got) return { asking, invalid: got.invalid };
  const values = { ...asking.values, [question.name]: got.value };
  if (asking.at + 1 >= asking.questions.length) return { run: asking.id, args: values };
  return { asking: { ...asking, at: asking.at + 1, values } };
}

/**
 * Escape: the question before, its answer kept, or null on the first (out to the commands).
 * @param {Asking} asking
 * @returns {Asking | null}
 */
export function back(asking) {
  if (asking.at === 0) return null;
  const at = asking.at - 1;
  const name = asking.questions[at]?.name;
  const values = Object.fromEntries(
    Object.entries(asking.values).filter(([key]) =>
      asking.questions.slice(0, at + 1).some((q) => q.name === key),
    ),
  );
  return { ...asking, at, values: name === undefined ? asking.values : values };
}

/**
 * What the palette shows for the question asked now, as a pick: the title, the choices or free
 * text, and the free text given before (stepping back), to change or keep.
 * @param {Asking} asking
 */
export function askingMode(asking) {
  const question = asking.questions[asking.at];
  const given = question ? asking.values[question.name] : undefined;
  return {
    kind: "args",
    asking,
    title: `${asking.label} · ${question?.title ?? ""}`,
    placeholder: question?.pick ? "" : (question?.title ?? ""),
    query: given === undefined || question?.pick ? "" : String(given),
    free: !question?.pick,
    entries: (question?.pick ?? []).map((value) => ({ id: value, label: value })),
  };
}
