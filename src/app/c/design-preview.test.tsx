import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import { LocaleProvider } from "@/i18n/client";
import type { CustomerDesignView } from "@/lib/customer";
import type { Mesh } from "@/lib/mesh";
import { DesignCard, designColour } from "./[token]/CustomerView";
import ModelPreview, { AUTO_LOAD_BYTES, ModelBox, glCompiles, painterFor, sizeText, tintOf, turn } from "./ModelPreview";
import DesignPicker from "./DesignPicker";

// The customer's own design on the order form and the order page, as the server renders it (before any effect runs:
// the model is read in the browser afterwards, so the first paint only says it is reading).
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const render = (node: ReactNode, locale: Locale = "en") => renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>);

const WEIGHED: CustomerDesignView = {
  name: "Clip (v2).stl", bytes: 126_000, sizeMm: [40, 20, 10.5], state: "weighed", gramsPerPiece: 16.4, printMinutesPerPiece: 25,
  material: "PLA", colourName: "Yellow", colourHex: "#FEC600", estimate: { unitIdr: 25_000, totalIdr: 75_000, usdc: "4.545454" }, priced: false,
};
const card = (d: CustomerDesignView, locale: Locale = "en", quantity = 3) => render(
  <DesignCard d={d} quantity={quantity} t={makeT(locale, ID)} locale={locale}
    preview={<ModelPreview source="/api/c/token/design" name={d.name} sizeMm={d.sizeMm} bytes={d.bytes} color={d.colourHex} compact={d.priced} />} />,
  locale,
);

describe("\"Your design\" on the order page", () => {
  it("weighed: the model, its size, weight, print time for one and for all, the spool and the estimate", () => {
    const html = card(WEIGHED);
    expect(text(html)).toBe([
      "Your design", "Your own file, shown in your browser: drag to turn it. The studio's slicer weighs it with standard settings to set the price. The colour does not change the weight.", "Weighed",
      "Reading your model…", "Clip (v2).stl 40 × 20 × 10.5 mm",
      "Weight 16.4 g per piece", "Print time (estimate) 25 min per piece 1 h 15 min for 3 pieces", "Weighed with PLA Yellow",
      "Estimated price Rp75.000 Rp25.000 per piece · ≈ 4.545454 USDC", "Estimate · the final price comes with your agreement",
    ].join(" "));
    expect(html).toContain('class="badge ok"');
    expect(html).toContain("background:#FEC600");
    expect(text(html)).not.toMatch(/cost|margin|printer|tray|gcode/i);
  });

  it("in Indonesian, with the decimal comma", () => {
    const t = text(card(WEIGHED, "id"));
    for (const s of ["Desain Anda", "Sudah ditimbang", "Membaca model Anda…", "40 × 20 × 10,5 mm", "Berat 16,4 g per buah", "Ditimbang dengan PLA Kuning",
      "Perkiraan harga Rp75.000 Rp25.000 per buah", "Warna tidak mengubah berat.", "Perkiraan · harga akhir ada di kesepakatan Anda"]) expect(t).toContain(s);
  });

  it("one piece: no per-piece repeat; still weighing or Kesuni checks it: the badge only", () => {
    const one = text(card({ ...WEIGHED, estimate: { unitIdr: 25_000, totalIdr: 25_000, usdc: "1.515151" } }, "en", 1));
    expect(one).toContain("Print time (estimate) 25 min per piece Weighed with");
    expect(one).toContain("Estimated price Rp25.000 ≈ 1.515151 USDC");
    const empty = { ...WEIGHED, gramsPerPiece: null, printMinutesPerPiece: null, material: null, colourName: null, colourHex: null, estimate: null };
    const weighing = card({ ...empty, state: "weighing" });
    expect(text(weighing)).toMatch(/Weighing… Reading your model… Clip \(v2\)\.stl 40 × 20 × 10\.5 mm$/);
    expect(weighing).toContain('class="badge testnet"');
    expect(text(card({ ...empty, state: "check" }))).toContain("Kesuni checks your file");
    expect(text(card({ ...empty, state: "check" }))).not.toContain("Weight");
  });

  it("once priced: short (small model, name and size), no badge, no weight and no second price", () => {
    const html = card({ ...WEIGHED, estimate: null, priced: true });
    expect(text(html)).toBe("Your design Your own file, shown in your browser: drag to turn it. The studio's slicer weighs it with standard settings to set the price. The colour does not change the weight. Reading your model… Clip (v2).stl 40 × 20 × 10.5 mm");
    expect(html).toContain('class="mp compact"');
  });
});

