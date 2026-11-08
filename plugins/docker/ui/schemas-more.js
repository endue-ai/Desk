// The commands the redesign added (ADR 0114), with their descriptions and args schemas, after the
// first version's in schemas.js. Their ids, titles and keywords are the manifest's too.

/** @typedef {import("./schemas.js").CommandSpec} CommandSpec */

const LIST = { enum: ["containers", "compose", "images", "volumes", "networks"] };
const CONTAINER = { type: "string", description: "A container's name or id" };
const PATH = { type: "string", description: "An absolute path inside the container" };
const object = (
  /** @type {Record<string, object>} */ properties,
  /** @type {string[]} */ required = [],
) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

/** @type {CommandSpec[]} */
export const MORE_COMMANDS = [
  {
    id: "endue.docker.overview",
    title: "Docker: overview",
    keywords: ["dashboard", "summary", "status"],
    description:
      "Show and return the overview: the engine, containers counted by state, the Compose stacks, disk use per kind with what could be reclaimed, and the images, volumes and networks.",
  },
  {
    id: "endue.docker.filter",
    title: "Docker: filter the list",
    keywords: ["search", "find", "query"],
    description:
      "Show a list with only what matches: words, and terms like state:running, is:stopped, project:shop, image:postgres, port:8080 (a leading - negates). Empty shows all.",
    args: object({ view: LIST, query: { type: "string", maxLength: 200 } }, ["query"]),
  },
  {
    id: "endue.docker.sort",
    title: "Docker: sort the list",
    keywords: ["order"],
    description:
      "Sort a list: containers by name, state, cpu, memory, uptime or image; images by name, size, created or used; the others by name.",
    args: object({ view: LIST, key: { type: "string" }, desc: { type: "boolean" } }, ["key"]),
  },
  {
    id: "endue.docker.open-port",
    title: "Docker: open the container's port in the browser",
    keywords: ["web", "url", "localhost", "link"],
    description: "Open a container's published TCP port in the browser; picks when it has several.",
    args: object({
      container: CONTAINER,
      port: { type: "string", description: "Host or container port" },
    }),
  },
  {
    id: "endue.docker.history",
    title: "Docker: image history",
    keywords: ["layers", "image"],
    description: "Show and return an image's layers: the instruction each ran and its size.",
    args: object({ image: { type: "string" } }),
  },
  {
    id: "endue.docker.build",
    title: "Docker: build an image",
    irreversible: true,
    keywords: ["dockerfile", "image", "tag"],
    description:
      "Build an image from a Dockerfile (its folder the context unless one is named), showing BuildKit's steps as they run.",
    args: object(
      {
        dockerfile: { type: "string", description: "An absolute path to the Dockerfile" },
        tag: { type: "string" },
        context: { type: "string", description: "An absolute path to the build context" },
        pull: { type: "boolean" },
        noCache: { type: "boolean" },
      },
      ["dockerfile"],
    ),
  },
  {
    id: "endue.docker.files",
    title: "Docker: browse the container's files",
    keywords: ["ls", "folder", "explore"],
    description: "Show and return a folder of a running container, read with its own ls.",
    args: object({ container: CONTAINER, path: PATH }),
  },
  {
    id: "endue.docker.copy-out",
    title: "Docker: copy out of the container",
    irreversible: true,
    keywords: ["cp", "download", "export"],
    description: "Copy a file or folder of a container into a folder of this computer (docker cp).",
    args: object(
      {
        container: CONTAINER,
        path: PATH,
        dest: {
          type: "string",
          description:
            "A folder of this computer, absolute or home-relative (~/Downloads), or the new path the copy gets there",
        },
      },
      ["path"],
    ),
  },
  {
    id: "endue.docker.copy-in",
    title: "Docker: copy into the container",
    irreversible: true,
    keywords: ["cp", "upload", "import"],
    description:
      "Copy a file or folder of this computer into a folder of a container (docker cp); what a drop on a container or its Files tab runs.",
    args: object({
      container: CONTAINER,
      source: {
        type: "string",
        description: "A path of this computer, absolute or home-relative (~/seed.sql)",
      },
      path: PATH,
    }),
  },
];
