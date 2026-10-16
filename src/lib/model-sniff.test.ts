import { describe, expect, it } from "vitest";
import { modelName, sniffModel } from "./model-sniff";

const binaryStl = (triangles: number): Uint8Array => {
  const b = new Uint8Array(84 + triangles * 50);
  new DataView(b.buffer).setUint32(80, triangles, true);
  return b;
};
const text = (s: string) => new TextEncoder().encode(s);

describe("a model file that lost its name on a phone", () => {
  it("knows a binary STL by its size and triangle count", () => {
    const b = binaryStl(12);
    expect(sniffModel(b.slice(0, 4096), b.length)).toBe(".stl");
    expect(sniffModel(b.slice(0, 4096), b.length + 1)).toBeNull(); // the count does not match the size
  });

  it("knows a text STL and an OBJ", () => {
    expect(sniffModel(text("solid cube\n  facet normal 0 0 1\n    outer loop\n"), 500)).toBe(".stl");
    expect(sniffModel(text("# Blender\no Cube\nv 1 1 1\nv -1 1 1\nv 1 -1 1\nf 1 2 3\n"), 500)).toBe(".obj");
  });

  it("refuses anything else", () => {
    expect(sniffModel(text("hello, this is a note"), 21)).toBeNull();
    expect(sniffModel(text("solid but no facets"), 19)).toBeNull();
    expect(sniffModel(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 8)).toBeNull(); // a PNG
    expect(sniffModel(new Uint8Array(0), 0)).toBeNull();
  });

  it("gives the file a proper name", () => {
    expect(modelName("model.stl.bin", ".stl")).toBe("model.stl");
    expect(modelName("1000012345", ".stl")).toBe("1000012345.stl");
    expect(modelName("casing (1)", ".obj")).toBe("casing (1).obj");
    expect(modelName("", ".stl")).toBe("design.stl");
  });
});
