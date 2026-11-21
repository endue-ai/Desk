const view = new URLSearchParams(location.search).get("view");
if (view === "palette") {
  await import("./palette");
} else {
  await import("./desk");
}

export {};
