"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CustomerView as View } from "@/lib/customer";

const EXPLORER = "https://explorer.testnet.arc.io/tx/";
const STEPS = ["Pesanan diterima", "Harga dan pembayaran", "Dicetak", "Cek kualitas", "Selesai"];
const TX_TEXT: Record<string, string> = {
  customer_topup: "USDC uji coba dikirim ke dompetmu",
  deposit: "Kamu membayar ke escrow",
  release: "Escrow diteruskan ke Kesuni",
  refund: "Escrow dikembalikan ke kamu",
};

const noop = () => () => {};
const usdc = (s: string) => s.replace(".", ",");
const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const done = (state: string) => state === "COMPLETE";
const broken = (state: string) => ["FAILED", "DENIED", "CANCELLED"].includes(state);

function stepOf(v: View): number {
  const s = v.order.status;
  if (["ACCEPTED", "PAID", "REJECTED"].includes(s)) return 4;
  if (s === "CREATED") return 0;
  const funded = v.escrow && v.escrow.state !== "AWAITING_DEPOSIT";
  if (!funded) return 1;
  return s === "EVIDENCE_SUBMITTED" ? 3 : 2;
}

function headline(v: View): { title: string; sub: string } {
  const s = v.order.status;
  const funded = v.escrow && v.escrow.state !== "AWAITING_DEPOSIT";
  if (s === "PAID") return { title: "Selesai. Terima kasih!", sub: "Pembayaranmu sudah diteruskan ke Kesuni." };
  if (s === "ACCEPTED") return { title: "Terima kasih!", sub: "Agen sedang meneruskan pembayaran dari escrow ke Kesuni." };
  if (s === "REJECTED") return v.escrow?.state === "REFUNDED"
    ? { title: "Uangmu sudah dikembalikan", sub: "Kesuni akan menghubungimu soal perbaikan." }
    : { title: "Uangmu sedang dikembalikan", sub: "Agen mengembalikan isi escrow ke dompetmu." };
  if (s === "CREATED") return { title: "Kesuni sedang menyiapkan harga", sub: "Kami cek desain dan printer dulu. Harga akan muncul di halaman ini." };
  if (!funded) return v.paying
    ? { title: "Pembayaran sedang diproses…", sub: "Biasanya kurang dari satu menit. Halaman ini memperbarui sendiri." }
    : { title: "Harga sudah siap", sub: "Bayar dulu ke escrow. Uangnya baru diteruskan ke Kesuni setelah kamu menerima barangnya." };
  if (s === "EVIDENCE_SUBMITTED") return { title: "Barangmu sudah jadi!", sub: "Lihat foto hasil cek kualitas, lalu putuskan: terima atau tolak." };
  if (v.printing && ["RUNNING", "PREPARE", "SLICING"].includes(v.printing.state)) return { title: "Sedang dicetak", sub: `Di printer ${v.printing.printer}. Progresnya langsung dari printer.` };
  if (v.printing?.state === "PAUSE") return { title: "Cetakan dijeda sebentar", sub: "Operator Kesuni sedang mengurusnya (misalnya ganti filament)." };
  if (v.printedOn) return { title: "Selesai dicetak", sub: "Sekarang diambil dari printer dan dicek kualitasnya." };
  return { title: "Pembayaran aman di escrow", sub: "Pesananmu sedang menunggu giliran cetak." };
}

