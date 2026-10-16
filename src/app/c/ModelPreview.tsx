"use client";

// The customer's model in 3D: under the file field of the order form (the picked file, nothing sent yet) and on their
// order page (their own design from GET /api/c/<token>/design). Read in steps (src/lib/mesh.ts), so the page never
// freezes, then drawn with WebGL as flat-shaded triangles, or with a plain canvas on a device without WebGL. Drag or the
// arrow keys turn it; it turns slowly by itself until touched, unless the visitor asked for less motion.
import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { dateLocale, type Locale } from "@/i18n/core";
import { decimate, decimateSteps, faceNormals, readMeshAsync, runAsync, sizeOf, type Mesh, type Vec3 } from "@/lib/mesh";
import "./customer.css";

/** Triangles drawn at most with WebGL (bigger models are simplified for the screen only). */
export const DRAW_MAX = 150_000;
/** Without WebGL every triangle is painted one by one: far fewer. */
const PAINT_MAX = 12_000;
/** On the order page a bigger model waits for a tap before it downloads (phones on mobile data). */
export const AUTO_LOAD_BYTES = 8 * 1024 * 1024;
/** The first view: turned a little, seen from a little above (radians). */
const START = { yaw: -0.6, pitch: -1.1 };
const SPIN_PER_MS = 0.00035;
/** Arrow keys turn it too: [yaw, pitch] in radians. */
const KEYS: Record<string, [number, number]> = { ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0], ArrowUp: [0, -0.2], ArrowDown: [0, 0.2] };
/** The model's colour when the customer chose none: a neutral grey, so no colour looks chosen. */
const DEFAULT_TINT = "#A7ADB4";

/** failed + unreadable: a picked file that is not a readable model (src/lib/mesh.ts gave UNREADABLE), so it is not sent. */
export type ModelState = { state: "ask" } | { state: "reading" } | { state: "ready"; mesh: Mesh; sizeMm: Vec3 } | { state: "failed"; unreadable?: boolean };
/** src/lib/mesh.ts's reason for a file with no triangles or impossible numbers (a broken export). Too big to show, the
 *  network or a phone that cannot draw are not that: such a file may still be sent. */
export const UNREADABLE = "The model could not be read";

/** "40 × 20 × 10.5 mm", with the visitor's decimal comma or point. */
export const sizeText = (s: Vec3, locale: Locale): string =>
  `${s.map((n) => n.toLocaleString(dateLocale(locale), { maximumFractionDigits: 1 })).join(" × ")} mm`;

/**
 * The model from a picked file or the order page's link, read and simplified in steps between frames. null: not asked
 * yet ("ask"). Anything that goes wrong (a broken file, the network) is "failed": the page then says there is no preview.
 */
