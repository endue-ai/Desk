if (new URLSearchParams(location.search).get("view") === "palette") {
  await import("./palette");
} else {
  await import("./desk");
}

export {};