export default function CustomerView({ token }: { token: string }) {
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; reasons?: string[] } | null>(null);
  const fresh = useSyncExternalStore(noop, () => new URLSearchParams(window.location.search).has("baru"), () => false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/c/${token}`, { cache: "no-store" });
      if (res.status === 404) return setMissing(true);
      if (res.ok) setV(await res.json());
    } catch { /* offline for a moment: keep the last view */ }
  }, [token]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (!document.hidden) void load(); }, 4000);
    const onShow = () => { if (!document.hidden) void load(); }; // back from WhatsApp: refresh at once
    document.addEventListener("visibilitychange", onShow);
    return () => { clearTimeout(first); clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/c/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) setError({ text: data.error, reasons: data.reasons });
      else if (data.settled === false) setError({ text: "Keputusanmu sudah tercatat, tapi pembayaran ditahan pengaman. Kesuni sudah diberi tahu.", reasons: data.reasons });
      await load();
    } catch {
      setError({ text: "Koneksi terputus. Coba lagi." });
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <main className="cust"><p>Link pesanan ini tidak ditemukan. Cek lagi link dari Kesuni.</p></main>;
  if (!v) return <main className="cust"><p className="muted">Memuat pesanan…</p></main>;

  const step = stepOf(v);
  const h = headline(v);
  const s = v.order.status;
  const canPay = step === 1 && v.price && !v.paying && ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(s);
  const canDecide = s === "EVIDENCE_SUBMITTED" && v.escrow?.state === "FUNDED";
  const printingNow = v.printing && v.printing.state !== "FINISH" && v.printing.state !== "IDLE" && step === 2;
  const photos = v.updates.filter((u) => u.photo);
  const txs = v.escrow?.txs ?? [];

  return (
    <main className="cust">
      <header className="cust-top">
        <span className="brand">Kesuni 3D</span>
        <span className="muted">{v.order.customerName ? `Pesanan ${v.order.customerName}` : v.order.id}</span>
      </header>

      {fresh && (
        <div className="alert ok" style={{ marginBottom: 16 }}>
          Pesanan terkirim. <b>Simpan link halaman ini</b>: semua kabar pesananmu muncul di sini.
        </div>
      )}

      <section className="cust-hero">
        <p className="cust-eyebrow">
          {v.order.quantity} × {v.order.product}
          {v.order.label === "simulated" && <> <span className="badge simulated">pesanan uji coba</span></>}
        </p>
        <h1>{h.title}</h1>
        <p className="muted">{h.sub}</p>

        {printingNow && v.printing && (
          <div className="cust-progress" aria-label={`Progres cetak ${Math.round(v.printing.percent)} persen`}>
            <div className="bar"><span style={{ width: `${Math.max(2, v.printing.percent)}%` }} /></div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 14 }}>
              <span><span className={`live-dot ${v.printing.online ? "" : "off"}`} /> {v.printing.printer}</span>
              <span><b>{Math.round(v.printing.percent)}%</b>{v.printing.remainingMin != null && ` · sisa ±${v.printing.remainingMin} menit`}</span>
            </div>
            {!v.printing.online && <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>Koneksi ke printer terputus sebentar. Angka akan diperbarui lagi.</p>}
          </div>
        )}

        {canPay && v.price && (
          <div className="cust-pay">
            <div className="cust-price">
              <span className="big">{usdc(v.price.usdc)} USDC</span>
              <span className="muted">≈ {rupiah(v.price.idr)} · estimasi {v.price.etaHours} jam</span>
            </div>
            <AgreeAndPay v={v} busy={busy} onPay={act} />
            <ul className="cust-promise">
              <li>Uangmu <b>tidak langsung</b> ke Kesuni. Disimpan dulu di <b>escrow</b> (dompet pengaman).</li>
              <li>Baru diteruskan ke Kesuni setelah kamu klik <b>Terima</b>.</li>
              <li>Kalau kamu klik <b>Tolak</b>, uangnya dikembalikan utuh.</li>
            </ul>
            <p className="cust-note">Uji coba di jaringan <b>Arc Testnet</b>: USDC uji coba dikirim otomatis ke dompetmu. Tidak ada uang sungguhan yang dipakai.</p>
          </div>
        )}

        {["ACCEPTED", "PAID"].includes(s) && !v.review && (
          <ReviewForm defaultName={v.order.customerName ?? ""} busy={busy} onSend={act} />
        )}

        {canDecide && (
          <Decide defaultName={v.order.customerName ?? ""} busy={busy} photos={photos.map((p) => p.photo!)} onDecide={act} />
        )}

        {error && (
          <div className="alert bad" role="status">
            {error.text}
            {error.reasons && error.reasons.length > 0 && <ul>{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </div>
        )}
      </section>

      <ol className="cust-steps" aria-label="Tahap pesanan">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step || (i === 4 && step === 4) ? "done" : i === step ? "now" : ""}>
            <span className="dot">{i < step || (i === 4 && step === 4) ? "✓" : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {txs.length > 0 && (
        <section className="card">
          <h2>Bukti pembayaran di blockchain <span className="badge">{v.escrow!.label}</span></h2>
          <ul className="cust-list">
            {txs.map((t) => (
              <li key={t.at + t.kind}>
                <span className={`tick ${done(t.state) ? "ok" : broken(t.state) ? "bad" : ""}`}>{done(t.state) ? "✓" : broken(t.state) ? "!" : "…"}</span>
                <div>
                  <div>{TX_TEXT[t.kind]} · {usdc(t.amountUsdc)} USDC</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {done(t.state) ? "berhasil" : broken(t.state) ? "gagal, Kesuni akan mengurus" : "sedang dikonfirmasi"} · {when(t.at)}
                    {t.txHash && <> · <a href={`${EXPLORER}${t.txHash}`} target="_blank" rel="noreferrer">lihat bukti</a></>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.updates.length > 0 && (
        <section className="card">
          <h2>Kabar terbaru</h2>
          <ul className="cust-list">
            {[...v.updates].reverse().map((u) => (
              <li key={u.at + u.note}>
                <span className="tick">{u.label === "device" ? "⚙" : u.kind === "qc" ? "✓" : u.photo ? "▣" : "•"}</span>
                <div>
                  <div>{u.note}{u.photo && <> · <a href={u.photo} target="_blank" rel="noreferrer">lihat foto</a></>}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{when(u.at)} · {u.label === "device" ? "langsung dari printer" : "dicatat operator"}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canPay && (v.spec || v.agreement) && (
        <section className="card">
          <h2>Kesepakatan</h2>
          {v.spec && <SpecList spec={v.spec} deadline={v.order.deadline} />}
          {v.agreement && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              Disetujui {v.agreement.by} · {when(v.agreement.at)} · versi {v.agreement.version}
              {!v.agreement.current && <> · <b>ada perubahan, perlu disetujui ulang</b></>}
              <br />Sidik jari: <span className="fingerprint">{v.agreement.hash.slice(0, 16)}…</span> (berubah kalau harga atau spesifikasi diubah)
            </p>
          )}
        </section>
      )}

      {v.actual && (
        <section className="card">
          <h2>Laporan produksi</h2>
          <dl className="calc-kv">
            <div><dt>Filament terpakai</dt><dd>{v.actual.filamentGrams} g</dd></div>
            <div><dt>Waktu mesin</dt><dd>{String(v.actual.machineHours).replace(".", ",")} jam</dd></div>
            <div><dt>Selisih ukuran terbesar</dt><dd>{String(v.actual.maxDeviationMm).replace(".", ",")} mm{v.spec && ` (batas ±${String(v.spec.toleranceMm).replace(".", ",")} mm)`}</dd></div>
            <div><dt>Lolos cek tanpa perbaikan</dt><dd>{v.actual.unitsPassed} dari {v.order.quantity}</dd></div>
          </dl>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Diukur operator Kesuni{v.actual.note && `: ${v.actual.note}`}. Kamu tetap memeriksa barangnya sendiri.</p>
        </section>
      )}

      {v.review && (
        <section className="card">
          <h2>Ulasanmu</h2>
          <p style={{ margin: 0 }}>Kualitas {v.review.quality}/5 · Komunikasi {v.review.communication}/5 · Sepadan harga {v.review.value}/5</p>
          {v.review.text && <p style={{ marginBottom: 0 }}>“{v.review.text}”</p>}
        </section>
      )}

      {v.acceptance && (
        <section className="card">
          <h2>Keputusanmu</h2>
          <p style={{ margin: 0 }}>
            <span className={`badge ${v.acceptance.accepted ? "ok" : "bad"}`}>{v.acceptance.accepted ? "diterima" : "ditolak"}</span>{" "}
            oleh {v.acceptance.by} · {when(v.acceptance.at)}{v.acceptance.note && <>: “{v.acceptance.note}”</>}
          </p>
        </section>
      )}

      <footer className="cust-foot muted">
        <p>Butuh tanggal: {v.order.deadline}{v.order.customerNote && <> · Catatanmu: “{v.order.customerNote}”</>}</p>
        <p>Alamat dan nomor HP-mu tidak disimpan di sini dan tidak pernah dikirim ke AI. Uang hanya bisa bergerak lewat aturan pengaman (policy), bukan atas kemauan AI.</p>
      </footer>
    </main>
  );
}

function Decide({ defaultName, busy, photos, onDecide }: {
  defaultName: string; busy: boolean; photos: string[];
  onDecide: (b: Record<string, unknown>) => void;
}) {
  const [by, setBy] = useState(defaultName);
  const [note, setNote] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);
  return (
    <div className="cust-pay">
      {photos.length > 0 && (
        <div className="cust-photos">
          {photos.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="Foto hasil cek kualitas" /></a>
          ))}
        </div>
      )}
      <label>Namamu
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Nama" />
      </label>
      <label>Catatan (boleh kosong)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Misalnya: rapi, sesuai pesanan" />
      </label>
      <div className="row">
        <button className="primary cust-cta" disabled={busy || !by.trim()} onClick={() => onDecide({ action: "accept", by, note })}>
          Terima barang
        </button>
        {!confirmReject ? (
          <button disabled={busy || !by.trim()} onClick={() => setConfirmReject(true)}>Tolak</button>
        ) : (
          <button className="danger" disabled={busy || !by.trim()} onClick={() => onDecide({ action: "reject", by, note })}>
            Ya, tolak dan kembalikan uang
          </button>
        )}
      </div>
      <p className="cust-note">Terima: agen meneruskan uang dari escrow ke Kesuni. Tolak: agen mengembalikan uangnya ke dompetmu.</p>
    </div>
  );
}

function SpecList({ spec, deadline }: { spec: NonNullable<View["spec"]>; deadline: string }) {
  const n = (x: number) => String(x).replace(".", ",");
  return (
    <dl className="calc-kv" style={{ marginTop: 0 }}>
      <div><dt>Ukuran</dt><dd>{spec.dimensions} (±{n(spec.toleranceMm)} mm)</dd></div>
      <div><dt>Bahan & warna</dt><dd>{spec.material}{spec.color && ` · ${spec.color}`}</dd></div>
      <div><dt>Layer / infill</dt><dd>{n(spec.layerMm)} mm / {spec.infillPct}%</dd></div>
      <div><dt>Finishing</dt><dd>{spec.finishing}</dd></div>
      <div><dt>Selesai paling lambat</dt><dd>{deadline}</dd></div>
      <div><dt>Cara cek hasil</dt><dd style={{ fontWeight: 400, textAlign: "right" }}>{spec.promise}</dd></div>
    </dl>
  );
}

function AgreeAndPay({ v, busy, onPay }: { v: View; busy: boolean; onPay: (b: Record<string, unknown>) => void }) {
  const current = Boolean(v.agreement?.current);
  const [ok, setOk] = useState(current);
  const [by, setBy] = useState(v.agreement?.by ?? v.order.customerName ?? "");
  return (
    <>
      {v.spec && (
        <details className="cust-agree" open>
          <summary>Yang kamu setujui</summary>
          <SpecList spec={v.spec} deadline={v.order.deadline} />
        </details>
      )}
      {v.costs && (
        <details className="cust-agree">
          <summary>Ke mana uangmu?</summary>
          <dl className="calc-kv" style={{ marginTop: 0 }}>
            {v.costs.lines.map((l) => <div key={l.label}><dt>{l.label}</dt><dd>{rupiah(l.idr)}</dd></div>)}
            <div><dt>Jasa & keuntungan Kesuni</dt><dd>{rupiah(v.costs.kesuniIdr)}</dd></div>
            <div><dt><b>Total</b></dt><dd>{rupiah(v.costs.totalIdr)}</dd></div>
          </dl>
        </details>
      )}
      <label>Namamu
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Nama" />
      </label>
      <label className="row" style={{ alignItems: "flex-start", gap: 8, fontWeight: 400 }}>
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ width: "auto", marginTop: 3 }} />
        <span>Saya setuju dengan harga, spesifikasi, dan tanggal selesai di atas.</span>
      </label>
      <button className="primary cust-cta" disabled={busy || !ok || !by.trim()} onClick={() => onPay({ action: "pay", agree: true, by })}>
        {busy ? "Memproses…" : `Setuju & bayar ${usdc(v.price!.usdc)} USDC`}
      </button>
    </>
  );
}

function ReviewForm({ defaultName, busy, onSend }: { defaultName: string; busy: boolean; onSend: (b: Record<string, unknown>) => void }) {
  const [r, setR] = useState({ quality: 0, communication: 0, value: 0 });
  const [text, setText] = useState("");
  const [by, setBy] = useState(defaultName);
  const row = (k: keyof typeof r, label: string) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 14, marginBottom: 4 }}>{label}</div>
      <div className="stars" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={r[k] === n} className={r[k] >= n ? "on" : ""}
            onClick={() => setR({ ...r, [k]: n })}>{n}★</button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="cust-pay">
      <h2 style={{ fontSize: 17, margin: "0 0 8px" }}>Bagaimana hasilnya?</h2>
      {row("quality", "Kualitas barang")}
      {row("communication", "Komunikasi")}
      {row("value", "Sepadan dengan harga")}
      <label>Cerita singkat (boleh kosong)
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Apa yang sudah pas, apa yang perlu diperbaiki?" />
      </label>
      <label>Namamu
        <input value={by} onChange={(e) => setBy(e.target.value)} />
      </label>
      <button className="primary cust-cta" disabled={busy || !r.quality || !r.communication || !r.value || !by.trim()}
        onClick={() => onSend({ action: "review", ...r, text, by })}>Kirim ulasan</button>
      <p className="cust-note">Ulasan dihitung ke reputasi Kesuni. Jumlah pesanan saja tidak menaikkan skor; hasil yang lolos cek dan tepat waktu yang menaikkan.</p>
    </div>
  );
}
