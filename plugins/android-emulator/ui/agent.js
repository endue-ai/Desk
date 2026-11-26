// The tools share the active emulator's controller. A review names the current connection, so an
// accepted action cannot spill over when another emulator connects while the card is open.
import { environmentSteps } from "./environment.js";

const ID = "endue.android-emulator";
const diagnostics = { "app-launch": "launch", "app-memory": "memory", "app-frames": "frames" };
const agent = (caller) => caller?.startsWith("agent:");
const desk = (caller) => !caller || caller === "desk" || caller === "palette";

function text(value, what) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Name ${what}.`);
  return value;
}

function point(value, { drawn, paused, width, height }) {
  if (
    !drawn ||
    paused ||
    !Number.isInteger(value?.x) ||
    !Number.isInteger(value?.y) ||
    value.x < 0 ||
    value.y < 0 ||
    value.x >= width ||
    value.y >= height
  )
    throw new Error("Choose a point inside the current Android preview.");
  return { x: value.x, y: value.y };
}

export function installAgentTools(
  commands,
  { state, operate, android, display, tools, disconnect },
) {
  commands.on(`${ID}.state`, state);
  const target = (args) => text(args?.session, "the exact connected session from Android state");
  const local = (name, effect) =>
    commands.on(`${ID}.${name}`, (args, invocation) => {
      const caller = invocation?.caller;
      if (!desk(caller) && !agent(caller)) throw new Error("This action belongs to the desk.");
      if (state().session?.id !== target(args)) throw new Error("That emulator session changed.");
      effect();
      return state();
    });
  local("disconnect", disconnect);
  local("pause-preview", () => display.setPaused(true));
  commands.on(`${ID}.operate`, async (args, invocation) => {
    const caller = invocation?.caller;
    if (agent(caller) ? !invocation?.approved : !desk(caller))
      throw new Error("The person must review the emulator action.");
    const id = target(args);
    const result = await operate(async (session) => {
      const { serial, signal } = session;
      switch (args.action) {
        case "key":
          await android.key(serial, text(args.key, "an Android key"), signal);
          return "Sent the key.";
        case "tap": {
          const at = point(args.from, display.state());
          await android.gesture(serial, at, at, 0, signal);
          return "Tapped the preview.";
        }
        case "swipe": {
          const screen = display.state();
          if (!Number.isFinite(args.durationMs)) throw new Error("Give a finite swipe duration.");
          await android.gesture(
            serial,
            point(args.from, screen),
            point(args.to, screen),
            args.durationMs,
            signal,
          );
          return "Swiped the preview.";
        }
        case "rotate":
          return android.rotate(serial, signal);
        case "conditions": {
          if (!args.values || typeof args.values !== "object" || Array.isArray(args.values))
            throw new Error("Give the exact device conditions.");
          environmentSteps(args.values);
          return `Applied ${await android.apply(serial, args.values, signal)} device changes.`;
        }
        case "resume-preview":
          display.setPaused(false);
          return "Resumed the preview.";
        case "list-apps":
          await tools.loadApps(session);
          return "Refreshed the app list.";
        case "list-snapshots":
          await tools.loadSnapshots(session);
          return "Refreshed the snapshot list.";
        case "snapshot-save":
        case "snapshot-load": {
          const name = text(args.name, "a snapshot");
          const load = args.action === "snapshot-load";
          if (load && !tools.state().snapshots.includes(name))
            throw new Error("Choose a snapshot from the connected device's list.");
          await android.snapshot(serial, load ? "load" : "save", name, signal);
          if (!load) await tools.loadSnapshots(session);
          return load ? `Restored ${name}.` : `Saved ${name}.`;
        }
        case "app-launch":
        case "app-memory":
        case "app-frames": {
          const name = text(args.name, "an installed app");
          if (!tools.state().apps.includes(name))
            throw new Error("Choose an app from the connected device's list.");
          return tools.inspect(session, name, diagnostics[args.action]);
        }
        case "power-off":
          await android.powerOff(serial, signal);
          return `Shut down ${session.label}.`;
        default:
          throw new Error("Choose a listed emulator operation.");
      }
    }, id);
    if (args.action === "power-off" && state().session?.id === id) disconnect(result);
    return { result: result?.slice(0, 64000), state: state() };
  });
}
