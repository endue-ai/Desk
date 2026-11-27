import { snapshot } from "./topology.js";

const profiler = (type) => ["/usr/sbin/system_profiler", "-json", type];
export const reports = {
  hardware: profiler("SPHardwareDataType"),
  battery: ["/usr/bin/pmset", "-g", "batt"],
  thermal: ["/usr/bin/pmset", "-g", "therm"],
  batterySensors: ["/usr/sbin/ioreg", "-r", "-c", "AppleSmartBattery", "-d", "1", "-w", "0"],
  physicalSensors: ["/usr/sbin/ioreg", "-r", "-c", "IOHWSensor", "-d", "1", "-w", "0"],
  usb: ["/usr/sbin/ioreg", "-p", "IOUSB", "-w", "0"],
  interfaces: ["/sbin/ifconfig", "-a"],
  peers: ["/usr/sbin/arp", "-an"],
  neighbors6: ["/usr/sbin/ndp", "-an"],
  vpn: ["/usr/sbin/scutil", "--nc", "list"],
  wifi: profiler("SPAirPortDataType"),
  bluetooth: profiler("SPBluetoothDataType"),
  processes: ["/bin/ps", "-ww", "-axo", "pid=,pcpu=,rss=,comm="],
  sockets: ["/usr/sbin/lsof", "-nP", "-i", "-FpcfPnT"],
};

const MAX_BYTES = 4 * 1024 * 1024;

// Register before spawning: short jobs can emit output or exit before their spawn reply arrives.
/** @param {any} bridge @param {string[]} argv @param {AbortSignal} signal */
export async function readReport(bridge, argv, signal) {
  const [command, ...args] = argv;
  signal.throwIfAborted();
  const scope = { permission: "proc:spawn", commands: [command] };
  let procId;
  let finish;
  let early = [];
  let buffered = 0;
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  let exceeded = false;
  let timer;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    if (procId) void bridge.call("proc.kill", { procId, scope, signal: "kill" }).catch(() => {});
    finish(null);
  }
  function feed(event) {
    if (stopped) return;
    const data = event.data;
    if (event.event === "proc.exit") {
      // lsof returns 1 when no files match. Do not interpret diagnostics as an empty table.
      finish(
        !exceeded &&
          (data.code === 0 ||
            (command === "/usr/sbin/lsof" && data.code === 1 && !text && !hadError))
          ? text + decoder.decode()
          : null,
      );
    } else if (data.stream === "stderr") {
      hadError = true;
    } else {
      const bytes =
        data.encoding === "base64"
          ? Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))
          : new TextEncoder().encode(data.data);
      size += bytes.length;
      if (size > MAX_BYTES) {
        exceeded = true;
        stop();
        return;
      }
      text += decoder.decode(bytes, { stream: true });
    }
  }
  let hadError = false;
  const off = bridge.onEvent((event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    if (procId === event.data.procId) feed(event);
    else if (!procId && !exceeded) {
      buffered += event.data.data?.length ?? 1;
      if (buffered > MAX_BYTES * 2) exceeded = true;
      else early.push(event);
    }
  });
  try {
    ({ procId } = await bridge.call("proc.spawn", { command, args, scope }));
    if (signal.aborted || exceeded) {
      stop();
      return null;
    }
    signal.addEventListener("abort", stop, { once: true });
    timer = setTimeout(stop, 30000);
    for (const event of early) if (event.data.procId === procId) feed(event);
    early = [];
    return await completed;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    off();
  }
}

export async function collect(ctx, signal, askAgain = false) {
  const scope = {
    permission: "proc:spawn",
    commands: [...new Set(Object.values(reports).map(([program]) => program))],
  };
  const reason = ctx.messages.t("grant");
  const grant = askAgain
    ? await ctx.bridge.call("perm.request", { permission: scope, reason, again: true })
    : await ctx.perm.request(scope, reason);
  if (!grant.granted) throw Error("denied");
  const queue = Object.entries(reports);
  const values = {};
  async function worker() {
    while (queue.length && !signal.aborted) {
      const [key, argv] = queue.shift();
      values[key] = await readReport(ctx.bridge, argv, signal).catch(() => null);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  signal.throwIfAborted();
  if (Object.values(values).every((value) => value === null)) throw Error("failed");
  return snapshot(values);
}
