/** The sum of a buffer's bytes. @param {Uint8Array} bytes */
export const sum = (bytes) => bytes.reduce((total, byte) => total + byte, 0);