describe("the 3D preview", () => {
  it("a big design on the order page waits for a tap before downloading; a picked file is read at once", () => {
    const big = render(<ModelPreview source="/api/c/token/design" name="Scan.stl" bytes={AUTO_LOAD_BYTES + 1} />);
    expect(text(big)).toBe("Show 3D view Scan.stl");
    expect(big).toContain('<button type="button">');
    const file = new File([new Uint8Array(10)], "Clip.stl");
    expect(text(render(<ModelPreview source={file} name="Clip.stl" />))).toBe("Reading your model… Clip.stl");
  });

  it("a file it cannot draw: one quiet line, the name, no canvas (the server still decides)", () => {
    const html = render(<ModelBox model={{ state: "failed" }} name="odd.obj" />);
    expect(text(html)).toBe("odd.obj No 3D preview for this file.");
    expect(html).not.toMatch(/canvas|figure|alert/);
    expect(text(render(<ModelBox model={{ state: "failed" }} name="odd.obj" sizeMm={[1, 2, 3]} />, "id"))).toBe("odd.obj · 1 × 2 × 3 mm Tidak ada pratinjau 3D untuk file ini.");
  });

  it("a ready model: a focusable 3D view with its name for screen readers, and the size it measured", () => {
    const mesh = { positions: new Float32Array(9), triangles: 1, min: [0, 0, 0], max: [12, 3, 4.25] } satisfies Mesh;
    const html = render(<ModelBox model={{ state: "ready", mesh, sizeMm: [12, 3, 4.3] }} name="Clip.stl" />);
    expect(html).toContain('<canvas role="img" aria-label="3D view of your model. Drag to turn it." tabindex="0">');
    expect(text(html)).toBe("Clip.stl 12 × 3 × 4.3 mm");
  });

  it("turns: the front view stands the model up, the top view looks down; the turn keeps lengths", () => {
    const apply = (r: Float32Array, v: number[]) => [0, 1, 2].map((i) => r[i] * v[0] + r[3 + i] * v[1] + r[6 + i] * v[2]);
    const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));
    close(apply(turn(0, -Math.PI / 2), [0, 0, 1]), [0, 1, 0]); // up stays up on screen
    close(apply(turn(0, -Math.PI / 2), [0, 1, 0]), [0, 0, -1]); // the back goes away from the viewer
    close(apply(turn(0, 0), [1, 2, 3]), [1, 2, 3]);
    close(apply(turn(Math.PI / 2, 0), [1, 0, 0]), [0, 1, 0]);
    const v = apply(turn(0.7, -1.1), [3, -4, 12]);
    expect(Math.hypot(...v)).toBeCloseTo(13, 5);
  });

  it("the colour: the customer's spool, black lifted so the shading shows, a soft default without one", () => {
    expect(tintOf("#000000")).toEqual([0.18, 0.18, 0.18]);
    expect(tintOf("#FFFFFF").map((c) => Math.round(c * 100))).toEqual([100, 100, 100]);
    expect(tintOf(null)).toEqual(tintOf("#8FAE9B"));
    expect(tintOf("red")).toEqual(tintOf(null));
    expect(sizeText([40, 20, 10.5], "en")).toBe("40 × 20 × 10.5 mm");
    expect(sizeText([1234.5, 2, 0.1], "id")).toBe("1.234,5 × 2 × 0,1 mm");
  });
});

/**
 * A canvas as a browser gives it: WebGL (whose shaders compile or not) or none, and no 2D once it has had WebGL.
 * `asked` lists every getContext and whether the WebGL context was given back.
 */
