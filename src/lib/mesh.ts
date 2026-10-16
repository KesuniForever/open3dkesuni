// The customer's 3D model, read without any library: binary and text STL, OBJ (vertices and faces). The order form and
// the customer's order page draw it (src/app/c/ModelPreview.tsx); the server keeps only its size (src/lib/files.ts).
// STL and OBJ carry no unit: slicers read them as millimetres, and so does this. Pure: no DOM, no Node imports.
// Big files are read in steps (generators): the browser runs them between frames (runAsync), so the page never freezes.

export type Vec3 = [number, number, number];

/** A model as triangles, 9 numbers each (x, y, z of its three corners), and the box around its vertices. */
export interface Mesh { positions: Float32Array; triangles: number; min: Vec3; max: Vec3 }
export type MeshRead = { ok: true; mesh: Mesh } | { ok: false; reason: string };
/** What the server keeps of a model: its size along x, y and z in mm (0.1 mm), and how many triangles it has. */
export interface MeshSize { sizeMm: Vec3; triangles: number }

/** Work done between two pauses: steps yield, the caller decides whether to pause (runAsync) or not (run). */
export type Steps<T> = Generator<void, T, void>;

/** Triangles or lines read between two yields. */
const STEP = 8192;
/** More triangles than this is not shown (and not measured): far above any 25 MB STL (about 520 000). Reading stops
 *  as soon as it is passed, before memory grows: an OBJ can fan one short line out into thousands of triangles. */
export const MAX_TRIANGLES = 2_000_000;
/** Corners of one OBJ face at most (a cylinder's cap has a few hundred); a longer face is left out. */
const MAX_CORNERS = 1024;
/** A coordinate beyond a kilometre is a broken file, not a part (its size would not even fit on the page). */
const MAX_MM = 1e6;
const BROKEN = "The model could not be read";
const TOO_BIG = "The model is too big to show";
const NOT_A_MODEL = "Only STL and OBJ files can be shown";
/** Not a number, or too far out (see MAX_MM). */
const badMm = (v: number) => !(Math.abs(v) <= MAX_MM);

/** Run steps to the end at once (tests, the server's size). */
export function run<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Run steps, pausing after about `sliceMs` of work so the page can paint and take taps. Throws once `signal` aborts. */
export async function runAsync<T>(steps: Steps<T>, signal?: AbortSignal, sliceMs = 12): Promise<T> {
  let since = clock();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (clock() - since < sliceMs) continue;
    await new Promise<void>((done) => setTimeout(done, 0));
    if (signal?.aborted) throw new Error("aborted");
    since = clock();
  }
}

// ---------- reading ----------

/** A float list that grows (text files do not say how many triangles they hold). */
class Floats {
  a: Float32Array;
  n = 0;
  constructor(capacity: number) { this.a = new Float32Array(Math.max(9, capacity)); }
  push(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) {
      const bigger = new Float32Array(this.a.length * 2);
      bigger.set(this.a);
      this.a = bigger;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  /** Exactly the numbers pushed (a copy, so the spare room is freed). */
  done(): Float32Array { return this.a.slice(0, this.n); }
}

interface Box { min: Vec3; max: Vec3 }
const newBox = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
function widen(b: Box, x: number, y: number, z: number) {
  if (x < b.min[0]) b.min[0] = x;
  if (y < b.min[1]) b.min[1] = y;
  if (z < b.min[2]) b.min[2] = z;
  if (x > b.max[0]) b.max[0] = x;
  if (y > b.max[1]) b.max[1] = y;
  if (z > b.max[2]) b.max[2] = z;
}

/** positions null: only the box and the count (the server). */
type Parsed = { positions: Float32Array | null; triangles: number; box: Box };

/** A binary STL: 80-byte header, triangle count, 50 bytes per triangle (a few stray bytes at the end are fine). Same
 *  rule as the server's content check (src/lib/auto-weigh.ts). */
export function isBinaryStl(b: Uint8Array): boolean {
  if (b.byteLength < 84 + 50) return false;
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true);
  const want = 84 + n * 50;
  return n > 0 && want <= b.byteLength && b.byteLength - want < 1024;
}

function* binaryStl(b: Uint8Array, keep: boolean): Steps<Parsed | string> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(80, true);
  if (n > MAX_TRIANGLES) return TOO_BIG;
  const out = keep ? new Float32Array(n * 9) : null;
  const box = newBox();
  for (let i = 0; i < n; i++) {
    const at = 84 + i * 50 + 12; // after the stored normal (ignored: the corners give the face)
    for (let k = 0; k < 3; k++) {
      const x = v.getFloat32(at + k * 12, true), y = v.getFloat32(at + k * 12 + 4, true), z = v.getFloat32(at + k * 12 + 8, true);
      if (badMm(x) || badMm(y) || badMm(z)) return BROKEN;
      widen(box, x, y, z);
      if (out) {
        out[i * 9 + k * 3] = x;
        out[i * 9 + k * 3 + 1] = y;
        out[i * 9 + k * 3 + 2] = z;
      }
    }
    if (i % STEP === STEP - 1) yield;
  }
  return { positions: out, triangles: n, box };
}

