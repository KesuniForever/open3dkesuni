// One-time copy of an attachment's bytes (design file, reference image, QC photo) after the database import.
// POST /api/admin/import-file?key=<storageKey>, body from scripts/railway-import-db.mjs.
// Only for an attachment the database already knows, with exactly its recorded size, and never over a file that is
// already there. Needs OPERATOR_PASSWORD and Basic auth with it.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fileStore, MAX_BYTES } from "@/lib/files";
import { readUpload, refuse } from "../shared";

const KEY = /^(F-[A-Za-z0-9-]{1,40})(\.[a-z0-9]{1,5})$/;

export async function POST(req: Request) {
  const no = refuse(req);
  if (no) return no;
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const m = KEY.exec(key);
  const attachment = m ? store.getAttachment(m[1]) : undefined;
  if (!attachment || attachment.storageKey !== key) return NextResponse.json({ error: "No attachment with this key in the database" }, { status: 404 });

  const existing = await fileStore().get(key).catch(() => undefined);
  const up = await readUpload(req, MAX_BYTES);
  if (!up.ok) return NextResponse.json({ error: up.error }, { status: up.status });
  if (up.bytes.byteLength !== attachment.size) {
    return NextResponse.json({ error: `Expected ${attachment.size} bytes for ${key}, got ${up.bytes.byteLength}` }, { status: 400 });
  }
  if (existing) {
    const same = createHash("sha256").update(existing).digest("hex") === createHash("sha256").update(up.bytes).digest("hex");
    return same
      ? NextResponse.json({ ok: true, key, alreadyThere: true })
      : NextResponse.json({ error: `${key} is already on the server with different content; not overwritten` }, { status: 409 });
  }
  await fileStore().put(key, new Uint8Array(up.bytes));
  return NextResponse.json({ ok: true, key, bytes: up.bytes.byteLength }, { status: 201 });
}
