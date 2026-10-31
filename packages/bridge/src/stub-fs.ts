/**
 * The browser stub's files: fs.read (whole or a byte range, with the size) and fs.url over files
 * held in memory by bridge path ("~/Movies/clip.mp4"), as the core answers them
 * (specs/bridge/v0/README.md). fs.url answers a `data:` URL of the whole file: there is no
 * `desk-plugin` scheme here, and `blob:` URLs do not cross into a plugin's frame.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { FsReadPermission } from "./generated";

/** In-memory files by bridge path: text (stored as UTF-8) or bytes. */
export type StubFiles = Record<string, string | Uint8Array>;

/** The stub's grant check: throws permission_denied unless a grant covers `scope` and `fits`. */
type Check = (caller: string | undefined, scope: FsReadPermission, fits: boolean) => void;

export type FsServed = "fs.read" | "fs.url";

/** A bridge path pattern as desk-core matches it: `*` and `?` in one segment, `**` across. */
export function pathMatch(pattern: string, path: string): boolean {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i);
    if (c === "*" && pattern.charAt(i + 1) === "*") {
      source += ".*";
      i++;
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`).test(path) || `${path}/**` === pattern;
}

/** The media type for a file name, by its extension in any case, as desk-core's media_types.rs. */
export function mediaType(name: string): string {
  const extension = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  caf: "audio/x-caf",
  weba: "audio/webm",
  mka: "audio/x-matroska",
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  jxl: "image/jxl",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  vtt: "text/vtt",
};

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** fs.read and fs.url over `files`, each call checked as `check` says. */
export function stubFs(files: StubFiles, check: Check): Required<Pick<StubHandlers, FsServed>> {
  const bytes = new Map<string, Uint8Array>(
    Object.entries(files).map(([path, content]) => [
      path,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
    ]),
  );
  /** The file at `path` once the caller may read it: a grant covers the scope, the scope the path. */
  const open = (caller: string | undefined, path: string, scope: FsReadPermission) => {
    check(
      caller,
      scope,
      scope.paths.some((pattern) => pathMatch(pattern, path)),
    );
    const file = bytes.get(path);
    if (file) return file;
    if ([...bytes.keys()].some((p) => p.startsWith(`${path}/`)))
      throw new StubError("invalid_params", `${path} is a folder`);
    throw new StubError("not_found", `${path} does not exist`);
  };
  return {
    "fs.read": ({ path, encoding = "utf8", offset = 0, length, scope }, caller) => {
      const file = open(caller, path, scope);
      const start = Math.min(offset, file.length);
      const end = length === undefined ? file.length : Math.min(file.length, start + length);
      const part = file.subarray(start, end);
      const size = file.length;
      if (encoding === "base64") return { content: base64(part), encoding, size };
      try {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(part);
        return { content: text, encoding, size };
      } catch {
        const what = offset === 0 && length === undefined ? "the file is" : "the range is";
        throw new StubError("invalid_params", `${what} not UTF-8; read it as base64`);
      }
    },
    "fs.url": ({ path, scope }, caller) => {
      const file = open(caller, path, scope);
      const type = mediaType(path);
      return { url: `data:${type};base64,${base64(file)}`, size: file.length, type };
    },
  };
}