function* asciiStl(text: string, keep: boolean): Steps<Parsed | string> {
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  const out = keep ? new Floats(text.length / 40) : null;
  const box = newBox();
  let corners = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const x = Number(m[1]), y = Number(m[2]), z = Number(m[3]);
    if (badMm(x) || badMm(y) || badMm(z)) return BROKEN;
    if (corners >= MAX_TRIANGLES * 3) return TOO_BIG;
    widen(box, x, y, z);
    out?.push(x, y, z);
    if (++corners % (STEP * 3) === 0) yield;
  }
  const triangles = Math.floor(corners / 3);
  if (!triangles) return BROKEN;
  return { positions: out ? out.done().subarray(0, triangles * 9) : null, triangles, box };
}

/** The first `max` words of text[from, to), without copying the rest of a long line. */
function words(text: string, from: number, to: number, max: number): string[] {
  const out: string[] = [];
  for (let i = from; out.length < max;) {
    while (i < to && text.charCodeAt(i) <= 32) i++;
    if (i >= to) break;
    const start = i;
    while (i < to && text.charCodeAt(i) > 32) i++;
    out.push(text.slice(start, i));
  }
  return out;
}

/** OBJ: "v x y z" vertices and "f a b c …" faces (a/b/c or a//c, negative = counted back), split into triangles. The
 *  box holds every vertex, as most viewers measure it. Pauses by work done (lines and triangles), not lines alone. */
function* obj(text: string, keep: boolean): Steps<Parsed | string> {
  const verts = new Floats(keep ? text.length / 30 : 9);
  const out = keep ? new Floats(text.length / 15) : null;
  const box = newBox();
  let count = 0, triangles = 0, work = 0;
  for (let at = 0; at < text.length;) {
    let end = text.indexOf("\n", at);
    if (end < 0) end = text.length;
    // "f" and up to one corner more than allowed: enough to see that a face is too long.
    const w = words(text, at, end, MAX_CORNERS + 2);
    at = end + 1;
    if (++work >= STEP) { work = 0; yield; }
    if (w[0] === "v") {
      const x = Number(w[1]), y = Number(w[2]), z = Number(w[3]);
      if (badMm(x) || badMm(y) || badMm(z)) return BROKEN;
      widen(box, x, y, z);
      if (keep) verts.push(x, y, z);
      count++;
    } else if (w[0] === "f") {
      const idx = w.slice(1).map((s) => {
        const i = parseInt(s, 10);
        return i < 0 ? count + i : i - 1;
      });
      // A face we cannot place, or with more corners than any real one: left out.
      if (idx.length < 3 || idx.length > MAX_CORNERS || idx.some((i) => !(i >= 0 && i < count))) continue;
      if (triangles + idx.length - 2 > MAX_TRIANGLES) return TOO_BIG;
      triangles += idx.length - 2;
      work += idx.length - 2;
      if (!out) continue;
      for (let k = 1; k + 1 < idx.length; k++) {
        for (const i of [idx[0], idx[k], idx[k + 1]]) out.push(verts.a[i * 3], verts.a[i * 3 + 1], verts.a[i * 3 + 2]);
      }
    }
  }
  if (!triangles) return BROKEN;
  return { positions: out ? out.done() : null, triangles, box };
}

const extOf = (name: string) => /\.[^./\\]+$/.exec(name.toLowerCase())?.[0] ?? "";
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function* parse(name: string, bytes: Uint8Array, keep: boolean): Steps<Parsed | string> {
  const ext = extOf(name);
  if (ext === ".obj") return yield* obj(text(bytes), keep);
  if (ext !== ".stl") return NOT_A_MODEL;
  // Some exporters start a binary STL with "solid" too: the size decides first.
  if (isBinaryStl(bytes)) return yield* binaryStl(bytes, keep);
  if (!text(bytes.subarray(0, 512)).trimStart().toLowerCase().startsWith("solid")) return BROKEN;
  return yield* asciiStl(text(bytes), keep);
}

function* readSteps(name: string, bytes: Uint8Array): Steps<MeshRead> {
  const r = yield* parse(name, bytes, true);
  if (typeof r === "string") return { ok: false, reason: r };
  return { ok: true, mesh: { positions: r.positions!, triangles: r.triangles, min: r.box.min, max: r.box.max } };
}

