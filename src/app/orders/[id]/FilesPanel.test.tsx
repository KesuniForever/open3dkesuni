import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/i18n/client";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import type { Attachment, Order } from "@/lib/types";
import { QC_REMOVABLE, qcPhotoLocked } from "@/lib/file-rules";
import { tLib } from "@/lib/lib-text";
import FilesPanel, { removalNote, removeFileRequest } from "./FilesPanel";

// The Files card on the order page as the server renders it first: ORD-004 had the same STL uploaded three times.
const AT = "2026-10-15T16:31:00.000Z"; // 23:31 in Jakarta
const order: Order = {
  id: "ORD-9", jobId: "J", product: "Scraper", quantity: 1, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 10_000_000,
  status: "IN_PRODUCTION", label: "simulated",
};
const file = (id: string, over: Partial<Attachment> = {}): Attachment => ({
  id, orderId: "ORD-9", kind: "design", filename: "obj_1_scraper.stl", size: 1_258_291, mime: "model/stl", uploadedBy: "Khelda", at: AT,
  storageKey: `${id}.stl`, ...over,
});
const files = [
  file("F-1"), file("F-2", { at: "2026-10-15T16:38:00.000Z" }),
  file("F-3", { kind: "qc_photo", filename: "qc 1.png", mime: "image/png", size: 40_000 }),
];
const render = (attachments: Attachment[], locale: Locale = "en") => renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <FilesPanel order={order} attachments={attachments} onChange={() => {}} />
  </LocaleProvider>,
);
const en = makeT("en", ID);
const id = makeT("id", ID);

describe("order page: Files", () => {
  it("every file row has a quiet Remove button that names its file and upload time; the dialog stays closed", () => {
    const html = render(files);
    const buttons = [...html.matchAll(/<button type="button"[^>]*aria-label="([^"]+)"[^>]*class="quiet"[^>]*>([^<]+)<\/button>/g)];
    // The same name uploaded twice is told apart by the time.
    expect(buttons.map((m) => [m[1], m[2]])).toEqual([
      ["Remove obj_1_scraper.stl · 15 Oct, 23:31", "Remove"], ["Remove obj_1_scraper.stl · 15 Oct, 23:38", "Remove"],
      ["Remove qc 1.png · 15 Oct, 23:31", "Remove"],
    ]);
    expect(html).toMatch(/<dialog [^>]*aria-label="Remove this file\?"><\/dialog>/); // closed: no content until a click
    expect(html).toMatch(/1\.2 MB · by Khelda · 15 Oct, 23:31/);
  });

  it("no Remove button without files", () => {
    const html = render([]);
    expect(html).toMatch(/No files yet\./);
    expect(html).not.toMatch(/class="quiet"/);
  });

  it("in Indonesian", () => {
    const html = render(files, "id");
    expect(html).toMatch(/aria-label="Hapus obj_1_scraper\.stl · 15 Okt, 23\.31"[^>]*>Hapus<\/button>/);
    expect(html).toMatch(/aria-label="Hapus qc 1\.png · /);
    expect(html).not.toMatch(/>Remove</);
  });

  it("the removal request is a DELETE with a JSON body (the route reads only JSON), ids encoded", () => {
    const [url, init] = removeFileRequest("ORD-004", "F-1/../x", "Khelda");
    expect(url).toBe("/api/orders/ORD-004/files/F-1%2F..%2Fx");
    expect(init).toEqual({ method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: "Khelda" }) });
  });

  it("the note after a removal: done, the stored copy that stayed, or the refusal in the page language", () => {
    expect(removalNote("a.stl", true, { bytesRemoved: true }, en)).toEqual({ ok: true, text: "a.stl removed.", at: "list" });
    expect(removalNote("a.stl", true, { bytesRemoved: false }, en).text).toBe("a.stl removed; the stored copy stayed.");
    expect(removalNote("a.stl", true, { bytesRemoved: false }, id).text).toBe("a.stl dihapus; salinan tersimpannya masih ada.");
    expect(removalNote("a.stl", true, {}, id).text).toBe("a.stl dihapus.");
    const refused = removalNote("a.stl", false, {
      error: "The file cannot be removed now", reasons: ["Print job PJ-7 is still using this file: cancel or stop the print first"],
    }, id);
    expect(refused).toMatchObject({ ok: false, text: "File belum bisa dihapus", at: "list" });
    expect(tLib(id, refused.reasons![0])).toBe("Job cetak PJ-7 masih memakai file ini: batalkan atau hentikan cetakannya dulu");
    expect(removalNote("a.stl", false, {}, en).text).toBe("Request failed");
  });

  it("a QC photo is locked once the evidence is submitted: the page and the server use the same rule", () => {
    expect(QC_REMOVABLE).toEqual(["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION"]);
    expect(qcPhotoLocked("IN_PRODUCTION")).toBeNull();
    const why = qcPhotoLocked("EVIDENCE_SUBMITTED")!;
    expect(why).toBe("Order is EVIDENCE_SUBMITTED; a QC photo stays once evidence is submitted");
    expect(tLib(id, why)).toBe("Pesanan berstatus BUKTI DIKIRIM; foto QC tetap disimpan setelah bukti dikirim");
  });
});
