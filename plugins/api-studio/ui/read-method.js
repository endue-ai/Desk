// An unattended saved send uses a safe HTTP method with no body or method override.
export const READ_METHODS = Object.freeze(["GET", "HEAD", "OPTIONS"]);
export const READ_ONLY_ERROR =
  "The saved read command accepts GET, HEAD or OPTIONS without a body or method override.";

/** @param {import("./curl-config.js").Prepared} prep */
export function isReadRequest(prep) {
  return (
    READ_METHODS.includes(prep.method) &&
    prep.body.kind === "none" &&
    !prep.headers.some((header) => /^x-(?:http-)?method(?:-override)?$/iu.test(header.key.trim()))
  );
}
