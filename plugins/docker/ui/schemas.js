// Every command the plugin provides, with what an agent needs to call it: a description and a JSON
// Schema for its args. The ids, titles and keywords are the manifest's (a test keeps them equal);
// registering them again with cmd.register adds the description and schema, as the calendar does.

/** @typedef {{ id: string, title: string, keywords?: string[], description: string, args?: object }} CommandSpec */

const CONTAINER = { type: "string", description: "A container's name or id" };
const PROJECT = { type: "string", description: "A Compose project's name" };
const FILE = { type: "string", description: "An absolute path to a Compose file" };
const object = (
  /** @type {Record<string, object>} */ properties,
  /** @type {string[]} */ required = [],
) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const onContainer = object({ container: CONTAINER });
const onProject = object({ project: PROJECT, file: FILE });
const STRINGS = { type: "array", items: { type: "string" } };

/** @type {CommandSpec[]} */
export const COMMANDS = [
  {
    id: "endue.docker.open",
    title: "Docker: open",
    keywords: ["containers", "whale", "engine"],
    description: "Show the Docker surface, on a list when view names one.",
    args: object({
      view: { enum: ["containers", "compose", "images", "volumes", "networks", "system"] },
    }),
  },
  {
    id: "endue.docker.refresh",
    title: "Docker: refresh",
    keywords: ["reload"],
    description: "Read what is on screen again.",
  },
  {
    id: "endue.docker.containers",
    title: "Docker: containers",
    keywords: ["ps", "list"],
    description:
      "Show and return the containers (all, or only running ones with all: false), with resource use when sampled.",
    args: object({ all: { type: "boolean" } }),
  },
  {
    id: "endue.docker.compose",
    title: "Docker: Compose projects",
    keywords: ["compose", "stack", "services"],
    description: "Show and return the Compose projects with their status and files.",
  },
  {
    id: "endue.docker.images",
    title: "Docker: images",
    keywords: ["image", "tags"],
    description: "Show and return the images.",
  },
  {
    id: "endue.docker.volumes",
    title: "Docker: volumes",
    keywords: ["volume", "storage"],
    description: "Show and return the volumes.",
  },
  {
    id: "endue.docker.networks",
    title: "Docker: networks",
    keywords: ["network"],
    description: "Show and return the networks.",
  },
  {
    id: "endue.docker.system",
    title: "Docker: engine and disk use",
    keywords: ["df", "version", "info"],
    description: "Show and return the engine's versions, the contexts and disk use.",
  },
  {
    id: "endue.docker.start",
    title: "Docker: start the container",
    keywords: ["run", "up"],
    description: "Start a stopped container.",
    args: onContainer,
  },
  {
    id: "endue.docker.stop",
    title: "Docker: stop the container",
    keywords: ["halt"],
    description: "Stop a container, killing it after the stop timeout.",
    args: onContainer,
  },
  {
    id: "endue.docker.restart",
    title: "Docker: restart the container",
    keywords: ["reboot"],
    description: "Restart a container.",
    args: onContainer,
  },
  {
    id: "endue.docker.pause",
    title: "Docker: pause the container",
    keywords: ["freeze"],
    description: "Pause every process in a container.",
    args: onContainer,
  },
  {
    id: "endue.docker.unpause",
    title: "Docker: unpause the container",
    keywords: ["resume"],
    description: "Resume a paused container.",
    args: onContainer,
  },
  {
    id: "endue.docker.kill",
    title: "Docker: kill the container",
    keywords: ["sigkill"],
    description: "Kill a container's processes at once. Asks first.",
    args: onContainer,
  },
  {
    id: "endue.docker.remove",
    title: "Docker: remove the container",
    keywords: ["rm", "delete"],
    description: "Remove a container, stopping it first when it runs. Asks first.",
    args: object({
      container: CONTAINER,
      volumes: { type: "boolean", description: "Also remove its anonymous volumes" },
    }),
  },
  {
    id: "endue.docker.logs",
    title: "Docker: logs",
    keywords: ["tail", "follow", "output"],
    description: "Show a container's or project's logs, following them unless follow is false.",
    args: object({
      container: CONTAINER,
      project: PROJECT,
      follow: { type: "boolean" },
      tail: { type: "integer", minimum: 0 },
    }),
  },
  {
    id: "endue.docker.tail",
    title: "Docker: read the last log lines",
    keywords: ["logs", "read"],
    description:
      "Return a container's or project's last log lines (both streams, in time order) without showing them.",
    args: object({
      container: CONTAINER,
      project: PROJECT,
      tail: { type: "integer", minimum: 0, maximum: 10000 },
      since: { type: "string", description: "A duration (10m) or a time (RFC 3339)" },
    }),
  },
  {
    id: "endue.docker.inspect",
    title: "Docker: container detail",
    keywords: ["inspect", "env", "mounts"],
    description:
      "Show and return a container's state, health, ports, mounts, networks, environment (secrets masked), labels and limits.",
    args: onContainer,
  },
  {
    id: "endue.docker.stats",
    title: "Docker: resource use",
    keywords: ["cpu", "memory", "top"],
    description:
      "Return one sample of every running container's CPU, memory, network and disk use.",
  },
  {
    id: "endue.docker.shell",
    title: "Docker: open a shell in the container",
    keywords: ["exec", "attach", "terminal"],
    description: "Open a terminal running a shell (or command) inside a running container.",
    args: object({
      container: CONTAINER,
      command: {
        ...STRINGS,
        description: "The program and its arguments; the shell setting when absent",
      },
    }),
  },
  {
    id: "endue.docker.run",
    title: "Docker: run a container from an image",
    keywords: ["create", "new"],
    description: "Start a new container in the background from an image.",
    args: object(
      {
        image: { type: "string" },
        name: { type: "string" },
        ports: { ...STRINGS, description: "[ip:][host:]container[/proto]" },
        env: { description: "KEY=value lines or an object" },
        volumes: { ...STRINGS, description: "source:target[:options]" },
        restart: { type: "string" },
        command: STRINGS,
      },
      ["image"],
    ),
  },
  {
    id: "endue.docker.pull",
    title: "Docker: pull an image",
    keywords: ["download", "update"],
    description: "Pull an image by its reference.",
    args: object({ image: { type: "string" } }),
  },
  {
    id: "endue.docker.remove-image",
    title: "Docker: remove the image",
    keywords: ["rmi", "delete"],
    description: "Remove an image no container uses. Asks first.",
    args: object({ image: { type: "string" } }),
  },
  {
    id: "endue.docker.prune-images",
    title: "Docker: remove dangling images",
    keywords: ["prune", "clean"],
    description: "Remove dangling images, or every unused one with all. Asks first.",
    args: object({ all: { type: "boolean" } }),
  },
  {
    id: "endue.docker.remove-volume",
    title: "Docker: remove the volume",
    keywords: ["delete"],
    description: "Remove a volume and its data. Asks first.",
    args: object({ volume: { type: "string" } }),
  },
  {
    id: "endue.docker.prune-volumes",
    title: "Docker: remove unused volumes",
    keywords: ["prune", "clean"],
    description: "Remove anonymous volumes no container uses, named ones too with all. Asks first.",
    args: object({ all: { type: "boolean" } }),
  },
  {
    id: "endue.docker.remove-network",
    title: "Docker: remove the network",
    keywords: ["delete"],
    description: "Remove a network. Asks first.",
    args: object({ network: { type: "string" } }),
  },
  {
    id: "endue.docker.prune-networks",
    title: "Docker: remove unused networks",
    keywords: ["prune", "clean"],
    description: "Remove every network no container uses. Asks first.",
  },
  {
    id: "endue.docker.up",
    title: "Docker: Compose up",
    keywords: ["compose", "start", "deploy"],
    description: "Create and start a Compose project's services in the background.",
    args: onProject,
  },
  {
    id: "endue.docker.down",
    title: "Docker: Compose down",
    keywords: ["compose", "teardown"],
    description:
      "Stop and remove a project's containers and networks; its volumes too with volumes. Asks first.",
    args: object({ project: PROJECT, file: FILE, volumes: { type: "boolean" } }),
  },
  {
    id: "endue.docker.compose-start",
    title: "Docker: start the Compose project",
    keywords: ["compose"],
    description: "Start a project's stopped services.",
    args: onProject,
  },
  {
    id: "endue.docker.compose-stop",
    title: "Docker: stop the Compose project",
    keywords: ["compose"],
    description: "Stop a project's services.",
    args: onProject,
  },
  {
    id: "endue.docker.compose-restart",
    title: "Docker: restart the Compose project",
    keywords: ["compose"],
    description: "Restart a project's services.",
    args: onProject,
  },
  {
    id: "endue.docker.compose-pull",
    title: "Docker: pull the Compose project's images",
    keywords: ["compose", "update"],
    description: "Pull the images a project's services use.",
    args: onProject,
  },
  {
    id: "endue.docker.open-file",
    title: "Docker: open the Compose file",
    keywords: ["compose", "yaml", "edit"],
    description: "Open a project's Compose file on the desk.",
    args: object({ project: PROJECT }),
  },
  {
    id: "endue.docker.prune",
    title: "Docker: clean up",
    keywords: ["system", "prune", "disk"],
    description:
      "Remove stopped containers, unused networks, dangling images and the build cache; unused images with all, anonymous volumes with volumes. Asks first.",
    args: object({ all: { type: "boolean" }, volumes: { type: "boolean" } }),
  },
  {
    id: "endue.docker.context",
    title: "Docker: switch context",
    keywords: ["engine", "remote", "host"],
    description:
      'Talk to another Docker context ("" for the CLI\'s current one). Picks when name is absent.',
    args: object({ name: { type: "string" } }),
  },
  {
    id: "endue.docker.cancel",
    title: "Docker: cancel the running operation",
    keywords: ["kill", "abort"],
    description: "Stop a pull, Compose up or other command still running.",
  },
];

/**
 * Register every command again with its description and schema. The manifest already declares
 * them, so this updates the plugin's own entries; a desk that refuses keeps the manifest's.
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 */
export function registerSchemas(bridge) {
  for (const { id, title, keywords, description, args } of COMMANDS) {
    void bridge
      .call("cmd.register", {
        id,
        title,
        description,
        ...(keywords ? { keywords } : {}),
        argsSchema: args ?? object({}),
      })
      .catch(() => {});
  }
}
