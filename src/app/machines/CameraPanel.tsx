"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Printer } from "@/lib/types";
import { ago } from "@/lib/machines";
import { tLib } from "@/lib/lib-text";
import { useT } from "@/i18n/client";
import { useOperatorName } from "../components/PrinterControls";

/** While the camera is open: ask the bridge for a new frame and show the newest one this often. */
const REFRESH_MS = 10_000;
/** The bridge needs a moment to grab and send a frame (an A1 sends one every 2-2.5 s). */
const FETCH_AFTER_MS = 4_000;
/** A frame older than this is marked old. */
const OLD_MS = 2 * 60_000;

/**
 * The printer's camera, one still frame at a time: the A1 has no live video over LAN, only a slow JPEG stream that the
 * bridge reads. "Show camera" asks the bridge for a frame (a read-only request with the person's name) and refreshes
 * every 10 s while open. Operator pages only: frames show the studio.
 */
export default function CameraPanel({ printer }: { printer: Printer }) {
  const t = useT();
  const [name, setName] = useOperatorName();
  const [viewer, setViewer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [frame, setFrame] = useState<{ url: string; at: string } | null>(null);
  const [status, setStatus] = useState<"loading" | "shown" | "none" | "error">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const urlRef = useRef<string | null>(null);
  const id = printer.id;
  const s = printer.snapshot;

  const showFrame = useCallback(async () => {
    try {
      const r = await fetch(`/api/printers/${id}/camera`, { cache: "no-store" });
      setClock(Date.now());
      if (r.status === 404) { setStatus((x) => (x === "shown" ? x : "none")); return; }
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const at = r.headers.get("x-frame-at") ?? "";
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setFrame({ url, at });
      setStatus("shown");
    } catch {
      setStatus((x) => (x === "shown" ? x : "error"));
    }
  }, [id]);

  const requestFrame = useCallback(async (by: string) => {
    try {
      const r = await fetch(`/api/printers/${id}/command`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "camera_snapshot", by }),
      });
      if (r.ok) { setProblem(null); return; }
      const j = (await r.json().catch(() => ({}))) as { error?: string; reasons?: string[] };
      // A request already waiting, or one less than 3 s ago, is fine: the next frame answers both.
      if (r.status === 429 || j.error === "The same command is already waiting for the bridge") return;
      setProblem(j.reasons?.length ? j.reasons.map((x) => tLib(t, x)).join("; ") : tLib(t, j.error ?? `HTTP ${r.status}`));
    } catch {
      setProblem(t("Request failed"));
    }
  }, [id, t]);

  useEffect(() => {
    if (!viewer) return;
    const round = async () => { await showFrame(); await requestFrame(viewer); };
    void round();
    const later = setTimeout(() => void showFrame(), FETCH_AFTER_MS);
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void round();
    }, REFRESH_MS);
    return () => { clearTimeout(later); clearInterval(timer); };
  }, [viewer, showFrame, requestFrame]);

  // Free the last frame when the panel goes away.
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  if (s?.camera && !s.camera.available) return null;

  function open(by: string) {
    setAsking(false);
    setStatus("loading");
    setViewer(by);
  }
  function close() {
    setViewer(null);
    setAsking(false);
  }

  if (!viewer) {
    return asking ? (
      <form className="mach-ask" onSubmit={(e) => { e.preventDefault(); if (name.trim()) open(name.trim()); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Your name")} aria-label={t("Your name")} autoFocus />
        <button type="submit" className="primary" disabled={!name.trim()}>{t("Show camera")}</button>
        <button type="button" onClick={() => setAsking(false)}>{t("Cancel")}</button>
      </form>
    ) : (
      <div className="mach-actions">
        <button onClick={() => (name.trim() ? open(name.trim()) : setAsking(true))}>{t("Show camera")}</button>
      </div>
    );
  }

  const age = frame?.at ? clock - Date.parse(frame.at) : null;
  return (
    <div className="mach-cam">
      <div className="mach-cam-view">
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frame.url} alt={t("Camera of {printer}", { printer: printer.name })} />
        ) : (
          <div className="mach-cam-empty">
            {status === "loading" ? t("Asking the bridge for a frame…")
              : status === "error" ? t("Could not load the camera frame.")
              : <>
                <b>{t("No camera frame yet.")}</b>
                <span>{t("The LAN bridge sends one when asked. If none arrives, the bridge needs the camera update.")}</span>
              </>}
          </div>
        )}
      </div>
      <div className="mach-cam-foot">
        <span className={age !== null && age > OLD_MS ? "mach-warn" : "muted"}>
          {frame?.at ? t("Frame from {ago}", { ago: ago(frame.at, clock, t) }) : t("Refreshes every 10 s")}
          {s?.light === "off" && <> · {t("light is off")}</>}
        </span>
        <button onClick={close}>{t("Hide camera")}</button>
      </div>
      {problem && <p className="mach-note bad" role="status">{problem}</p>}
    </div>
  );
}
