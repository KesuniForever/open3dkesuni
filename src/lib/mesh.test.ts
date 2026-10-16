import { describe, expect, it } from "vitest";
import {
  MAX_TRIANGLES, decimate, faceNormals, isBinaryStl, meshSize, meshSizeAsync, readMesh, readMeshAsync, run, runAsync, sizeOf, type Mesh,
  type Steps,
} from "./mesh";
import { customerDesignContentProblem } from "./auto-weigh";

// The customer's model, read in the browser for the 3D preview and on the server for its size: binary and text STL,
// OBJ. Units are mm, as slicers read them.

const enc = (s: string) => new TextEncoder().encode(s);
type Tri = [number[], number[], number[]];

/** A box w × d × h at (x0, y0, z0): 12 triangles. */
function box(w: number, d: number, h: number, [x0, y0, z0] = [0, 0, 0]): Tri[] {
  const p = (x: number, y: number, z: number) => [x0 + x * w, y0 + y * d, z0 + z * h];
  const quads = [
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)], [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], [p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)],
    [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)], [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
  ];
  return quads.flatMap(([a, b, c, q]) => [[a, b, c], [a, c, q]] as Tri[]);
}
function binaryStl(tris: Tri[], header = "binary"): Uint8Array {
  const b = Buffer.alloc(84 + tris.length * 50);
  b.write(header, 0, "latin1");
  b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.flat().forEach((v, k) => b.writeFloatLE(v, 84 + i * 50 + 12 + k * 4)));
  return new Uint8Array(b);
}
const asciiStl = (tris: Tri[]) => enc(`solid part\n${tris.map((t) =>
  ` facet normal 0 0 0\n  outer loop\n${t.map((v) => `   vertex ${v.map((n) => n.toExponential()).join(" ")}\n`).join("")}  endloop\n endfacet\n`).join("")}endsolid part\n`);
const ok = (r: ReturnType<typeof readMesh>): Mesh => {
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};