function useModel(source: File | string | null, name: string): ModelState {
  const [done, setDone] = useState<{ source: File | string; model: ModelState } | null>(null);
  useEffect(() => {
    if (!source) return;
    const stop = new AbortController();
    const read = async (): Promise<ModelState> => {
      const bytes = typeof source === "string"
        ? await fetch(source, { signal: stop.signal }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        : await source.arrayBuffer();
      const r = await readMeshAsync(name, new Uint8Array(bytes), stop.signal);
      if (!r.ok) return { state: "failed", unreadable: typeof source !== "string" && r.reason === UNREADABLE };
      return { state: "ready", mesh: await runAsync(decimateSteps(r.mesh, DRAW_MAX), stop.signal), sizeMm: sizeOf(r.mesh) };
    };
    read().then(
      (model) => { if (!stop.signal.aborted) setDone({ source, model }); },
      () => { if (!stop.signal.aborted) setDone({ source, model: { state: "failed" } }); },
    );
    return () => stop.abort();
  }, [source, name]);
  if (!source) return { state: "ask" };
  return done?.source === source ? done.model : { state: "reading" };
}

/**
 * The preview. `source`: a picked File (the order form) or the link to the customer's design (the order page; with
 * `bytes` above AUTO_LOAD_BYTES it waits for a tap). `sizeMm` from the server when known, else measured here.
 * `color` "#RRGGBB" tints the model (the customer's colour); `compact` is the small version beside the name.
 * `onUnreadable` hears whether a picked file turned out not to be a readable model (the form then does not send it).
 */
export default function ModelPreview({ source, name, sizeMm = null, bytes = 0, color = null, compact = false, onUnreadable }: {
  source: File | string; name: string; sizeMm?: Vec3 | null; bytes?: number; color?: string | null; compact?: boolean;
  onUnreadable?: (unreadable: boolean) => void;
}) {
  const [asked, setAsked] = useState(false);
  const wait = typeof source === "string" && bytes > AUTO_LOAD_BYTES && !asked;
  const model = useModel(wait ? null : source, name);
  const unreadable = model.state === "failed" && model.unreadable === true;
  useEffect(() => { onUnreadable?.(unreadable); }, [unreadable, onUnreadable]);
  return <ModelBox model={model} name={name} sizeMm={sizeMm} color={color} compact={compact} onAsk={() => setAsked(true)} />;
}

/** What the preview shows in each state (the tests render this one). */
export function ModelBox({ model, name, sizeMm = null, color = null, compact = false, onAsk }: {
  model: ModelState; name: string; sizeMm?: Vec3 | null; color?: string | null; compact?: boolean; onAsk?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  // The model that was read but could not be drawn here (no way to draw, or the drawing was lost for good).
  const [undrawn, setUndrawn] = useState<Mesh | null>(null);
  const size = sizeMm ?? (model.state === "ready" ? model.sizeMm : null);
  // A file this page cannot draw: one quiet line. The server still decides whether it can be used. A picked file that
  // is no readable model at all says what to do instead.
  if (model.state === "failed" || (model.state === "ready" && model.mesh === undrawn)) {
    const unreadable = model.state === "failed" && model.unreadable === true;
    return (
      <p className={unreadable ? "alert bad" : "mp-failed"} role="status" style={unreadable ? { margin: "10px 0 0" } : undefined}>
        <b>{name}</b>{size && <> · {sizeText(size, locale)}</>}<br />
        {unreadable ? t("This file can't be opened. Ask your designer for a new STL.") : t("No 3D preview for this file.")}
      </p>
    );
  }
  return (
    <figure className={`mp${compact ? " compact" : ""}`}>
      <div className="mp-view">
        {model.state === "ready" ? <ModelCanvas mesh={model.mesh} color={color} label={t("3D view of your model. Drag to turn it.")} onFail={setUndrawn} />
          : model.state === "ask" ? <button type="button" onClick={onAsk}>{t("Show 3D view")}</button>
            : <span className="muted" role="status">{t("Reading your model…")}</span>}
      </div>
      <figcaption><b>{name}</b>{size && <span>{sizeText(size, locale)}</span>}</figcaption>
    </figure>
  );
}

// ---------- drawing ----------

/** The turn of the model: about its own vertical axis (yaw, models stand on z), then tilted towards the viewer (pitch).
 *  A 3×3 matrix by columns (WebGL's order). Pitch -π/2 looks at the front, 0 from the top. */
export function turn(yaw: number, pitch: number): Float32Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return new Float32Array([cy, cp * sy, sp * sy, -sy, cp * cy, sp * cy, 0, -sp, cp]);
}

/** "#RRGGBB" as 0..1 parts, lifted a little so a black model still shows its shading. */
export function tintOf(hex: string | null): Vec3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "") ?? /^#?([0-9a-f]{6})$/i.exec(DEFAULT_TINT)!;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => 0.18 + 0.82 * (c / 255)) as Vec3;
}

/** The middle of the model's box and the scale that puts its corners on a sphere of radius 1: it fits in any turn. */
function fit(m: Mesh): { center: Vec3; scale: number } {
  const center = [0, 1, 2].map((i) => (m.min[i] + m.max[i]) / 2) as Vec3;
  const radius = Math.hypot(m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]) / 2;
  return { center, scale: radius > 0 ? 1 / radius : 1 };
}

/** Light from the viewer's upper right; both sides of a face are lit (exported files often have faces the wrong way). */
const LIGHT: Vec3 = [0.3, 0.45, 0.84];
const shade = (dot: number) => 0.32 + 0.68 * Math.abs(dot);

