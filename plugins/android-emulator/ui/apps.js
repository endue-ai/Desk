const packageName = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

// Each command takes a package returned by Android's package manager. am -W reports the
// activity and launch timing. meminfo and gfxinfo describe the app that is currently running.
export function appTools(device) {
  return {
    async packages(serial, signal) {
      const result = await device(serial, ["shell", "pm", "list", "packages", "-3"], { signal });
      return result
        .split(/\r?\n/)
        .filter((line) => line.startsWith("package:"))
        .map((line) => line.slice(8).trim())
        .filter((id) => packageName.test(id))
        .sort();
    },
    async inspectApp(serial, id, action, signal) {
      if (typeof id !== "string" || !packageName.test(id))
        throw new Error("Select an installed app first.");
      if (action === "launch") {
        const reply = await device(
          serial,
          [
            "shell",
            "cmd",
            "package",
            "resolve-activity",
            "--brief",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
            "-p",
            id,
          ],
          { signal },
        );
        const component = reply
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(
            (line) =>
              line.startsWith(`${id}/`) && /^\.?[A-Za-z_$][\w.$]*$/.test(line.slice(id.length + 1)),
          );
        if (!component) throw new Error("This app has no launcher activity.");
        return (
          await device(serial, ["shell", "am", "start", "-W", "-n", `'${component}'`], {
            signal,
            timeout: 30000,
          })
        ).trim();
      }
      const query = {
        memory: ["dumpsys", "meminfo", "-s", id],
        frames: ["dumpsys", "gfxinfo", id],
      };
      if (!Object.hasOwn(query, action)) throw new Error("Choose an app diagnostic.");
      const text = (
        await device(serial, ["shell", ...query[action]], { signal, timeout: 30000 })
      ).trim();
      if (!text || /^No process found/m.test(text))
        throw new Error("Start the app on the emulator and try again.");
      if (action === "frames") {
        const summary = text
          .split(/\r?\n/)
          .filter((line) =>
            /^(?:\*\* Graphics info|Total frames rendered|Janky frames|(?:50th|90th|95th|99th) percentile)/.test(
              line,
            ),
          );
        if (!summary.some((line) => line.startsWith("Total frames rendered")))
          throw new Error("No frame statistics yet. Open the app and interact with it first.");
        return summary.join("\n");
      }
      return text;
    },
  };
}