describe("reading a model", () => {
  it("binary STL: every corner, the box and the size (even with a header that starts with \"solid\")", () => {
    const tris = box(40, 20, 10.5, [5, -10, 0]);
    for (const header of ["binary", "solid exported as binary"]) {
      const m = ok(readMesh("Clip.STL", binaryStl(tris, header)));
      expect(m.triangles).toBe(12);
      expect(Array.from(m.positions)).toEqual(tris.flat(2));
      expect(m.min).toEqual([5, -10, 0]);
      expect(m.max).toEqual([45, 10, 10.5]);
      expect(sizeOf(m)).toEqual([40, 20, 10.5]);
    }
  });

  it("text STL gives the same model as binary", () => {
    const tris = box(12.25, 3, 7);
    const text = ok(readMesh("part.stl", asciiStl(tris)));
    expect(text.triangles).toBe(12);
    expect(Array.from(text.positions)).toEqual(Array.from(ok(readMesh("part.stl", binaryStl(tris))).positions));
    expect(sizeOf(text)).toEqual([12.3, 3, 7]); // to 0.1 mm
  });

  it("OBJ: quads and polygons split into triangles, a/b/c and negative indices, the box over every vertex", () => {
    const obj = enc([
      "# a 10 x 10 x 5 block with a 4-gon and a 5-gon", "o block", "v 0 0 0", "v 10 0 0", "v 10 10 0", "v 0 10 0",
      "vt 0 0", "vn 0 0 1", "f 1/1/1 2/1/1 3/1/1 4/1/1", "v 0 0 5", "v 10 0 5", "v 10 10 5", "v 5 12 5", "v 0 10 5",
      "f -5 -4 -3 -2 -1", "f 1//1 2//1 6//1", "f 1 2 99", "f 1 2", "",
    ].join("\r\n"));
    const m = ok(readMesh("block.obj", obj));
    expect(m.triangles).toBe(2 + 3 + 1); // the face with vertex 99 and the 2-corner face are left out
    expect(Array.from(m.positions.slice(0, 9))).toEqual([0, 0, 0, 10, 0, 0, 10, 10, 0]);
    expect(Array.from(m.positions.slice(6 * 9 - 9))).toEqual([0, 0, 0, 10, 0, 0, 10, 0, 5]);
    expect(sizeOf(m)).toEqual([10, 12, 5]);
  });

  it("refuses what is not a model, with no size either", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(300).fill(7)]);
    const cases: [string, Uint8Array, string][] = [
      ["photo.stl", png, "The model could not be read"],
      ["empty.stl", enc("solid x\nendsolid x\n"), "The model could not be read"],
      ["nan.stl", enc("solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 abc 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n"), "The model could not be read"],
      ["notes.obj", enc("just some text\n"), "The model could not be read"],
      ["points.obj", enc("v 0 0 0\nv 1 0 0\nv 0 1 0\n"), "The model could not be read"],
      ["broken.obj", enc("v 0 zero 0\nf 1 1 1\n"), "The model could not be read"],
      ["plate.3mf", binaryStl(box(1, 1, 1)), "Only STL and OBJ files can be shown"],
      ["model", binaryStl(box(1, 1, 1)), "Only STL and OBJ files can be shown"],
    ];
    for (const [name, bytes, reason] of cases) {
      expect(readMesh(name, bytes)).toEqual({ ok: false, reason });
      expect(meshSize(name, bytes)).toBeNull();
    }
    // A binary file whose triangle count does not match its size is not binary (and not "solid" text either).
    const short = binaryStl(box(1, 1, 1)).subarray(0, 84 + 11 * 50);
    expect(isBinaryStl(short)).toBe(false);
    expect(readMesh("cut.stl", short).ok).toBe(false);
  });

  it("an OBJ that fans out into millions of triangles stops early: a face with too many corners is left out, and a model past the cap is too big", async () => {
    // One 2 MB face line (the server's content check lets it through): left out, so nothing to show.
    const fan = `v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3${" 3".repeat(1_000_000)}\n`;
    expect(customerDesignContentProblem("fan.obj", enc(fan))).toBeNull();
    expect(readMesh("fan.obj", enc(fan))).toEqual({ ok: false, reason: "The model could not be read" });
    expect(await meshSizeAsync("fan.obj", enc(fan))).toBeNull();
    // Faces up to 1024 corners are real polygons (a cylinder's cap): split as usual. One more corner: left out.
    const poly = (n: number) => `f ${Array.from({ length: n }, (_, i) => (i % 3) + 1).join(" ")}\n`;
    expect(meshSize("cap.obj", enc(`v 0 0 0\nv 1 0 0\nv 0 1 0\n${poly(1024)}`))).toEqual({ sizeMm: [1, 1, 0], triangles: 1022 });
    expect(meshSize("cap.obj", enc(`v 0 0 0\nv 1 0 0\nv 0 1 0\n${poly(1025)}f 1 2 3\n`))).toEqual({ sizeMm: [1, 1, 0], triangles: 1 });
    // Many such lines: refused as soon as the cap is passed, in the browser and on the server alike.
    const many = `v 0 0 0\nv 1 0 0\nv 0 1 0\n${poly(1024).repeat(Math.ceil(MAX_TRIANGLES / 1022) + 1)}`;
    expect(readMesh("many.obj", enc(many))).toEqual({ ok: false, reason: "The model is too big to show" });
    expect(meshSize("many.obj", enc(many))).toBeNull();
  });

  it("a coordinate beyond a kilometre is a broken file, not a 300-digit size on the page", () => {
    const far = [
      ["far.obj", enc("v 1e300 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")],
      ["far.obj", enc("v 0 0 0\nv 1 0 0\nv 0 1 -2e6\nf 1 2 3\n")],
      ["far.stl", enc("solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1e300 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n")],
      ["far.stl", binaryStl([[[0, 0, 0], [3e38, 0, 0], [0, 1, 0]], ...box(1, 1, 1)])],
    ] as const;
    for (const [name, bytes] of far) {
      expect(readMesh(name, bytes)).toEqual({ ok: false, reason: "The model could not be read" });
      expect(meshSize(name, bytes)).toBeNull();
    }
    // Up to a kilometre it is still a model (perhaps in the wrong unit): measured as it is.
    expect(meshSize("big.obj", enc("v 0 0 0\nv 1000 0 0\nv 0 999999 0\nf 1 2 3\n"))).toEqual({ sizeMm: [1000, 999999, 0], triangles: 1 });
  });

  it("decides binary or text exactly as the server's content check does", () => {
    const files = [binaryStl(box(2, 2, 2)), binaryStl(box(2, 2, 2), "solid looks like text"), asciiStl(box(2, 2, 2))];
    for (const f of files) expect(customerDesignContentProblem("x.stl", f)).toBeNull();
    for (const f of files) expect(readMesh("x.stl", f).ok).toBe(true);
    const withTail = new Uint8Array([...binaryStl(box(2, 2, 2)), ...new Array(100).fill(0)]); // a few stray bytes at the end
    expect(isBinaryStl(withTail)).toBe(true);
    expect(customerDesignContentProblem("x.stl", withTail)).toBeNull();
  });

  it("the server keeps only the size and the count: the same numbers, nothing else in memory", async () => {
    const stl = binaryStl(box(40, 20, 10.5));
    expect(meshSize("a.stl", stl)).toEqual({ sizeMm: [40, 20, 10.5], triangles: 12 });
    expect(meshSize("a.stl", asciiStl(box(40, 20, 10.5)))).toEqual({ sizeMm: [40, 20, 10.5], triangles: 12 });
    expect(await meshSizeAsync("a.obj", enc("v 0 0 0\nv 3 0 0\nv 0 4 0\nv 0 0 9\nf 1 2 3\n"))).toEqual({ sizeMm: [3, 4, 9], triangles: 1 });
  });

  it("in steps between frames: the same model, and it stops when the page leaves", async () => {
    const tris = Array.from({ length: 40 }, (_, i) => box(1, 1, 1, [i * 2, 0, 0])).flat(); // 480 triangles
    const big = binaryStl(tris);
    const later = await readMeshAsync("row.stl", big);
    expect(later).toEqual(readMesh("row.stl", big));
    // Steps pause whenever the time slice is used up (0 ms here: at every step), and still finish.
    function* count(n: number): Steps<number> { for (let i = 0; i < n; i++) yield; return n; }
    expect(await runAsync(count(5), undefined, 0)).toBe(5);
    expect(run(count(3))).toBe(3);
    const stop = new AbortController();
    stop.abort();
    await expect(runAsync(count(5), stop.signal, 0)).rejects.toThrow("aborted");
  });
});