function fakeCanvas({ webgl = true, compiles = true } = {}) {
  const asked: string[] = [];
  let hadGl = false;
  const anything = (answer: (k: string | symbol) => unknown) => new Proxy({}, { get: (_, k) => answer(k) });
  const gl = anything((k) => k === "getShaderParameter" || k === "getProgramParameter" ? () => compiles
    : k === "getExtension" ? () => ({ loseContext: () => asked.push("given back") }) : () => ({}));
  const flat = anything(() => () => {});
  const canvas = {
    width: 200, height: 200,
    getContext(type: string) {
      asked.push(type);
      if (type === "webgl") return webgl ? ((hadGl = true), gl) : null;
      return hadGl ? null : flat;
    },
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, asked };
}

describe("drawing on any phone", () => {
  const mesh: Mesh = { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 5]), triangles: 1, min: [0, 0, 0], max: [10, 10, 5] };

  it("WebGL is tried once on a spare canvas, which is given back at once", () => {
    const good = fakeCanvas();
    expect(glCompiles(good.canvas)).toBe(true);
    expect(good.asked).toEqual(["webgl", "given back"]);
    expect(glCompiles(fakeCanvas({ compiles: false }).canvas)).toBe(false);
    expect(glCompiles(fakeCanvas({ webgl: false }).canvas)).toBe(false);
  });

  it("WebGL when it works, else the plain canvas, which never had WebGL; nothing at all: null (the box says there is no preview)", () => {
    const gl = fakeCanvas();
    const p = painterFor(gl.canvas, mesh, true);
    expect(p).not.toBeNull();
    p!.paint(turn(0, -1), tintOf(null));
    expect(gl.asked).toEqual(["webgl"]);
    // Its shaders failed on the spare canvas: the visible one goes straight to 2D.
    const flat = fakeCanvas({ compiles: false });
    const q = painterFor(flat.canvas, mesh, false);
    expect(q).not.toBeNull();
    q!.paint(turn(0.4, -1), tintOf("#FEC600"));
    expect(flat.asked).toEqual(["2d"]);
    // No WebGL on this canvas at all: 2D on the same one.
    const none = fakeCanvas({ webgl: false });
    expect(painterFor(none.canvas, mesh, true)).not.toBeNull();
    expect(none.asked).toEqual(["webgl", "2d"]);
    // WebGL said yes on the spare canvas but failed on this one: 2D is gone too, so nothing draws and the page says so.
    const spoiled = fakeCanvas({ compiles: false });
    expect(painterFor(spoiled.canvas, mesh, true)).toBeNull();
    expect(spoiled.asked).toEqual(["webgl", "2d"]);
  });

  it("the model shows in the colour the customer chose, not the spool it was weighed with", () => {
    const view = { design: WEIGHED, choice: { material: "PLA" as const, colors: [{ type: "PLA" as const, color: "#C12E1F" }], canChange: true, materialLocked: false } };
    expect(designColour(view)).toBe("#C12E1F");
    expect(designColour({ ...view, choice: { ...view.choice, colors: [] } })).toBe("#FEC600"); // no choice: the spool's colour
    expect(designColour({ design: { ...WEIGHED, colourHex: null }, choice: { ...view.choice, colors: [] } })).toBeNull();
  });
});

describe("the design field (order form and \"Add your design\")", () => {
  const picker = (file: File | null, error: string | null, locale: Locale = "en") =>
    render(<DesignPicker file={file} onFile={() => {}} error={error} onError={() => {}} label="Your design (one piece)" />, locale);

  it("empty: only the file field; a refused file: its reason under it, translated", () => {
    expect(text(picker(null, null))).toBe("");
    expect(picker(null, null)).toContain('<input type="file" aria-label="Your design (one piece)"/>');
    const bad = picker(null, "This STL file is broken or empty. Export it again and send it.", "id");
    expect(text(bad)).toBe("File STL ini rusak atau kosong. Ekspor ulang lalu kirim lagi.");
    expect(bad).toContain('class="alert bad"');
  });

  it("a picked file: Remove, and its 3D preview right under the field (nothing sent yet)", () => {
    const html = picker(new File([new Uint8Array(84)], "Clip.stl"), null);
    expect(text(html)).toBe("Remove file Reading your model… Clip.stl");
    expect(html.indexOf('type="file"')).toBeLessThan(html.indexOf('class="mp"'));
  });
});
