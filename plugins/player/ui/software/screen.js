// Draws the software player's decoded pictures on its canvas: WebGL with the Y, U and V planes as
// three LUMINANCE textures and a BT.601 or BT.709 shader for limited or full range; a 2D canvas with
// putImageData where WebGL is missing. A gray picture has only its Y plane. The canvas takes the
// picture's size and CSS keeps the aspect. Thin: jsdom has no canvas, so the tests use a fake.

/**
 * @typedef {{ width: number, height: number, planes: Uint8Array[], widths: number[],
 *   heights: number[], full: boolean, matrix: "bt601" | "bt709" }} Picture
 * @typedef {{ draw(picture: Picture): void, clear(): void, close(): void }} Screen
 */

/** Kr and Kb of each matrix (ITU-R BT.601 and BT.709). */
const K = { bt601: [0.299, 0.114], bt709: [0.2126, 0.0722] };

/**
 * How Y'CbCr becomes R'G'B': subtract `offset` and multiply by `scale` (both on 0..1 values), then
 * the rows of `rows` give R, G and B.
 * @param {Picture["matrix"]} matrix
 * @param {boolean} full
 */
export function coefficients(matrix, full) {
  const [kr = 0.299, kb = 0.114] = K[matrix] ?? K.bt601;
  const kg = 1 - kr - kb;
  const rows = [
    [1, 0, 2 * (1 - kr)],
    [1, (-2 * (1 - kb) * kb) / kg, (-2 * (1 - kr) * kr) / kg],
    [1, 2 * (1 - kb), 0],
  ];
  const offset = full ? [0, 128 / 255, 128 / 255] : [16 / 255, 128 / 255, 128 / 255];
  const scale = full ? [1, 1, 1] : [255 / 219, 255 / 224, 255 / 224];
  return { rows, offset, scale };
}

/**
 * The picture as RGBA bytes, chroma by its nearest sample: the 2D fallback.
 * @param {Picture} picture
 * @param {Uint8ClampedArray} [out]
 */
export function toRgba(picture, out = new Uint8ClampedArray(picture.width * picture.height * 4)) {
  const { width, height, planes, widths, heights } = picture;
  const { rows, offset, scale } = coefficients(picture.matrix, picture.full);
  const [y = new Uint8Array(0), u, v] = planes;
  const cw = widths[1] ?? 1;
  const ch = heights[1] ?? 1;
  const [r0 = [], r1 = [], r2 = []] = rows;
  const [oy = 0, ou = 0, ov = 0] = offset.map((o) => o * 255);
  const [sy = 1, su = 1, sv = 1] = scale;
  for (let row = 0; row < height; row++) {
    const crow = Math.min(ch - 1, Math.floor((row * ch) / height)) * cw;
    for (let col = 0; col < width; col++) {
      const at = row * (widths[0] ?? width) + col;
      const c = crow + Math.min(cw - 1, Math.floor((col * cw) / width));
      const Y = ((y[at] ?? 0) - oy) * sy;
      const U = u ? ((u[c] ?? 128) - ou) * su : 0;
      const V = v ? ((v[c] ?? 128) - ov) * sv : 0;
      const o = (row * width + col) * 4;
      out[o] = Y + (r0[1] ?? 0) * U + (r0[2] ?? 0) * V;
      out[o + 1] = Y + (r1[1] ?? 0) * U + (r1[2] ?? 0) * V;
      out[o + 2] = Y + (r2[1] ?? 0) * U + (r2[2] ?? 0) * V;
      out[o + 3] = 255;
    }
  }
  return out;
}

const VERTEX = `attribute vec2 a;
varying vec2 t;
void main() {
  t = vec2((a.x + 1.0) * 0.5, (1.0 - a.y) * 0.5);
  gl_Position = vec4(a, 0.0, 1.0);
}`;