export interface Painter { paint(r: Float32Array, tint: Vec3): void; dispose(): void }

const VS = `attribute vec3 p; attribute vec3 n;
uniform mat3 r; uniform vec3 c; uniform float k; uniform vec2 s;
varying float l;
void main() {
  vec3 q = r * ((p - c) * k);
  l = 0.32 + 0.68 * abs(dot(normalize(r * n), vec3(${LIGHT.join(", ")})));
  gl_Position = vec4(q.x * s.x, q.y * s.y, -q.z * 0.5, 1.0);
}`;
const FS = "precision mediump float; varying float l; uniform vec3 t; void main() { gl_FragColor = vec4(t * l, 1.0); }";

function webgl(canvas: HTMLCanvasElement): WebGLRenderingContext | null {
  try {
    return canvas.getContext("webgl", { antialias: true });
  } catch {
    return null;
  }
}

/** The shaders, compiled and linked; null when this device cannot. */
function program(gl: WebGLRenderingContext): { vs: WebGLShader; fs: WebGLShader; prog: WebGLProgram } | null {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS), prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? { vs, fs, prog } : null;
}

/** WebGL that runs these shaders, tried on a spare canvas: a canvas that once had WebGL can never draw in 2D. */
export function glCompiles(spare: HTMLCanvasElement): boolean {
  const gl = webgl(spare);
  const ok = Boolean(gl && program(gl));
  gl?.getExtension("WEBGL_lose_context")?.loseContext(); // gives the spare context back at once
  return ok;
}

let glChecked: boolean | undefined;
/** Tried once per page. */
const glWorks = () => (glChecked ??= glCompiles(document.createElement("canvas")));

/** WebGL when it works here, else the plain canvas; null when neither can draw on this canvas (the box then says so). */
export function painterFor(canvas: HTMLCanvasElement, mesh: Mesh, gl: boolean = glWorks()): Painter | null {
  return (gl ? glPainter(canvas, mesh) : null) ?? canvasPainter(canvas, mesh);
}

function glPainter(canvas: HTMLCanvasElement, mesh: Mesh): Painter | null {
  const gl = webgl(canvas);
  const made = gl && program(gl);
  if (!gl || !made) return null;
  const { vs, fs, prog } = made;
  gl.useProgram(prog);
  const buffer = (data: Float32Array, name: string) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const at = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 0, 0);
    return b;
  };
  const buffers = [buffer(mesh.positions, "p"), buffer(faceNormals(mesh.positions), "n")];
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const { center, scale } = fit(mesh);
  gl.uniform3fv(u("c"), center);
  gl.uniform1f(u("k"), scale);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  return {
    paint(r, tint) {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      const side = Math.min(w, h);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u("s"), (0.94 * side) / w, (0.94 * side) / h);
      gl.uniformMatrix3fv(u("r"), false, r);
      gl.uniform3fv(u("t"), tint);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles * 3);
    },
    dispose() {
      for (const b of buffers) gl.deleteBuffer(b);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}

