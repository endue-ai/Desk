function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export const transportLost = (message) =>
  /(?:device|transport) (?:'[^']+' |id \d+ )?(?:not found|offline|disconnected|disappeared)|no devices\/emulators found/i.test(
    message,
  );

// A serial identifies an attached session. A launch initially has only an AVD name, and may
// discover several other emulators before the one it started is ready.
export function createConnection(android, changed) {
  let current;
  function disconnect(message = "Choose a local device to connect.") {
    const old = current;
    current = undefined;
    old?.controller.abort();
    if (old && !old.ready) void old.launch?.stop();
    changed({ phase: "idle", message });
  }

  async function open(target) {
    disconnect();
    const session = { controller: new AbortController(), ready: false };
    current = session;
    const { signal } = session.controller;
    const label = target.avd || target.serial;
    changed({ phase: "starting", message: `Waiting for ${label} to start Android…` });
    const deadline = Date.now() + 180000;
    try {
      let first = true;
      while (!signal.aborted) {
        const rows = await android.devices(signal);
        signal.throwIfAborted();
        const row = rows.find((d) =>
          target.serial ? d.serial === target.serial : d.avd === target.avd,
        );
        if (
          target.serial &&
          row &&
          ((target.avd && row.avd && row.avd !== target.avd) ||
            (target.transportId && row.transportId !== target.transportId))
        )
          throw new Error(
            "Another emulator is using this serial. Refresh the devices before connecting.",
          );
        if (
          row?.state === "device" &&
          (await android.booted(row.serial, signal).catch((error) => {
            if (!signal.aborted && transportLost(error.message)) return false;
            throw error;
          }))
        ) {
          signal.throwIfAborted();
          session.ready = true;
          session.serial = row.serial;
          session.label = row.avd || row.serial;
          changed({
            phase: "connected",
            serial: row.serial,
            label: session.label,
            transportId: row.transportId,
            signal,
            message: `Connected to ${session.label} · ${row.serial}`,
          });
          return;
        }
        if (first && !row && !target.serial) {
          const launched = await android.launch(target.avd);
          session.launch = launched;
          if (signal.aborted) {
            void launched.stop();
            return;
          }
          const ended = (error) => {
            if (current === session) disconnect(error?.message || `${label} has stopped.`);
          };
          launched.done.then(() => ended(), ended);
        } else if (!row && target.serial)
          throw new Error(`${label} disconnected. Refresh the devices.`);
        first = false;
        if (Date.now() >= deadline)
          throw new Error(
            `${label} did not finish starting. Check the AVD in Device Manager and try again.`,
          );
        await wait(1000, signal);
      }
    } catch (error) {
      if (current === session) disconnect(error.message);
    }
  }

  return { open, disconnect };
}