const FRAGMENT = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 t;
uniform sampler2D y;
uniform sampler2D u;
uniform sampler2D v;
uniform mat3 m;
uniform vec3 offset;
uniform vec3 scale;
void main() {
  vec3 yuv = vec3(texture2D(y, t).r, texture2D(u, t).r, texture2D(v, t).r);
  gl_FragColor = vec4(clamp(m * ((yuv - offset) * scale), 0.0, 1.0), 1.0);
}`;

/** @param {WebGLRenderingContext} gl */
function program(gl) {
  const made = gl.createProgram();
  for (const [type, text] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ]) {
    const shader = /** @type {WebGLShader} */ (gl.createShader(/** @type {number} */ (type)));
    gl.shaderSource(shader, /** @type {string} */ (text));
    gl.compileShader(shader);
    gl.attachShader(made, shader);
  }
  gl.linkProgram(made);
  if (!gl.getProgramParameter(made, gl.LINK_STATUS))
    throw new Error("The YUV shader did not link.");
  return made;
}

/** @param {WebGLRenderingContext} gl @param {WebGLProgram} shader */
function webglScreen(gl, shader) {
  gl.useProgram(shader);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(shader, "a");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const sizes = ["", "", ""];
  const textures = ["y", "u", "v"].map((name, i) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const [p, value] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, /** @type {number} */ (p), /** @type {number} */ (value));
    gl.uniform1i(gl.getUniformLocation(shader, name), i);
    return texture;
  });
  const m = gl.getUniformLocation(shader, "m");
  const offset = gl.getUniformLocation(shader, "offset");
  const scale = gl.getUniformLocation(shader, "scale");
  const neutral = new Uint8Array([128]);
  /** @param {number} i @param {number} w @param {number} h @param {Uint8Array} data */
  const upload = (i, w, h, data) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, textures[i] ?? null);
    const size = `${w}x${h}`;
    const L = gl.LUMINANCE;
    if (sizes[i] === size)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, L, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, L, w, h, 0, L, gl.UNSIGNED_BYTE, data);
    sizes[i] = size;
  };
  /** @type {Screen} */
  return {
    draw(picture) {
      const canvas = /** @type {HTMLCanvasElement} */ (gl.canvas);
      if (canvas.width !== picture.width) canvas.width = picture.width;
      if (canvas.height !== picture.height) canvas.height = picture.height;
      gl.viewport(0, 0, picture.width, picture.height);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (let i = 0; i < 3; i++) {
        const data = picture.planes[i];
        if (data) upload(i, picture.widths[i] ?? 1, picture.heights[i] ?? 1, data);
        else upload(i, 1, 1, neutral);
      }
      const c = coefficients(picture.matrix, picture.full);
      // Column-major, as GLSL reads a mat3.
      const [r = [], g = [], b = []] = c.rows;
      const columns = [0, 1, 2].flatMap((col) => [r[col] ?? 0, g[col] ?? 0, b[col] ?? 0]);
      gl.uniformMatrix3fv(m, false, columns);
      gl.uniform3fv(offset, c.offset);
      gl.uniform3fv(scale, c.scale);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    clear() {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    close() {
      for (const texture of textures) gl.deleteTexture(texture);
      gl.deleteBuffer(quad);
      gl.deleteProgram(shader);
    },
  };
}

/** @param {HTMLCanvasElement} canvas @param {CanvasRenderingContext2D} ctx */
function flatScreen(canvas, ctx) {
  /** @type {ImageData | null} */
  let image = null;
  /** @type {Screen} */
  return {
    draw(picture) {
      if (canvas.width !== picture.width) canvas.width = picture.width;
      if (canvas.height !== picture.height) canvas.height = picture.height;
      if (image?.width !== picture.width || image.height !== picture.height)
        image = ctx.createImageData(picture.width, picture.height);
      toRgba(picture, image.data);
      ctx.putImageData(image, 0, 0);
    },
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    close() {
      image = null;
    },
  };
}

/**
 * The screen for a canvas: WebGL where the system has it, else the 2D canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {Screen}
 */
export function createScreen(canvas) {
  const gl = /** @type {WebGLRenderingContext | null} */ (
    canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true }) ??
      canvas.getContext("experimental-webgl")
  );
  if (gl) {
    try {
      return webglScreen(gl, program(gl));
    } catch {
      // A shader the driver refuses: a 2D canvas cannot be had from a canvas that gave WebGL.
      return { draw() {}, clear() {}, close() {} };
    }
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return { draw() {}, clear() {}, close() {} };
  return flatScreen(canvas, ctx);
}
