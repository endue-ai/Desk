// Value sets shared by the runtime command handlers and manifest contract tests.
export const CONTAINER_OPERATIONS = /** @type {const} */ ([
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
  "kill",
  "remove",
]);

export const PRUNE_ARGS = {
  containers: ["container", "prune", "--force"],
  dangling: ["image", "prune", "--force"],
  images: ["image", "prune", "--all", "--force"],
  cache: ["builder", "prune", "--force"],
  networks: ["network", "prune", "--force"],
  volumes: ["volume", "prune", "--all", "--force"],
};
