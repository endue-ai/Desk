const view = new URLSearchParams(location.search).get("view");
if (view === "palette") {
  await import("./palette");
} else if (view === "eris") {
  // The floating Eris window over the OS (ADR 0121).
  const [{ startErisWindow }, { invoke }, { listen }] = await Promise.all([
    import("./eris-window"),
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  await startErisWindow({ invoke, listen });
} else {
  await import("./desk");
}

export {};
