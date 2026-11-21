import type { LocalAgentRun } from "@endue-ai/bridge";

const TAU = 2 * Math.PI;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HOME = 0.65;

export function fleetOf(
  runs: readonly Pick<LocalAgentRun, "runId" | "state" | "caller">[],
  delegated: readonly string[],
): string[] {
  return runs
    .filter(
      (run) =>
        run.state === "running" && (run.caller === "agent:eris" || delegated.includes(run.runId)),
    )
    .map((run) => run.runId);
}

interface Moon {
  id: string;
  slot: number;
  since: number;
}

export class Slots {
  #moons = new Map<string, Moon>();
  update(ids: readonly string[], now: number): Moon[] {
    const current = new Set(ids);
    for (const id of this.#moons.keys()) if (!current.has(id)) this.#moons.delete(id);
    const used = new Set(Array.from(this.#moons.values(), (moon) => moon.slot));
    for (const id of ids) {
      if (this.#moons.has(id)) continue;
      let slot = 0;
      while (used.has(slot)) slot++;
      this.#moons.set(id, { id, slot, since: now });
      used.add(slot);
    }
    return [...this.#moons.values()];
  }
}

/** Project each orbital plane through the same camera. Positive depth is in front of the shell. */
export function helperPose({ slot, since }: Moon, now: number, reduced: boolean) {
  const node = -0.36 + slot * GOLDEN_ANGLE;
  const tilt = ((68 + ((slot * 7) % 15)) * Math.PI) / 180;
  const phase = reduced
    ? 0
    : 0.82 + slot * GOLDEN_ANGLE - (TAU * (now - since)) / (4800 + (slot % 3) * 320);
  const radius = 63 + (slot % 3) * 2;
  const u = radius * Math.cos(phase);
  const v = radius * Math.sin(phase) * Math.cos(tilt);
  const z = radius * Math.sin(phase) * Math.sin(tilt);
  const scale = 350 / (350 - z);
  return {
    x: scale * (u * Math.cos(node) - v * Math.sin(node)),
    y: scale * (u * Math.sin(node) + v * Math.cos(node)),
    z,
    scale,
  };
}

export class Dysnomia {
  #angle = HOME;
  #entry = HOME;
  #thinking = false;
  #since = 0;
  at(thinking: boolean, now: number, reduced: boolean) {
    if (thinking !== this.#thinking) {
      this.#since = now;
      this.#entry = this.#angle;
      this.#thinking = thinking;
    }
    const age = now - this.#since;
    if (reduced) this.#angle = HOME;
    else if (thinking) this.#angle = this.#entry - (TAU * age) / 6600;
    else {
      const delta = Math.atan2(Math.sin(this.#entry - HOME), Math.cos(this.#entry - HOME));
      const t = Math.min(1, age / 660);
      this.#angle = HOME + delta * (1 - t * t * (3 - 2 * t));
    }
    const a = this.#angle;
    return { x: 65 * Math.cos(a), y: 50 * Math.sin(a), z: 18 * Math.sin(a), scale: 1 };
  }
}
