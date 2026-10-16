"use client";

// The customer's own model (STL or OBJ, one piece, up to 25 MB): the order form's file field and "Add your design" on
// the order page. Name and size are checked here (src/lib/file-rules.ts, the same rules as the server), the content on
// the server. The picked file shows at once in 3D with its size; nothing is sent until the customer sends it.
import { useEffect, useRef } from "react";
import { useT } from "@/i18n/client";
import { tLib } from "@/lib/lib-text";
import { NOT_A_MODEL, customerDesignProblem } from "@/lib/file-rules";
import { SNIFF_BYTES, modelName, sniffModel } from "@/lib/model-sniff";
import Info from "@/app/components/Info";
import ModelPreview from "./ModelPreview";

/** The ⓘ beside the field's title: what a design is for and what to send instead. */
export function DesignInfo() {
  const t = useT();
  return <Info>{t("Optional. One file is one piece: the price is multiplied by the quantity. STL or OBJ, up to 25 MB. Kesuni weighs it to set the price. For a 3MF or several colours, send the file on WhatsApp.")}</Info>;
}

export default function DesignPicker({ file, onFile, error, onError, label, disabled = false, color = null, onUnreadable }: {
  file: File | null; onFile: (f: File | null) => void;
  /** English (this field's or the server's): shown translated under the field. */
  error: string | null; onError: (e: string | null) => void;
  /** The field's name for screen readers (the title beside it). */
  label: string;
  disabled?: boolean;
  /** "#RRGGBB": the colour the customer picked, so the preview looks like their print. */
  color?: string | null;
  /** The picked file is no readable model (a broken STL): the preview says so, and the form keeps Send off. */
  onUnreadable?: (unreadable: boolean) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  // Taken off (removed, refused by the server, or sent): the field empties too, so the same file can be picked again.
  useEffect(() => { if (!file && input.current) input.current.value = ""; }, [file]);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const field = e.target;
    let picked = field.files?.[0] ?? null;
    let problem = picked ? customerDesignProblem(picked.name, picked.size) : null;
    // A phone may have renamed it ("model.stl.bin", "1000012345"): the first bytes say whether it is a model after all.
    if (picked && problem === NOT_A_MODEL) {
      const ext = await picked.slice(0, SNIFF_BYTES).arrayBuffer().then((b) => sniffModel(new Uint8Array(b), picked!.size), () => null);
      if (ext) {
        picked = new File([picked], modelName(picked.name, ext), { type: "application/octet-stream", lastModified: picked.lastModified });
        problem = customerDesignProblem(picked.name, picked.size);
      }
    }
    onError(problem);
    if (problem) field.value = "";
    onFile(problem ? null : picked);
  };
  return (
    <>
      <div className="dp-row">
        {/* No accept filter: phones grey out model files they have no app for. Name and size are checked here, the content on the server. */}
        <input ref={input} type="file" onChange={(e) => void pick(e)} disabled={disabled} aria-label={label} />
        {file && (
          <button type="button" className="quiet" onClick={() => { onFile(null); onError(null); }} disabled={disabled}>{t("Remove file")}</button>
        )}
      </div>
      {file && <ModelPreview source={file} name={file.name} color={color} onUnreadable={onUnreadable} />}
      {error && <p className="alert bad" role="status" style={{ margin: "10px 0 0" }}>{tLib(t, error)}</p>}
    </>
  );
}
