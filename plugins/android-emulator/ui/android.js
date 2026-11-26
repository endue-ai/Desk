import { appTools } from "./apps.js";
import { environmentSteps } from "./environment.js";

// adb treats the numeric loopback address as a remote host and refuses to start a missing daemon.
const server = ["-H", "localhost", "-P", "5037"];
const safeName = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const keys = {
  Back: 4,
  Home: 3,
  Recents: 187,
  Enter: 66,
  Backspace: 67,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  " ": 62,
};

function localSerial(value) {
  return (
    typeof value === "string" &&
    /^emulator-[1-9]\d{0,4}$/.test(value) &&
    Number(value.slice(9)) <= 65535
  );
}

export function parseDevices(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .flatMap((line) => {
      const [serial, state, ...fields] = line.trim().split(/\s+/);
      if (!localSerial(serial) || !state) return [];
      const transport = fields.find((field) => /^transport_id:[1-9]\d*$/.test(field));
      return [{ serial, state, ...(transport && { transportId: transport.slice(13) }) }];
    });
}

function consoleReply(text) {
  const failure = text.match(/^KO(?::\s*(.*))?\s*$/m);
  if (failure) throw new Error(failure[1]?.trim() || "The emulator refused the command.");
  return text.replace(/^OK\s*$/gm, "").trim();
}

export function snapshotNames(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(?:--|\d+)\s+(\S+)\s+/.exec(line);
    return match && safeName.test(match[1]) ? [match[1]] : [];
  });
}

function name(value, label) {
  if (typeof value !== "string" || !safeName.test(value))
    throw new Error(`Use letters, numbers, underscores, dots or hyphens for the ${label} name.`);
  return value;
}

export function createAndroid(procs) {
  const transports = new WeakMap();
  const rowsOf = async (signal) =>
    parseDevices(await procs.run("adb", [...server, "devices", "-l"], { signal }));
  function bindTransport(signal, transportId) {
    if (transportId) transports.set(signal, transportId);
    return signal;
  }
  async function verifyTransport(serial, signal) {
    const id = transports.get(signal);
    if (!id) throw new Error("Reconnect with current Android Platform-Tools to verify the device.");
    const rows = await rowsOf(signal);
    if (
      !rows.some((row) => row.serial === serial && row.state === "device" && row.transportId === id)
    )
      throw new Error("The emulator transport disappeared. Refresh the devices to reconnect.");
  }
  async function device(serial, args, options) {
    if (!localSerial(serial)) throw new Error("Select a running local Android emulator.");
    const transport = transports.get(options?.signal);
    const console = args[0] === "emu";
    // The SDK console addresses an emulator by its port, so verify the pinned transport first.
    if (transport && console) await verifyTransport(serial, options.signal);
    const target = transport && !console ? ["-t", transport] : ["-s", serial];
    const result = await procs.run("adb", [...server, ...target, ...args], options);
    return console ? consoleReply(result) : result;
  }

  async function devices(signal) {
    const rows = await rowsOf(signal);
    return Promise.all(
      rows.map(async (row) => {
        const avd =
          row.state === "device"
            ? await device(row.serial, ["emu", "avd", "name"], { signal }).catch(() => "")
            : "";
        return { ...row, avd };
      }),
    );
  }

  async function inventory(signal) {
    const [live, installed] = await Promise.allSettled([
      devices(signal),
      procs.run("emulator", ["-list-avds"], { signal }),
    ]);
    return {
      devices: live.status === "fulfilled" ? live.value : [],
      avds:
        installed.status === "fulfilled"
          ? installed.value
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter((s) => safeName.test(s))
          : [],
      warnings: [live, installed].flatMap((r) =>
        r.status === "rejected" ? [r.reason.message] : [],
      ),
    };
  }

  async function capture(serial, signal) {
    const image = await device(serial, ["exec-out", "screencap", "-p"], { binary: true, signal });
    const signature = new Uint8Array(await image.slice(0, 8).arrayBuffer());
    if (signature.join() !== "137,80,78,71,13,10,26,10")
      throw new Error(
        "The device did not return a PNG frame. Check that Android has finished starting.",
      );
    return image;
  }

  async function gesture(serial, from, to, duration, signal) {
    const coords = [from.x, from.y, to.x, to.y];
    if (!coords.every((n) => Number.isSafeInteger(n) && n >= 0) || !Number.isFinite(duration))
      throw new Error("Invalid touch coordinates.");
    const tap = from.x === to.x && from.y === to.y && duration < 450;
    const args = tap
      ? ["tap", ...coords.slice(0, 2)]
      : ["swipe", ...coords, Math.max(1, Math.min(5000, Math.round(duration)))];
    await device(serial, ["shell", "input", ...args.map(String)], { signal });
  }

  async function key(serial, key, signal) {
    if (Object.hasOwn(keys, key))
      return device(serial, ["shell", "input", "keyevent", String(keys[key])], { signal });
    if (!/^[!-~]$/.test(key))
      throw new Error("Use the Android on-screen keyboard for this character.");
    // adb shell joins its arguments again on the guest. Quote printable keys for that shell.
    return device(serial, ["shell", "input", "text", `'${key.replaceAll("'", "'\\''")}'`], {
      signal,
    });
  }

  async function apply(serial, values, signal) {
    const steps = environmentSteps(values);
    for (const [i, step] of steps.entries()) {
      try {
        await device(serial, step.args, { signal });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(
          `Applied ${i} of ${steps.length} changes. Could not set ${step.label}. ${error.message}`,
        );
      }
    }
    return steps.length;
  }

  async function snapshot(serial, action, tag, signal) {
    if (!["save", "load"].includes(action)) throw new Error("Choose a snapshot action.");
    await device(serial, ["emu", "avd", "snapshot", action, name(tag, "snapshot")], {
      timeout: 120000,
      signal,
    });
  }

  async function install(serial, path, signal) {
    if (
      typeof path !== "string" ||
      !/^(~\/|\/|[A-Za-z]:\/)/.test(path) ||
      !/\.apk$/i.test(path) ||
      /[\0\r\n]/.test(path)
    )
      throw new Error("Choose an APK file.");
    // The SDK tools run with the home directory as cwd. A leading ./ also protects a leading dash.
    const file = path.startsWith("~/") ? `./${path.slice(2)}` : path;
    const result = await device(serial, ["install", "-r", file], { timeout: 120000, signal });
    if (!/^Success\s*$/m.test(result))
      throw new Error(result.trim() || "Android did not confirm the installation.");
  }

  return {
    ...appTools(device),
    bindTransport,
    verifyTransport,
    inventory,
    devices,
    capture,
    key,
    gesture,
    apply,
    snapshot,
    install,
    launch: (avd) =>
      procs.start("emulator", ["-avd", name(avd, "AVD"), "-no-window"], { background: true }),
    rotate: (serial, signal) => device(serial, ["emu", "rotate"], { signal }),
    booted: async (serial, signal) =>
      (await device(serial, ["shell", "getprop", "sys.boot_completed"], { signal })).trim() === "1",
    powerOff: (serial, signal) => device(serial, ["emu", "kill"], { signal }),
    snapshots: async (serial, signal) =>
      snapshotNames(await device(serial, ["emu", "avd", "snapshot", "list"], { signal })),
    logs: (serial, level, signal) => {
      if (!["V", "D", "I", "W", "E", "F"].includes(level))
        throw new Error("Choose a log priority.");
      return device(serial, ["logcat", "-d", "-t", "300", "-v", "threadtime", `*:${level}`], {
        signal,
      });
    },
  };
}
