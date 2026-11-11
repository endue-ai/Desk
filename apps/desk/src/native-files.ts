// Files from the OS: the file picker. The CEF shell (#45) answers the dialog's command
// (`plugin:dialog|open`, apps/desk/shell/src/dialog.rs). Drags from Finder, Explorer or a file
// manager reach the desk through the compositor's input (#56, ADR 0150): its broker hands the paths
// to the plugin under the pointer as `desk/paths`, and a drop nobody takes opens through the opened
// files' queue (`open-files.ts`). Stage 1's windowed browser told this page that files entered and
// the page followed the drag itself; that path went with the windowed desk (#83).
import { invoke } from "./host";

/** Native paths only: DOM File.name and browser URLs are not filesystem authority. */
export function localPath(value: string): string | null {
  if (!value || value.includes("\0")) return null;
  if (value.startsWith("/")) return value;
  // POSIX filenames may contain backslashes; only Windows paths need separator conversion.
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\")) return value.replaceAll("\\", "/");
  return null;
}

/**
 * The shell's name for a file the desk opens (`real_path`, apps/desk/shell/src/real_path.rs): the
 * folders above it followed through their links, the home folder as `~`, so one file is one buffer.
 * The path as given when the shell cannot say.
 */
export async function realNativePath(path: string): Promise<string> {
  const real = await invoke<unknown>("real_path", { path }).catch(() => undefined);
  return typeof real === "string" && real !== "" ? real : path;
}

export async function pickNativeFile(): Promise<string | null> {
  const options = { multiple: false, directory: false };
  const path = await invoke<string | string[] | null>("plugin:dialog|open", { options });
  return typeof path === "string" ? localPath(path) : null;
}