/** Without WebGL: the triangles painted far to near (painter's order), at most PAINT_MAX of them. */
function canvasPainter(canvas: HTMLCanvasElement, full: Mesh): Painter | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const mesh = decimate(full, PAINT_MAX);
  const p = mesh.positions, normals = faceNormals(p), count = mesh.triangles;
  const { center, scale } = fit(mesh);
  const xy = new Float32Array(count * 6), depth = new Float32Array(count);
  const order = Array.from({ length: count }, (_, i) => i);
  return {
    paint(r, tint) {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return;
      const half = 0.47 * Math.min(w, h);
      for (let i = 0; i < count; i++) {
        let z = 0;
        for (let k = 0; k < 3; k++) {
          const o = i * 9 + k * 3;
          const x = (p[o] - center[0]) * scale, y = (p[o + 1] - center[1]) * scale, zz = (p[o + 2] - center[2]) * scale;
          xy[i * 6 + k * 2] = w / 2 + (r[0] * x + r[3] * y + r[6] * zz) * half;
          xy[i * 6 + k * 2 + 1] = h / 2 - (r[1] * x + r[4] * y + r[7] * zz) * half;
          z += r[2] * x + r[5] * y + r[8] * zz;
        }
        depth[i] = z;
      }
      order.sort((a, b) => depth[a] - depth[b]);
      // The light turned back into the model's frame once, instead of every normal into the viewer's.
      const lt = [0, 1, 2].map((c) => r[c * 3] * LIGHT[0] + r[c * 3 + 1] * LIGHT[1] + r[c * 3 + 2] * LIGHT[2]);
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 0.6;
      for (const i of order) {
        const l = shade(normals[i * 9] * lt[0] + normals[i * 9 + 1] * lt[1] + normals[i * 9 + 2] * lt[2]);
        const colour = `rgb(${tint.map((c) => Math.round(c * l * 255)).join(",")})`;
        ctx.fillStyle = colour;
        ctx.strokeStyle = colour; // hides the hairline gaps between neighbours
        ctx.beginPath();
        ctx.moveTo(xy[i * 6], xy[i * 6 + 1]);
        ctx.lineTo(xy[i * 6 + 2], xy[i * 6 + 3]);
        ctx.lineTo(xy[i * 6 + 4], xy[i * 6 + 5]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    },
    dispose() {},
  };
}

/** `onFail(mesh)`: nothing can draw it here, or a lost WebGL drawing did not come back. */
function ModelCanvas({ mesh, color, label, onFail }: { mesh: Mesh; color: string | null; label: string; onFail: (m: Mesh) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tint = useRef<Vec3>(tintOf(color));
  const redraw = useRef<() => void>(() => {});

  // Another colour picked: the same model, painted again.
  useEffect(() => {
    tint.current = tintOf(color);
    redraw.current();
  }, [color]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let painter = painterFor(canvas, mesh);
    if (!painter) {
      onFail(mesh);
      return;
    }
    const view = { ...START };
    let spinning = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let visible = true;
    let frame = 0;
    let last = 0;
    const loop = (time: number) => {
      frame = 0;
      if (!painter) return;
      if (spinning && visible) {
        view.yaw += last ? Math.min(time - last, 64) * SPIN_PER_MS : 0;
        last = time;
        frame = requestAnimationFrame(loop);
      } else last = 0;
      painter.paint(turn(view.yaw, view.pitch), tint.current);
    };
    const ask = () => { if (!frame && painter) frame = requestAnimationFrame(loop); };
    redraw.current = ask;

    // A phone may take WebGL away while the page is in the background (WhatsApp and back): wait for it, then draw again.
    const lost = (e: Event) => {
      e.preventDefault(); // tells the browser this page wants it back
      cancelAnimationFrame(frame);
      frame = 0;
      painter = null;
    };
    const restored = () => {
      painter = glPainter(canvas, mesh);
      if (painter) ask();
      else onFail(mesh);
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ask();
    };
    const sized = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    sized?.observe(canvas);
    resize();
    // Off screen it stops turning (battery); back on screen it goes on.
    const seen = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) ask(); })
      : null;
    seen?.observe(canvas);

    let drag: { id: number; x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      spinning = false;
      canvas.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      view.yaw += (e.clientX - drag.x) * 0.01;
      view.pitch = Math.min(0, Math.max(-Math.PI, view.pitch + (e.clientY - drag.y) * 0.01));
      drag = { ...drag, x: e.clientX, y: e.clientY };
      ask();
    };
    const up = (e: PointerEvent) => { if (drag?.id === e.pointerId) drag = null; };
    const key = (e: KeyboardEvent) => {
      const step = KEYS[e.key];
      if (!step) return;
      e.preventDefault();
      spinning = false;
      view.yaw += step[0];
      view.pitch = Math.min(0, Math.max(-Math.PI, view.pitch + step[1]));
      ask();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      redraw.current = () => {};
      sized?.disconnect();
      seen?.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("keydown", key);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      painter?.dispose();
    };
  }, [mesh, onFail]);

  return <canvas ref={ref} role="img" aria-label={label} tabIndex={0} />;
}
