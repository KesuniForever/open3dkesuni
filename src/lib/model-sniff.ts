// A 3D model whose file name lost its ".stl" or ".obj" on the way to the customer's phone: Android browsers save files
// they have no app for as "model.stl.bin" or with no extension at all, and some file pickers only hand over a number.
// The order form reads the first bytes, and when they are clearly an STL or OBJ, the file is sent under a proper name.
// Pure: the browser calls it; the server still checks the whole content (src/lib/auto-weigh.ts), so a guess here can
// never let a wrong file through, it only stops a right one from being refused.

/** How many bytes of the file to read for sniffModel. */
export const SNIFF_BYTES = 4096;

/** ".stl" or ".obj" when the start of the file (and its size) can only be that, else null. */
export function sniffModel(head: Uint8Array, size: number): ".stl" | ".obj" | null {
  // Binary STL: an 80-byte header, the triangle count, then exactly 50 bytes per triangle.
  if (size >= 134 && head.length >= 84) {
    const count = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(80, true);
    if (count > 0 && 84 + count * 50 === size) return ".stl";
  }
  if (head.includes(0)) return null; // anything else here is text
  const text = new TextDecoder("latin1").decode(head);
  if (/^\s*solid\b/i.test(text) && /\bfacet\s+normal\b/i.test(text)) return ".stl";
  const vertices = text.match(/^\s*v\s+[-+.\d]/gm)?.length ?? 0;
  return vertices >= 3 && /^\s*(#|(v|vn|vt|f|o|g|mtllib|usemtl|s)\s)/.test(text) ? ".obj" : null;
}

/** "model.stl.bin" -> "model.stl", "1000012345" -> "1000012345.stl": the name the file is sent under. */
export function modelName(name: string, ext: ".stl" | ".obj"): string {
  const base = name.replace(/\.(bin|dat|txt|download|tmp)$/i, "");
  return base.toLowerCase().endsWith(ext) ? base : `${base || "design"}${ext}`;
}
