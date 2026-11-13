const view = new URLSearchParams(location.search).get("view");
if (view === "palette") {
  await import("./palette");
} else if (view === "island") {
  // The island over every app (ADR 0204), on the shell's commands and events.
  const [{ startIsland }, { invoke, listen }] = await Promise.all([
    import("./island"),
    import("./host"),
  ]);
  await startIsland({ invoke, listen });
} else {
  await import("./desk");
}

export {};
