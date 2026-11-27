const MAX_INPUT = 32 * 1024 * 1024;
const MAX_EXPORT = 64 * 1024 * 1024;
const filters = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }];
const png = [{ name: "PNG image", extensions: ["png"] }];

export const nameOf = (path) => path.slice(path.lastIndexOf("/") + 1);

function exactPath(path) {
  if (
    typeof path !== "string" ||
    !/^(?:~|[a-z]:)?\//i.test(path) ||
    /[?*\\\0]/u.test(path) ||
    !nameOf(path)
  ) {
    throw new Error("Use the exact path to an image file.");
  }
  return path;
}

export function createFiles(ctx, byteSource) {
  const { bridge } = ctx;
  return {
    async choose() {
      const answer = await bridge.call("dialog.open", { title: "Open an image", filters });
      return answer.cancelled ? undefined : answer.paths[0];
    },
    async read(path) {
      path = exactPath(path);
      const source = await byteSource(ctx, {
        path,
        scope: { permission: "fs:read", paths: [path] },
      });
      if (source.size > MAX_INPUT) throw new Error("Choose an image file under 32 MiB.");
      return source.read(0, source.size);
    },
    async destination(source) {
      const name = nameOf(source).replace(/\.[^.]+$/u, "");
      const answer = await bridge.call("dialog.save", {
        title: "Export PNG",
        suggestedName: `${name.slice(0, 130)}-edited.png`,
        filters: png,
      });
      if (answer.cancelled || !answer.path) return undefined;
      const path = exactPath(answer.path);
      if (path === source || !/\.png$/iu.test(path)) {
        throw new Error("Choose a separate destination with a .png extension.");
      }
      return path;
    },
    async save(path, bytes) {
      if (bytes.length > MAX_EXPORT)
        throw new Error("Resize the image before exporting a PNG over 64 MiB.");
      const content = bytes.toBase64?.() ?? base64(bytes);
      const { bytesWritten } = await bridge.call("fs.write", {
        path,
        content,
        encoding: "base64",
        scope: { permission: "fs:write", paths: [path] },
      });
      if (bytesWritten !== bytes.length) throw new Error("The image was only partially saved.");
    },
  };
}

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}