describe("drawing it", () => {
  it("one normal per face, from its corners (a file's stored normals are often wrong)", () => {
    const n = faceNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, /* degenerate: */ 0, 0, 0, 1, 1, 1, 2, 2, 2]));
    expect(Array.from(n.slice(0, 9))).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(Array.from(n.slice(9))).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const box12 = ok(readMesh("b.stl", binaryStl(box(2, 3, 4))));
    const all = faceNormals(box12.positions);
    for (let i = 0; i < all.length; i += 3) expect(Math.hypot(all[i], all[i + 1], all[i + 2])).toBeCloseTo(1, 5);
  });

  it("a very big model is simplified for the screen: at most the cap, whole (no collapsed triangles), the same box", () => {
    // A 60 × 60 × 60 mm box made of 1 mm squares on every side: 6 × 60 × 60 × 2 = 43 200 triangles.
    const n = 60;
    const tris: Tri[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const sq = (f: (u: number, v: number) => number[]) => {
        const a = f(i, j), b = f(i + 1, j), c = f(i + 1, j + 1), d = f(i, j + 1);
        tris.push([a, b, c], [a, c, d]);
      };
      sq((u, v) => [u, v, 0]); sq((u, v) => [u, v, n]); sq((u, v) => [u, 0, v]); sq((u, v) => [u, n, v]); sq((u, v) => [0, u, v]); sq((u, v) => [n, u, v]);
    }
    const full = ok(readMesh("fine.stl", binaryStl(tris)));
    expect(full.triangles).toBe(43_200);
    const small = decimate(full, 5000);
    expect(small.triangles).toBeLessThanOrEqual(5000);
    expect(small.triangles).toBeGreaterThan(1000);
    expect([small.min, small.max]).toEqual([full.min, full.max]);
    const p = small.positions;
    for (let o = 0; o < p.length; o += 9) {
      const corners = [0, 3, 6].map((k) => `${p[o + k]},${p[o + k + 1]},${p[o + k + 2]}`);
      expect(new Set(corners).size).toBe(3);
      for (let k = 0; k < 9; k++) expect(p[o + k] >= 0 && p[o + k] <= n).toBe(true);
    }
    // Small enough already: unchanged.
    expect(decimate(full, 50_000)).toBe(full);
  });
});
