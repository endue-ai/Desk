// The order of the first run's scenes and the small decisions between them. No DOM, so vitest can
// test it (plugins/onboarding/tests).

/** Scenes an interrupted first run picks up at, without the arrival. Earlier scenes start over. */
export const RESUMABLE = [
  "microphone",
  "name",
  "sign-in",
  "desk",
  "agents",
  "task",
  "layout",
  "outro",
];

/** A layout cannot be named once its screen is gone, so a first run quit there asks for a task again. */
export const RESUME_AT = { layout: "task" };

/**
 * The scenes after the greeting, in order. Skip intro moves the microphone and the name to the first
 * conversation, just before the first task. Outside the service region endue's agents do not join.
 */
export function order({ skipped = false, region = true } = {}) {
  const scenes = skipped
    ? ["sign-in", "desk", "agents", "microphone", "name", "task", "layout", "outro"]
    : ["microphone", "name", "sign-in", "desk", "agents", "task", "layout", "outro"];
  return region ? scenes : scenes.filter((scene) => scene !== "agents");
}

/** The microphone and the name are asked once: Skip intro can come after either. */
const done = (scene, state) =>
  (scene === "microphone" && Boolean(state.micAsked)) || (scene === "name" && Boolean(state.name));

/** The scene that follows `scene`, or null after the last one. */
export function nextScene(scene, state) {
  const scenes = order(state);
  const index = scenes.indexOf(scene);
  if (index < 0) return null;
  return scenes.slice(index + 1).find((next) => !done(next, state)) ?? null;
}

/** What has to stand already when a first run resumes at `scene`: the desk's frame, the agents. */
export function standing(scene, state) {
  const scenes = order(state);
  const at = scenes.indexOf(scene);
  const passed = (name) => {
    const index = scenes.indexOf(name);
    return index >= 0 && index < at;
  };
  return { frame: passed("desk"), agents: passed("agents") };
}

/** A name as Eris keeps it: trimmed, at most 24 characters. */
export function cleanName(value) {
  return value.trim().slice(0, 24);
}

/** A layout's name: "Morning." is kept as "Morning". */
export function layoutName(value) {
  return cleanName(value.replace(/[\s.!?。]+$/u, ""));
}

const normal = (text) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[\s.!?]+$/u, "");

/** The examples scene 8 offers: each one needs its source connected, the last needs nothing. */
export function examplesFor(connections, examples) {
  return examples.filter(
    (example) => example.needs === null || connections.includes(example.needs),
  );
}

/** The example a typed task is, or null when it is something else (Eris builds a screen for it). */
export function matchExample(text, examples) {
  return examples.find((example) => normal(example.text) === normal(text))?.kind ?? null;
}