function* sizeSteps(name: string, bytes: Uint8Array): Steps<MeshSize | null> {
  const r = yield* parse(name, bytes, false);
  return typeof r === "string" ? null : { sizeMm: sizeOf({ min: r.box.min, max: r.box.max }), triangles: r.triangles };
}

/** The whole model, at once. */
export const readMesh = (name: string, bytes: Uint8Array): MeshRead => run(readSteps(name, bytes));
/** The whole model, in steps between frames (the browser). */
export const readMeshAsync = (name: string, bytes: Uint8Array, signal?: AbortSignal): Promise<MeshRead> =>
  runAsync(readSteps(name, bytes), signal);
/** Only the size and the triangle count, nothing kept in memory; null when it is not a readable STL or OBJ. */
export const meshSize = (name: string, bytes: Uint8Array): MeshSize | null => run(sizeSteps(name, bytes));
/** The same in steps, so a big upload does not hold up the server's other requests. */
export const meshSizeAsync = (name: string, bytes: Uint8Array): Promise<MeshSize | null> => runAsync(sizeSteps(name, bytes));

/** Width, depth and height in mm, to 0.1 mm. */
export const sizeOf = (m: Pick<Mesh, "min" | "max">): Vec3 =>
  [0, 1, 2].map((i) => Math.round((m.max[i] - m.min[i]) * 10) / 10) as Vec3;

// ---------- drawing ----------

/** One normal per corner (the face's own, so faces look flat), from the corners: the normals a file stores are often wrong. */
export function faceNormals(positions: Float32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let o = 0; o + 9 <= positions.length; o += 9) {
    const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
    const vx = positions[o + 6] - positions[o], vy = positions[o + 7] - positions[o + 1], vz = positions[o + 8] - positions[o + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const len = Math.hypot(x, y, z);
    if (len > 0) { x /= len; y /= len; z /= len; } else { x = 0; y = 0; z = 1; }
    for (let k = 0; k < 9; k += 3) { n[o + k] = x; n[o + k + 1] = y; n[o + k + 2] = z; }
  }
  return n;
}

/**
 * At most `max` triangles, for drawing. Vertices snap to a grid (vertex clustering): triangles that collapse or repeat
 * drop out and the grid gets coarser until it fits, so the shape stays whole (no holes from skipped triangles) and the
 * box stays the same. Only if that never fits, an even share of the triangles is kept.
 */
export function* decimateSteps(mesh: Mesh, max: number): Steps<Mesh> {
  if (mesh.triangles <= max) return mesh;
  // A closed surface on an n×n×n grid has about 12·n² triangles (a cube): start there, then adjust.
  let cells = Math.max(4, Math.round(Math.sqrt(max / 12)));
  let last = mesh;
  for (let tries = 0; tries < 6; tries++) {
    last = yield* cluster(mesh, cells);
    if (last.triangles <= max) return last;
    cells = Math.max(2, Math.floor(cells * Math.sqrt(max / last.triangles) * 0.9));
  }
  return everyNth(last, max);
}

export const decimate = (mesh: Mesh, max: number): Mesh => run(decimateSteps(mesh, max));

function* cluster(m: Mesh, cells: number): Steps<Mesh> {
  const size = Math.max(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]) || 1;
  const cell = size / cells;
  const side = cells + 1;
  const p = m.positions;
  const cellOf = (o: number) => {
    const at = (i: number) => Math.min(cells, Math.max(0, Math.floor((p[o + i] - m.min[i]) / cell)));
    return at(0) + side * (at(1) + side * at(2));
  };
  const firstIn = new Map<number, number>(); // cell -> the offset of the first corner seen in it (its stand-in)
  const seen = new Set<string>();
  const out = new Floats(Math.min(m.triangles, 1 << 20) * 3);
  for (let t = 0; t < m.triangles; t++) {
    if (t % STEP === STEP - 1) yield;
    const o = t * 9;
    const a = cellOf(o), b = cellOf(o + 3), c = cellOf(o + 6);
    if (a === b || b === c || a === c) continue;
    const id = [a, b, c].sort((x, y) => x - y).join(",");
    if (seen.has(id)) continue;
    seen.add(id);
    for (const [key, at] of [[a, o], [b, o + 3], [c, o + 6]]) {
      let s = firstIn.get(key);
      if (s === undefined) firstIn.set(key, (s = at));
      out.push(p[s], p[s + 1], p[s + 2]);
    }
  }
  const positions = out.done();
  return { positions, triangles: positions.length / 9, min: m.min, max: m.max };
}

function everyNth(m: Mesh, max: number): Mesh {
  const out = new Float32Array(max * 9);
  for (let k = 0; k < max; k++) {
    const from = Math.floor((k * m.triangles) / max) * 9;
    out.set(m.positions.subarray(from, from + 9), k * 9);
  }
  return { positions: out, triangles: max, min: m.min, max: m.max };
}
