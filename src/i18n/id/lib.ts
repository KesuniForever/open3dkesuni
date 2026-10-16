// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// The fixed texts that shared libraries (src/lib, src/app/api) hand to pages: the Chief's rules and skills, the
// "Needs attention" lines, status words, and the reasons and errors the API returns to forms. Pages render them
// with t(value). Texts that the code builds with a value in them are listed twice: as a template with {placeholders}
// (tLib in src/lib/lib-text.ts reverse-matches any value) and filled with today's config or every status word, so a
// plain t(value) finds them too. Data from the database (task texts, notes, the Chief's own words) is never here.

import autoprint from "./autoprint";

type Dict = Record<string, string>;
type Vars = Record<string, string | number>;
const fill = (s: string, v: Vars) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

// ---------- status words (shown verbatim from lib enums) ----------

/** Order status. */
const ORDER_STATUS: Dict = {
  CREATED: "DIBUAT",
  PLAN_CHOSEN: "RENCANA DIPILIH",
  IN_PRODUCTION: "DIPRODUKSI",
  EVIDENCE_SUBMITTED: "BUKTI DIKIRIM",
  ACCEPTED: "DITERIMA",
  REJECTED: "DITOLAK",
  PAID: "DIBAYAR",
};
/** Escrow state. */
const ESCROW_STATE: Dict = {
  AWAITING_DEPOSIT: "MENUNGGU DEPOSIT",
  FUNDED: "DIDANAI",
  RELEASED: "DILEPAS",
  REFUNDED: "DIKEMBALIKAN",
};
/** Circle transfer state (FAILED is also a printer state). */
const TX_STATE: Dict = {
  NOT_SUBMITTED: "BELUM DIKIRIM",
  INITIATED: "DIMULAI",
  CLEARED: "LOLOS CEK",
  QUEUED: "MENGANTRE",
  SENT: "TERKIRIM",
  CONFIRMED: "TERKONFIRMASI",
  COMPLETE: "SELESAI",
  FAILED: "GAGAL",
  DENIED: "DITOLAK",
  CANCELLED: "DIBATALKAN",
};
/** Payment intent state. */
const PAYMENT_STATE: Dict = {
  ALLOCATED: "DIALOKASIKAN",
  PAYMENT_INTENT_CREATED: "INTENT PEMBAYARAN DIBUAT",
  SUBMITTED: "DIAJUKAN",
  UNKNOWN: "TIDAK DIKETAHUI",
  PARTIALLY_PAID: "DIBAYAR SEBAGIAN",
};
/** Printer state from the Bambu report. */
const PRINTER_STATE: Dict = {
  IDLE: "SIAGA",
  PREPARE: "PERSIAPAN",
  SLICING: "SLICING",
  RUNNING: "MENCETAK",
  PAUSE: "JEDA",
  FINISH: "SELESAI",
  INIT: "INISIALISASI",
};
/** Print job state (src/lib/printer/jobs.ts), lower case. */
const JOB_STATE: Dict = {
  queued: "dalam antrean",
  uploading: "sedang diunggah",
  sent: "sudah dikirim",
  printing: "sedang mencetak",
  done: "selesai",
  failed: "gagal",
  cancelled: "dibatalkan",
};

const id: Dict = {
  ...ORDER_STATUS, ...ESCROW_STATE, ...TX_STATE, ...PAYMENT_STATE, ...PRINTER_STATE,
  // the same words in lower case (timelines, badges styled in capitals by CSS)
  "created": "dibuat",
  "plan chosen": "rencana dipilih",
  "in production": "diproduksi",
  "evidence submitted": "bukti dikirim",
  "accepted": "diterima",
  "rejected": "ditolak",
  "paid": "dibayar",
  // labels on orders, evidence and escrows
  "simulated": "simulasi",
  "real": "nyata",
  "manual": "manual",
  "device": "perangkat",
  "local": "lokal",
  "photo": "foto",
  // operator task status
  "open": "terbuka",
  "done": "selesai",
  // reputation: how much finished work stands behind the score
  "none": "tidak ada",
  "limited": "terbatas",
  "solid": "kuat",
  // review ratings
  "Quality": "Kualitas",
  "Communication": "Komunikasi",
  "Value": "Nilai",

  // ---------- the Chief's five skills (src/lib/agent/skills.ts) ----------
  // "Finance" and "Operations" are in shell.ts (Keuangan, Operasional).
  "Machines": "Mesin",
  "Customer": "Pelanggan",
  "price by weight, budget and margin checks, Arc payment checks": "harga per berat, cek anggaran dan margin, cek pembayaran di Arc",
  "read the order, choose the plan, ask the owner or the operator": "membaca pesanan, memilih rencana, bertanya ke pemilik atau operator",
  "printer status, choose a printer, filament and printer tasks": "status printer, memilih printer, tugas filamen dan printer",
  "collect-and-QC tasks; the QC verdict and any reprint stay with a person": "tugas ambil-dan-QC; putusan QC dan cetak ulang tetap di tangan orang",
  "updates on the customer's order page": "kabar di halaman pesanan pelanggan",

  // ---------- what the Chief decides alone (src/lib/agent/authority.ts) ----------
  // {price} is "Rp1.500/g", or "PLA Rp1.500/g, PETG Rp1.800/g" when PETG has its own price.
  "Price PLA and PETG by weight from the slicer grams a person entered: {price}, unit price rounded up to {round}":
    "Harga PLA dan PETG per berat dari gram slicer yang diisi orang: {price}, harga satuan dibulatkan ke atas ke {round}",
  "Choose the production plan within the customer's budget and the owner's rules": "Memilih rencana produksi sesuai anggaran pelanggan dan aturan pemilik",
  "Choose a ready printer once the customer has paid into escrow": "Memilih printer yang siap setelah pelanggan membayar ke escrow",
  "Ask the operator for filament changes and printer checks": "Meminta operator mengganti filamen dan mengecek printer",
  "Message the customer on their order page": "Mengirim pesan ke pelanggan di halaman pesanannya",
  "Ask a person only when a number is missing or a rule needs the owner": "Bertanya ke orang hanya jika ada angka yang kurang atau aturan butuh pemilik",
  "Ask the operator to collect and QC a finished print": "Meminta operator mengambil dan QC hasil cetak yang selesai",
  "Heartbeat checks every {every}: wakes the Chief when an order needs a decision": "Cek heartbeat tiap {every}: membangunkan Chief saat pesanan butuh keputusan",
  "{n} min": "{n} mnt",
  "{n} s": "{n} dtk",
  "Heartbeat checks are off (KESUNI_HEARTBEAT_SECONDS=0)": "Cek heartbeat mati (KESUNI_HEARTBEAT_SECONDS=0)",
  "Checks up to {n} escrow transfers on Arc per heartbeat; a mismatch becomes a question for a person":
    "Mengecek hingga {n} transfer escrow di Arc per heartbeat; yang tidak cocok jadi pertanyaan untuk orang",
  "Release escrow to Kesuni after the customer accepts, if the policy allows": "Melepas escrow ke Kesuni setelah pelanggan menerima, jika kebijakan mengizinkan",
  "Refund the customer after a rejection": "Mengembalikan dana pelanggan setelah penolakan",

  // ---------- what code limits ----------
  "Orders under {amount} need the owner's approval": "Pesanan di bawah {amount} perlu persetujuan pemilik",
  "Orders above {amount} need the owner's approval": "Pesanan di atas {amount} perlu persetujuan pemilik",
  "Partners only for orders of {amount} or more": "Mitra hanya untuk pesanan {amount} ke atas",
  "Never prices under a {pct}% margin on its own": "Tanpa pemilik, tak pernah memberi harga di bawah margin {pct}%",
  "The chosen plan must finish before the deadline": "Rencana yang dipilih harus selesai sebelum tenggat",
  "WARNING: a tool that looks like a payment tool is in the agent's tool list": "PERINGATAN: ada alat yang mirip alat pembayaran di daftar alat agen",
  "No payment tool: {n} tools, none moves money; release and refund run in code through the policy":
    "Tanpa alat pembayaran: {n} alat, tak satu pun memindahkan uang; rilis dan refund dijalankan kode lewat kebijakan",
  "Works on one order per run; it cannot touch other orders or their quotes": "Satu pesanan per run; tidak bisa menyentuh pesanan lain atau penawarannya",
  "Never sees the customer's name, phone or address": "Tidak pernah melihat nama, telepon, atau alamat pelanggan",
  "Runs on {network} (test USDC); mainnet is locked unless KESUNI_ALLOW_MAINNET=1": "Berjalan di {network} (USDC uji); mainnet terkunci kecuali KESUNI_ALLOW_MAINNET=1",
  "Runs on {network} (real USDC); mainnet is unlocked by KESUNI_ALLOW_MAINNET=1": "Berjalan di {network} (USDC nyata); mainnet dibuka oleh KESUNI_ALLOW_MAINNET=1",
  "Runs on {network} (real USDC); mainnet is locked: KESUNI_ALLOW_MAINNET is not 1": "Berjalan di {network} (USDC nyata); mainnet terkunci: KESUNI_ALLOW_MAINNET bukan 1",
  "At most {n} background wake-ups per hour (all orders together)": "Maksimal {n} kali dibangunkan di latar per jam (semua pesanan)",

  // ---------- what the Chief always hands to a person, and what keeps it there ----------
  "Whether a print passes QC, and whether to reprint it": "Apakah hasil cetak lolos QC, dan perlu dicetak ulang atau tidak",
  "no QC tool, and the Chief's task tool refuses reprints: a person records QC and the customer accepts or rejects":
    "tidak ada alat QC, dan alat tugas Chief menolak cetak ulang: orang mencatat QC, pelanggan menerima atau menolak",
  "Whether a design can be printed (size, supports, strength)": "Apakah desain bisa dicetak (ukuran, support, kekuatan)",
  "no slicer or file access: grams per unit come only from a person": "tanpa akses slicer atau file: gram per unit hanya dari orang",
  "Materials other than PLA and PETG": "Material selain PLA dan PETG",
  "price_by_weight refuses when the spec is not PLA or PETG or the order text names another material (a keyword list, so a person double-checks)":
    "price_by_weight menolak jika spesifikasi bukan PLA atau PETG atau teks pesanan menyebut material lain (daftar kata kunci, jadi orang tetap mengecek ulang)",
  "Starting, pausing or stopping a print": "Memulai, menjeda, atau menghentikan cetakan",
  "no printer control tool: people start and control prints on the website, each with their name":
    "tanpa alat kontrol printer: orang yang memulai dan mengendalikan cetakan di situs, masing-masing dengan namanya",
  "Machines Kesuni does not run": "Mesin yang tidak dijalankan Kesuni",
  "the Chief only picks among the studio's printers and the quotes people entered; partners only within the owner's rules":
    "Chief hanya memilih dari printer studio dan penawaran yang diisi orang; mitra hanya sesuai aturan pemilik",
  "A price change after the plan is chosen, discounts, exceptions to the owner's rules": "Perubahan harga setelah rencana dipilih, diskon, pengecualian aturan pemilik",
  "quotes close once a plan is chosen; the policy refuses exceptions until the owner approves":
    "penawaran ditutup setelah rencana dipilih; kebijakan menolak pengecualian sampai pemilik menyetujui",
  "Moving money": "Memindahkan uang",
  "no payment tool: release and refund run in code after the customer decides": "tanpa alat pembayaran: rilis dan refund dijalankan kode setelah pelanggan memutuskan",
  "Anything that rests on missing or stale data": "Apa pun yang bergantung pada data kosong atau usang",
  "a printer with no report in the last 2 minutes counts as offline; missing grams block pricing":
    "printer tanpa laporan dalam 2 menit terakhir dianggap offline; tanpa gram, harga tidak bisa dibuat",
  "Complaints, disputes, legal and tax questions": "Keluhan, sengketa, pertanyaan hukum dan pajak",
  "the Chief is told to ask the owner; it has no tool to settle them": "Chief diminta bertanya ke pemilik; tidak ada alat untuk menyelesaikannya",

  // ---------- "Needs attention" on the home page (src/lib/dashboard.ts) ----------
  "Run the agent to choose a plan": "Jalankan agen untuk memilih rencana",
  "Needs a price: grams per unit from the slicer (price by weight)": "Perlu harga: gram per unit dari slicer (harga per berat)",
  "Waiting for the customer to approve and pay": "Menunggu pelanggan menyetujui dan membayar",
  "Waiting for the customer to accept or reject": "Menunggu pelanggan menerima atau menolak",
  "Report what production used (plan vs actual)": "Laporkan pemakaian produksi (rencana vs aktual)",

  // ---------- owner's rules (src/lib/owner-rules.ts) ----------
  "Order value {value} is under the owner's minimum {min}: owner approval needed": "Nilai pesanan {value} di bawah minimum pemilik {min}: perlu persetujuan pemilik",
  "Order value {value} is above {max}: owner approval needed": "Nilai pesanan {value} di atas {max}: perlu persetujuan pemilik",
  "Partners only get orders of {min} or more; this one is {value}, keep it in-house": "Mitra hanya dapat pesanan {min} ke atas; ini {value}, kerjakan sendiri",
  "ETA {h}h finishes after the deadline {deadline} (SLA)": "ETA {h} jam selesai setelah tenggat {deadline} (SLA)",

  // ---------- policy engine (src/lib/policy.ts) ----------
  "Quote belongs to a different order": "Penawaran milik pesanan lain",
  "Unknown vendor": "Vendor tidak dikenal",
  "Vendor {vendor} is not approved": "Vendor {vendor} belum disetujui",
  "Quote price must be a positive integer (micro-USDC)": "Harga penawaran harus bilangan bulat positif (mikro-USDC)",
  "Quote {price} USDC exceeds mandate {mandate} USDC": "Penawaran {price} USDC melebihi mandat {mandate} USDC",
  "Order deadline is invalid": "Tenggat pesanan tidak valid",
  "No plan chosen for this order": "Belum ada rencana yang dipilih untuk pesanan ini",
  "Order has not been accepted": "Pesanan belum diterima",
  "Order has not been accepted by the customer": "Pesanan belum diterima pelanggan",
  "No QC evidence recorded": "Belum ada bukti QC yang dicatat",
  "Recipient vendor is not approved": "Vendor penerima belum disetujui",
  "Recipient address does not match the approved vendor address": "Alamat penerima tidak cocok dengan alamat vendor yang disetujui",
  "Amount must be a positive integer (micro-USDC)": "Jumlah harus bilangan bulat positif (mikro-USDC)",
  "Amount does not equal the accepted quote price": "Jumlah tidak sama dengan harga penawaran yang diterima",
  "Amount exceeds order mandate": "Jumlah melebihi mandat pesanan",
  "Order already has a payment intent": "Pesanan sudah punya intent pembayaran",
  "Order already has an escrow": "Pesanan sudah punya escrow",
  "Choose a plan first: the escrow amount is the chosen quote's price": "Pilih rencana dulu: jumlah escrow = harga penawaran yang dipilih",
  "Quote exceeds order mandate": "Penawaran melebihi mandat pesanan",
  "Order is {status}; too late to open an escrow": "Pesanan berstatus {status}; terlambat untuk membuka escrow",
  "Order has no escrow": "Pesanan belum punya escrow",
  "Escrow is {state}, not FUNDED": "Escrow berstatus {state}, belum DIDANAI",
  "Vendor payout address is not a valid address": "Alamat pembayaran vendor tidak valid",
  "Vendor payout address {address} is a placeholder; set a real address first": "Alamat pembayaran vendor {address} masih contoh; isi alamat asli dulu",
  "Escrow amount does not equal the accepted quote price": "Jumlah escrow tidak sama dengan harga penawaran yang diterima",
  "Escrow amount exceeds order mandate": "Jumlah escrow melebihi mandat pesanan",
  "Escrow holds {have} USDC, needs {need} USDC": "Escrow berisi {have} USDC, perlu {need} USDC",
  "A release or refund is already in progress or done": "Rilis atau refund sedang berjalan atau sudah selesai",
  "Refund needs the customer to reject the order first": "Refund perlu pelanggan menolak pesanan dulu",
  "Customer refund address is not a valid address": "Alamat refund pelanggan tidak valid",
  "Invalid USDC amount \"{input}\" (max 6 decimals, digits only)": "Jumlah USDC \"{input}\" tidak valid (maks. 6 desimal, hanya angka)",

  // ---------- price by weight (src/lib/pricing.ts) ----------
  "Grams per piece must be above 0 and at most {max}": "Gram per buah harus di atas 0 dan maksimal {max}",
  "Quantity must be a whole number, at least 1": "Jumlah harus bilangan bulat, minimal 1",

  // ---------- spec, quotes, agreement, plan vs actual (src/lib/agreement.ts) ----------
  "Order not found": "Pesanan tidak ditemukan",
  "The customer has paid on this agreement; the spec can no longer change": "Pelanggan sudah membayar atas kesepakatan ini; spesifikasi tidak bisa diubah lagi",
  "Order is {status}; the spec is closed": "Pesanan berstatus {status}; spesifikasi sudah ditutup",
  "Dimensions are required": "Dimensi wajib diisi",
  "Tolerance must be 0–10 mm": "Toleransi harus 0–10 mm",
  "Layer height must be above 0 and at most 1 mm": "Tinggi layer harus di atas 0 dan maksimal 1 mm",
  "Infill must be 0–100%": "Infill harus 0–100%",
  "Say how the result will be checked (the quality promise)": "Jelaskan cara hasil dicek (janji kualitas)",
  "Invalid spec": "Spesifikasi tidak valid",
  "Invalid cost input": "Input biaya tidak valid",
  "Quantity must match the order ({n})": "Jumlah harus sama dengan pesanan ({n})",
  "Price must be above zero": "Harga harus di atas nol",
  "Order is {status}; quotes are closed": "Pesanan berstatus {status}; penawaran sudah ditutup",
  "Say where the grams come from (slicer, operator note)": "Sebutkan asal gram (slicer, catatan operator)",
  "Say where the grams come from (slicer, plate, settings)": "Sebutkan asal gram (slicer, plate, pengaturan)",
  "by must be \"agent\" or \"human\"": "by harus \"agent\" atau \"human\"",
  "Invalid weight": "Berat tidak valid",
  "Colour mode must be \"single\" or \"multi\"": "Mode warna harus \"single\" atau \"multi\"",
  "Who entered the grams is required": "Nama yang mengisi gram wajib diisi",
  "The price is not ready to approve yet": "Harga belum siap disetujui",
  "Name is required": "Nama wajib diisi",
  "Payment has started; the agreement can no longer change": "Pembayaran sudah dimulai; kesepakatan tidak bisa diubah lagi",
  "Report what production used after printing has started": "Laporkan pemakaian produksi setelah pencetakan dimulai",
  "{field} must be a number, 0 or more": "{field} harus angka, 0 atau lebih",
  "unitsPassed must be a whole number from 0 to {n}": "unitsPassed harus bilangan bulat 0 sampai {n}",
  "Who measured it is required": "Nama yang mengukur wajib diisi",
  "Invalid report": "Laporan tidak valid",

  // ---------- the customer's page (src/lib/customer.ts) ----------
  "This order cannot be paid yet": "Pesanan ini belum bisa dibayar",
  "Approve the agreement (price and spec) before paying": "Setujui kesepakatan (harga dan spesifikasi) sebelum membayar",
  "Your payment wallet does not hold enough USDC yet. Contact Kesuni to learn how to top it up.":
    "Wallet pembayaran Anda belum berisi cukup USDC. Hubungi Kesuni untuk cara mengisinya.",
  "The payment is not in escrow yet, so you cannot decide yet": "Pembayaran belum masuk escrow, jadi Anda belum bisa memutuskan",
  "First tick the box that you checked the size, colour, finish and function of the item you received":
    "Centang dulu kotak bahwa Anda sudah mengecek ukuran, warna, hasil akhir, dan fungsi barang yang diterima",
  "Product name is too long (at most 200 characters)": "Nama produk terlalu panjang (maksimal 200 karakter)",
  "The budget must be at least Rp1.000": "Anggaran minimal Rp1.000",
  "The order is incomplete": "Pesanan belum lengkap",

  // ---------- reviews (src/lib/reputation.ts) ----------
  "Reviews open after the item is accepted": "Ulasan dibuka setelah barang diterima",
  "This order already has a review": "Pesanan ini sudah punya ulasan",
  "{rating} rating must be 1 to 5": "Nilai {rating} harus 1 sampai 5",
  "Quality rating must be 1 to 5": "Nilai kualitas harus 1 sampai 5",
  "Communication rating must be 1 to 5": "Nilai komunikasi harus 1 sampai 5",
  "Value rating must be 1 to 5": "Nilai harga harus 1 sampai 5",
  "The review is incomplete": "Ulasan belum lengkap",

  // ---------- printers (src/lib/printer/actions.ts) ----------
  "ready": "siap",
  "offline (no report in the last 2 min)": "offline (tidak ada laporan dalam 2 menit terakhir)",
  "busy with {order}": "sedang mengerjakan {order}",
  "bed still holds the part of {order}": "bed masih berisi hasil {order}",
  "printer state is {state}": "status printer {state}",
  "a print without an order": "cetakan tanpa pesanan",
  "{printer}: ready": "{printer}: siap",
  "{printer}: offline (no report in the last 2 min)": "{printer}: offline (tidak ada laporan dalam 2 menit terakhir)",
  "{printer}: busy with {order}": "{printer}: sedang mengerjakan {order}",
  "{printer}: bed still holds the part of {order}": "{printer}: bed masih berisi hasil {order}",
  "{printer}: printer state is {state}": "{printer}: status printer {state}",
  "Invalid printer id": "ID printer tidak valid",
  "Order is {status}; choose a plan before printing": "Pesanan berstatus {status}; pilih rencana sebelum mencetak",
  "{printer} is busy with {order}": "{printer} sedang mengerjakan {order}",
  "{printer}: bed still holds the part of {order}. Collect it first.": "{printer}: bed masih berisi hasil {order}. Ambil dulu.",
  "Printer not found": "Printer tidak ditemukan",
  "Who cleared the bed is required": "Nama yang mengosongkan bed wajib diisi",
  "No printer is ready": "Tidak ada printer yang siap",
  "Task not found": "Tugas tidak ditemukan",
  "Who did it is required": "Nama yang mengerjakan wajib diisi",

  // ---------- network and payment state (src/lib/network.ts, src/lib/payment-state.ts) ----------
  "Mainnet is locked: {chain} moves real USDC. Set KESUNI_ALLOW_MAINNET=1 only after the owner and Sabina approve and the checks in docs/PILOT.md are done.":
    "Mainnet terkunci: {chain} memindahkan USDC nyata. Atur KESUNI_ALLOW_MAINNET=1 hanya setelah pemilik dan Sabina setuju dan cek di docs/PILOT.md selesai.",
  "Illegal payment transition {from} -> {to}": "Transisi pembayaran tidak sah {from} -> {to}",

  // ---------- orders, plans, evidence, approvals (src/lib/actions.ts) ----------
  "Product is required": "Produk wajib diisi",
  "Deadline must be a date (YYYY-MM-DD)": "Tenggat harus tanggal (YYYY-MM-DD)",
  "Design version is required": "Versi desain wajib diisi",
  "Budget must be a positive USDC amount": "Anggaran harus jumlah USDC positif",
  "Label must be real or simulated": "Label harus real atau simulated",
  "Product is too long (at most 200 characters)": "Produk terlalu panjang (maksimal 200 karakter)",
  "Customer name is too long": "Nama pelanggan terlalu panjang",
  "Note is too long": "Catatan terlalu panjang",
  "Invalid order": "Pesanan tidak valid",
  "Price must be a positive integer (micro-USDC)": "Harga harus bilangan bulat positif (mikro-USDC)",
  "ETA must be a positive whole number of hours": "ETA harus jumlah jam bulat positif",
  "Order is {status}; plan already chosen": "Pesanan berstatus {status}; rencana sudah dipilih",
  "Quote not found": "Penawaran tidak ditemukan",
  "Plan rejected by policy": "Rencana ditolak kebijakan",
  "Choose a plan before submitting evidence": "Pilih rencana sebelum mengirim bukti",
  "Order is {status}; evidence is closed": "Pesanan berstatus {status}; bukti sudah ditutup",
  "Order is {status}; approval is for choosing a plan": "Pesanan berstatus {status}; persetujuan hanya untuk memilih rencana",
  "Who approves and why are required": "Siapa yang menyetujui dan alasannya wajib diisi",
  "Say which quote of this order the owner approves": "Sebutkan penawaran pesanan ini yang disetujui pemilik",
  "Order is {status}; QC evidence required first": "Pesanan berstatus {status}; perlu bukti QC dulu",
  "Who accepted is required": "Nama yang menerima wajib diisi",
  "Payment blocked by policy": "Pembayaran diblokir kebijakan",

  // ---------- escrow (src/lib/escrow.ts) ----------
  "Escrow blocked by policy": "Escrow diblokir kebijakan",
  "Could not create Circle wallets: {error}": "Gagal membuat wallet Circle: {error}",
  "KESUNI_DEMO_FUNDS_ADDRESS is not set": "KESUNI_DEMO_FUNDS_ADDRESS belum diatur",
  "Test top-ups are only allowed on testnet": "Top-up uji hanya boleh di testnet",
  "Escrow is {state}": "Escrow berstatus {state}",
  "Customer was already topped up": "Pelanggan sudah di-top-up",
  "Customer already holds {amount} USDC": "Pelanggan sudah punya {amount} USDC",
  "A deposit is already in progress or done": "Deposit sedang berjalan atau sudah selesai",
  "Customer wallet has too little USDC": "USDC di wallet pelanggan kurang",
  "Holds {have} USDC, needs {need} USDC": "Berisi {have} USDC, perlu {need} USDC",
  "Release blocked by policy": "Rilis diblokir kebijakan",
  "Refund blocked by policy": "Refund diblokir kebijakan",
  "Circle call failed, will retry with the same key: {error}": "Panggilan Circle gagal, dicoba lagi dengan kunci yang sama: {error}",

  // ---------- files (src/lib/files.ts) ----------
  "kind must be design, reference or qc_photo": "kind harus design, reference, atau qc_photo",
  "Who uploaded it is required": "Nama pengunggah wajib diisi",
  "Expected a {kind}, got \"{ext}\"": "Harus {kind}, bukan \"{ext}\"",
  "design file (STL, 3MF, STEP, OBJ)": "file desain (STL, 3MF, STEP, OBJ)",
  "reference image (JPG, PNG, WEBP)": "gambar referensi (JPG, PNG, WEBP)",
  "QC photo (JPG, PNG, WEBP)": "foto QC (JPG, PNG, WEBP)",
  "no extension": "tanpa ekstensi",
  "File is empty": "File kosong",
  "File is larger than {n} MB": "File lebih dari {n} MB",
  "File content is not a real image": "Isi file bukan gambar asli",
  "Order is {status}; QC photos belong to an order in production": "Pesanan berstatus {status}; foto QC hanya untuk pesanan yang sedang diproduksi",
  "Order is {status}; only an order in production can be marked printed": "Pesanan berstatus {status}; hanya pesanan yang sedang diproduksi yang bisa ditandai selesai cetak",
  "File refused": "File ditolak",
  "File not found": "File tidak ditemukan",
  "File is too large": "File terlalu besar",
  "Expected multipart form data with a file": "Kirim form multipart berisi file",
  "Expected a file field": "Field file tidak ada",
  "The file cannot be removed now": "File belum bisa dihapus",
  "Print job {id} is still using this file: cancel or stop the print first": "Job cetak {id} masih memakai file ini: batalkan atau hentikan cetakannya dulu",
  "Order is {status}; a QC photo stays once evidence is submitted": "Pesanan berstatus {status}; foto QC tetap disimpan setelah bukti dikirim",
  "Expected { by }": "Kirim { by }",
  "The stored copy could not be deleted": "Salinan tersimpan tidak bisa dihapus",

  // ---------- messages to the customer (src/lib/messages.ts) ----------
  "Message is empty": "Pesan kosong",
  "Message is longer than {n} characters": "Pesan lebih dari {n} karakter",
  "No links or web addresses in customer messages": "Tidak boleh ada link atau alamat web di pesan ke pelanggan",
  "No wallet addresses in customer messages: payment only goes through escrow": "Tidak boleh ada alamat wallet di pesan ke pelanggan: pembayaran hanya lewat escrow",
  "No email addresses in customer messages": "Tidak boleh ada alamat email di pesan ke pelanggan",
  "No phone numbers in customer messages": "Tidak boleh ada nomor telepon di pesan ke pelanggan",
  "Message refused": "Pesan ditolak",
  "Same text as the last message": "Teks sama dengan pesan terakhir",
  "The Chief has already written {n} messages on this order; a person writes from now on": "Chief sudah menulis {n} pesan di pesanan ini; selanjutnya orang yang menulis",
  "The Chief may write at most one message per order every 10 minutes": "Chief hanya boleh menulis satu pesan per pesanan tiap 10 menit",
  "Operators write as \"human\"; only the Chief writes as \"agent\"": "Operator menulis sebagai \"human\"; hanya Chief yang menulis sebagai \"agent\"",

  // ---------- cost calculator inputs (src/lib/costing.ts) ----------
  "quantity must be a whole number, at least 1": "quantity harus bilangan bulat, minimal 1",
  "reprintRiskPct must be under 100": "reprintRiskPct harus di bawah 100",
  "targetMarginPct + feePct must be under 100": "targetMarginPct + feePct harus di bawah 100",
  "Say where the grams and machine hours come from": "Sebutkan asal gram dan jam mesin",
  "Pricing refused": "Penentuan harga ditolak",

  // ---------- demo scenarios (src/lib/demo.ts) ----------
  "Unknown scenario": "Skenario tidak dikenal",
  "The owner's rules leave no price for this scenario": "Aturan pemilik tidak menyisakan harga untuk skenario ini",
  "Check the limits in .env.local (scenario: {title})": "Cek batasnya di .env.local (skenario: {title})",
  "Invalid sample weight": "Berat contoh tidak valid",
  "The owner's rules did not refuse this plan; check the limits in .env.local": "Aturan pemilik tidak menolak rencana ini; cek batasnya di .env.local",
  "The owner's rules did not refuse this plan; check KESUNI_PRINTER_COUNT and KESUNI_PRINT_MIN_PER_GRAM_MULTI in .env.local":
    "Aturan pemilik tidak menolak rencana ini; cek KESUNI_PRINTER_COUNT dan KESUNI_PRINT_MIN_PER_GRAM_MULTI di .env.local",

  // ---------- other API answers shown in forms (src/app/api) ----------
  "Send a JSON body": "Kirim body JSON",
  "Invalid JSON body": "Body JSON tidak valid",
  "Transaction not found": "Transaksi tidak ditemukan",
  "Only COMPLETE transactions with a hash can be checked on Arc": "Hanya transaksi COMPLETE dengan hash yang bisa dicek di Arc",
  "Amount must be a USDC number like 12.5 (max 6 decimals)": "Jumlah harus angka USDC seperti 12.5 (maks. 6 desimal)",
  "This order link is not valid": "Link pesanan ini tidak valid",
  "Too many orders in one hour. Try again later or contact Kesuni.": "Terlalu banyak pesanan dalam satu jam. Coba lagi nanti atau hubungi Kesuni.",
  "No daily review for {day}": "Belum ada ulasan harian untuk {day}",
  "Budget must be a USDC amount like 32 or 32.5 (max 6 decimals)": "Anggaran harus jumlah USDC seperti 32 atau 32.5 (maks. 6 desimal)",
  "Expected the report as JSON": "Laporan harus dikirim sebagai JSON",
  "Expected the calculator inputs as JSON": "Input kalkulator harus dikirim sebagai JSON",
  "Expected a JSON spec": "Spesifikasi harus dikirim sebagai JSON",
  "Say which quote the owner approves (quoteId)": "Sebutkan penawaran yang disetujui pemilik (quoteId)",
  "The agent prices through its own tool, not this endpoint": "Agen memberi harga lewat alatnya sendiri, bukan endpoint ini",
  "Price must be a USDC amount like 30 or 30.5": "Harga harus jumlah USDC seperti 30 atau 30.5",
  "PRINTER_BRIDGE_TOKEN is not set on the server": "PRINTER_BRIDGE_TOKEN belum diatur di server",
  "Bad bridge token": "Token bridge salah",
  "A daily review is already being written": "Ulasan harian sedang ditulis",
  "A heartbeat is already running": "Heartbeat sedang berjalan",
  "day must be a date YYYY-MM-DD": "day harus tanggal YYYY-MM-DD",
  "That day has not started yet (Jakarta time)": "Hari itu belum dimulai (waktu Jakarta)",
  "Operator login required": "Perlu login operator",
  "Wrong operator password": "Kata sandi operator salah",
  "Admin routes are closed: set OPERATOR_PASSWORD on the server first": "Rute admin tertutup: atur OPERATOR_PASSWORD di server dulu",
  "profile must be \"test\" or \"demo\"": "profile harus \"test\" atau \"demo\"",

  // ---------- printer stages: "what it is doing now" (src/lib/printer/bambu.ts STAGES, Bambu Studio's words) ----------
  // "Printing", "Preparing" and "Paused" are in order.ts / machines-capacity.ts.
  "Auto bed leveling": "Perataan bed otomatis",
  "Heatbed preheating": "Memanaskan heatbed",
  "Vibration compensation": "Kompensasi getaran",
  "Changing filament": "Mengganti filamen",
  "M400 pause": "Jeda M400",
  "Paused (filament ran out)": "Dijeda (filamen habis)",
  "Heating nozzle": "Memanaskan nozzle",
  "Calibrating dynamic flow": "Kalibrasi aliran dinamis",
  "Scanning bed surface": "Memindai permukaan bed",
  "Inspecting first layer": "Memeriksa lapisan pertama",
  "Identifying build plate type": "Mengenali jenis build plate",
  "Calibrating Micro Lidar": "Kalibrasi Micro Lidar",
  "Homing toolhead": "Homing toolhead",
  "Cleaning nozzle tip": "Membersihkan ujung nozzle",
  "Checking extruder temperature": "Memeriksa suhu extruder",
  "Paused by the user": "Dijeda oleh pengguna",
  "Pause (front cover fall off)": "Jeda (penutup depan lepas)",
  "Calibrating the micro lidar": "Kalibrasi micro lidar",
  "Calibrating flow ratio": "Kalibrasi rasio aliran",
  "Pause (nozzle temperature malfunction)": "Jeda (suhu nozzle bermasalah)",
  "Pause (heatbed temperature malfunction)": "Jeda (suhu heatbed bermasalah)",
  "Filament unloading": "Mengeluarkan filamen",
  "Pause (step loss)": "Jeda (step loss)",
  "Filament loading": "Memasukkan filamen",
  "Motor noise cancellation": "Peredaman bising motor",
  "Pause (AMS offline)": "Jeda (AMS offline)",
  "Pause (low speed of the heatbreak fan)": "Jeda (kipas heatbreak terlalu pelan)",
  "Pause (chamber temperature control problem)": "Jeda (masalah kontrol suhu ruang cetak)",
  "Cooling chamber": "Mendinginkan ruang cetak",
  "Pause (G-code inserted by user)": "Jeda (G-code sisipan pengguna)",
  "Motor noise showoff": "Demo bunyi motor",
  "Pause (nozzle clumping)": "Jeda (nozzle menggumpal)",
  "Pause (cutter error)": "Jeda (pemotong bermasalah)",
  "Pause (first layer error)": "Jeda (lapisan pertama bermasalah)",
  "Pause (nozzle clog)": "Jeda (nozzle tersumbat)",
  "Measuring motion precision": "Mengukur presisi gerak",
  "Enhancing motion precision": "Meningkatkan presisi gerak",
  "Measuring motion accuracy": "Mengukur akurasi gerak",
  "Nozzle offset calibration": "Kalibrasi offset nozzle",
  "High-temperature auto bed leveling": "Perataan bed otomatis suhu tinggi",
  "Auto check: quick release lever": "Cek otomatis: tuas quick release",
  "Auto check: door and upper cover": "Cek otomatis: pintu dan penutup atas",
  "Laser calibration": "Kalibrasi laser",
  "Auto check: platform": "Cek otomatis: platform",
  "Confirming BirdsEye camera location": "Memastikan posisi kamera BirdsEye",
  "Calibrating BirdsEye camera": "Kalibrasi kamera BirdsEye",
  "Auto bed leveling: phase 1": "Perataan bed otomatis: tahap 1",
  "Auto bed leveling: phase 2": "Perataan bed otomatis: tahap 2",
  "Heating chamber": "Memanaskan ruang cetak",
  "Adjusting heatbed temperature": "Menyesuaikan suhu heatbed",
  "Printing calibration lines": "Mencetak garis kalibrasi",
  "Auto check: material": "Cek otomatis: material",
  "Live View camera calibration": "Kalibrasi kamera Live View",
  "Waiting for heatbed to reach target temperature": "Menunggu heatbed mencapai suhu target",
  "Auto check: material position": "Cek otomatis: posisi material",
  "Cutting module offset calibration": "Kalibrasi offset modul pemotong",
  "Measuring surface": "Mengukur permukaan",
  "Thermal preconditioning for first layer": "Prakondisi panas untuk lapisan pertama",
  "Waiting for the chamber temperature to equalize": "Menunggu suhu ruang cetak merata",
  "Preparing hotend": "Menyiapkan hotend",
  "Calibrating the nozzle clumping detection": "Kalibrasi deteksi nozzle menggumpal",
  "Purifying the chamber air": "Membersihkan udara ruang cetak",
  "Measuring rotary attachment": "Mengukur aksesori putar",
  "Moving the toolhead above the purge chute": "Toolhead bergerak ke atas saluran buang",
  "Cooling down the nozzle": "Mendinginkan nozzle",
  "Moving the toolhead to the bed centre": "Toolhead bergerak ke tengah bed",
  "Active arc fitting": "Active arc fitting",
  "Hotend type detection": "Deteksi jenis hotend",
  "Build plate alignment detection": "Deteksi posisi build plate",
  "Heatbed surface foreign object detection": "Deteksi benda asing di permukaan heatbed",
  "Heatbed underside foreign object detection": "Deteksi benda asing di bawah heatbed",
  "Pre-extrusion before printing": "Pra-ekstrusi sebelum mencetak",
  "Preparing AMS": "Menyiapkan AMS",
  "Working (stage {n})": "Bekerja (tahap {n})",

  // ---------- print speed and fault levels (src/lib/printer/bambu.ts) ----------
  // "Standard" is in customer.ts (Standar).
  "Silent": "Senyap",
  "Sport": "Sport",
  "Ludicrous": "Ludicrous",
  "fatal": "fatal",
  "serious": "serius",
  "common": "umum",
  "info": "info",
  // A fault task (issueTaskText in src/lib/printer/actions.ts); the page puts Bambu's own words in the page's language.
  "{printer} reports {code} ({level}): {words} Check the printer before the next print. {url}":
    "{printer} melaporkan {code} ({level}): {words} Periksa printer sebelum cetakan berikutnya. {url}",
  "{printer} reports error {code}: {words} Check the printer before the next print. {url}":
    "{printer} melaporkan error {code}: {words} Periksa printer sebelum cetakan berikutnya. {url}",
  "{printer} reports {code}: {words} Check the printer before the next print. {url}":
    "{printer} melaporkan {code}: {words} Periksa printer sebelum cetakan berikutnya. {url}",
  "Bambu has no description for this code.": "Bambu tidak punya keterangan untuk kode ini.",
  "unknown": "tidak diketahui",

  // ---------- colour names (src/lib/colors.ts) ----------
  // "Black" is in order.ts (Hitam).
  "Charcoal": "Arang",
  "Grey": "Abu-abu",
  "Silver": "Perak",
  "White": "Putih",
  "Ivory": "Gading",
  "Beige": "Krem",
  "Brown": "Cokelat",
  "Dark red": "Merah tua",
  "Red": "Merah",
  "Pink": "Merah muda",
  "Magenta": "Magenta",
  "Orange": "Oranye",
  "Gold": "Emas",
  "Yellow": "Kuning",
  "Lime": "Hijau limau",
  "Green": "Hijau",
  "Dark green": "Hijau tua",
  "Mint": "Hijau mint",
  "Teal": "Hijau toska",
  "Cyan": "Sian",
  "Sky blue": "Biru langit",
  "Blue": "Biru",
  "Navy": "Biru dongker",
  "Purple": "Ungu",
  "Lavender": "Lavender",
  "Unknown colour": "Warna tidak diketahui",

  // ---------- printer controls and print jobs (src/lib/printer/control.ts, jobs.ts, actions.ts) ----------
  "Unknown printer command": "Perintah printer tidak dikenal",
  "kind must be one of pause, resume, stop, speed, light, get_version, camera_snapshot":
    "kind harus salah satu dari pause, resume, stop, speed, light, get_version, camera_snapshot",
  "The printer is offline (no report in the last 2 min)": "Printer offline (tidak ada laporan dalam 2 menit terakhir)",
  "Pause works only while the printer is printing or preparing": "Jeda hanya bisa saat printer sedang mencetak atau bersiap",
  "Resume works only while the printer is paused": "Lanjutkan hanya bisa saat printer sedang dijeda",
  "Stop works only while a print is on the printer": "Hentikan hanya bisa saat ada cetakan di printer",
  "The speed can only change while the printer is printing": "Kecepatan hanya bisa diubah saat printer sedang mencetak",
  "Speed level must be 1 (silent), 2 (standard), 3 (sport) or 4 (ludicrous)":
    "Level kecepatan harus 1 (senyap), 2 (standar), 3 (sport) atau 4 (ludicrous)",
  "Say whether the light goes on or off": "Sebutkan lampu dinyalakan atau dimatikan",
  "A person's name is required": "Nama orang wajib diisi",
  "Confirm first": "Konfirmasi dulu",
  "Send confirm: true after the person confirmed": "Kirim confirm: true setelah orangnya mengonfirmasi",
  "The printer cannot do that now": "Printer tidak bisa melakukan itu sekarang",
  "One command every 3 seconds per printer": "Satu perintah tiap 3 detik per printer",
  "The same command is already waiting for the bridge": "Perintah yang sama sudah menunggu bridge",
  "A person must be at the printer when it starts": "Harus ada orang di dekat printer saat mulai mencetak",
  "A person must confirm the bed is empty and clean": "Orang harus memastikan bed kosong dan bersih",
  "The printer has not reported in the last minute (is the bridge running?)": "Printer belum melapor dalam 1 menit terakhir (apakah bridge berjalan?)",
  "The printer is {state}: it must be idle or finished": "Printer berstatus {state}: harus siaga atau selesai",
  "The printer is linked to {order}": "Printer sedang terhubung ke {order}",
  "Another print job ({id}) on this printer has not started yet": "Job cetak lain ({id}) di printer ini belum mulai",
  "Printer error {code}: fix it before printing": "Error printer {code}: perbaiki dulu sebelum mencetak",
  "Printer warning {code}: check it before printing": "Peringatan printer {code}: cek dulu sebelum mencetak",
  "The bridge does not report the SD card yet: update and restart the bridge": "Bridge belum melaporkan kartu SD: perbarui dan jalankan ulang bridge",
  "No microSD card in the printer (printing needs one)": "Tidak ada kartu microSD di printer (mencetak butuh kartu ini)",
  "The printer reports a problem with the SD card": "Printer melaporkan masalah pada kartu SD",
  "The 3MF could not be read: {error}": "3MF tidak bisa dibaca: {error}",
  "Not a sliced file: in Bambu Studio use File > Export > Export plate sliced file (.gcode.3mf)":
    "Bukan file hasil slice: di Bambu Studio pakai File > Export > Export plate sliced file (.gcode.3mf)",
  "The file is sliced for {model}, not the Bambu Lab A1": "File ini di-slice untuk {model}, bukan Bambu Lab A1",
  "The file does not say which printer it is sliced for": "File tidak menyebut di-slice untuk printer apa",
  "Plate {n} is not in the sliced file": "Plate {n} tidak ada di file hasil slice",
  "The file is for a {want} mm nozzle; the printer has {have} mm": "File untuk nozzle {want} mm; printer memakai {have} mm",
  "The plate uses no filament": "Plate ini tidak memakai filamen",
  "The AMS mapping needs {n} entries, one per filament in the project": "Pemetaan AMS butuh {n} isian, satu per filamen di proyek",
  "The AMS mapping holds an invalid slot": "Pemetaan AMS berisi slot yang tidak valid",
  "The bridge does not report the AMS yet: update and restart the bridge": "Bridge belum melaporkan AMS: perbarui dan jalankan ulang bridge",
  "Filament {id} ({type}) has no AMS slot": "Filamen {id} ({type}) belum punya slot AMS",
  "Filament {id} ({type}) is mapped to {slot}, which is empty": "Filamen {id} ({type}) dipetakan ke {slot}, yang kosong",
  "Filament {id} needs {type}, but {slot} holds {tray}": "Filamen {id} butuh {type}, tetapi {slot} berisi {tray}",
  "Without the AMS only one filament can print, from the external spool": "Tanpa AMS hanya satu filamen yang bisa dicetak, dari spool eksternal",
  "No external spool is set on the printer": "Belum ada spool eksternal yang diatur di printer",
  "The external spool holds {type}; the file needs {need}": "Spool eksternal berisi {type}; file butuh {need}",
  "Check the warnings and tick \"I checked this\"": "Cek peringatannya lalu centang \"Sudah saya cek\"",
  "The file does not belong to this order": "File ini bukan milik pesanan ini",
  "Only a sliced Bambu Studio file (.gcode.3mf) can be printed": "Hanya file hasil slice Bambu Studio (.gcode.3mf) yang bisa dicetak",
  "Filament {id}: the file asks for {want}, the spool is {have}": "Filamen {id}: file meminta {want}, spool-nya {have}",
  "The customer has not paid into escrow yet": "Pelanggan belum membayar ke escrow",
  "One print start per printer per minute": "Satu kali mulai cetak per printer per menit",
  "The print cannot start": "Cetakan tidak bisa dimulai",
  "Not linked to {order}: {error}": "Tidak terhubung ke {order}: {error}",
  "Print job not found": "Job cetak tidak ditemukan",
  "The job is {jobState}; stop the print on the printer instead": "Job berstatus {jobState}; hentikan cetakan lewat printer saja",
  "Cancelled by {name}": "Dibatalkan oleh {name}",
  "Printer error {code}": "Error printer {code}",
  "The bridge did not pick it up within 60 s": "Bridge tidak mengambilnya dalam 60 dtk",
  "No answer from the bridge": "Tidak ada jawaban dari bridge",
  "The bridge did not pick it up within 5 min. Check the bed again and start again.":
    "Bridge tidak mengambilnya dalam 5 mnt. Cek bed lagi lalu mulai lagi.",
  "Camera frame is larger than 2 MB": "Gambar kamera lebih dari 2 MB",
  "Not a JPEG image": "Bukan gambar JPEG",
  "No camera frame yet": "Belum ada gambar kamera",
  "Who checked the colours is required": "Nama yang mengecek warna wajib diisi",
  "The printer has not reported its AMS yet": "Printer belum melaporkan AMS-nya",
  "Expected { kind, params?, by, confirm? }": "Kirim { kind, params?, by, confirm? }",
  "Expected { printerId, attachmentId, plate, amsMapping, by, bedEmptyConfirmed, personPresent }":
    "Kirim { printerId, attachmentId, plate, amsMapping, by, bedEmptyConfirmed, personPresent }",
  "Expected { action: \"cancel\", by }": "Kirim { action: \"cancel\", by }",
  "Expected { action: \"link\", orderId } | { action: \"unlink\" } | { action: \"clear_bed\", by } | { action: \"confirm_colors\", by }":
    "Kirim { action: \"link\", orderId } | { action: \"unlink\" } | { action: \"clear_bed\", by } | { action: \"confirm_colors\", by }",

  // ---------- new order fields: budget in rupiah, material, the customer's colours (src/lib/actions.ts, colors.ts) ----------
  "Budget in rupiah must be a positive amount": "Anggaran dalam rupiah harus jumlah positif",
  "The rupiah per USDC rate must be a positive number": "Kurs rupiah per USDC harus angka positif",
  "Material must be PLA or PETG": "Material harus PLA atau PETG",
  "Colours must be a list": "Warna harus berupa daftar",
  "Pick at most {n} colours": "Pilih paling banyak {n} warna",
  "A colour must be written as #RRGGBB": "Warna harus ditulis sebagai #RRGGBB",
  "{type} {name} ({color}) is not loaded in the studio right now": "{type} {name} ({color}) sedang tidak terpasang di studio",

  // ---------- sliced 3MF files (src/lib/threemf.ts) ----------
  "The file is larger than 200 MB": "File lebih dari 200 MB",
  "Not a ZIP archive": "Bukan arsip ZIP",
  "Split ZIP archives are not supported": "Arsip ZIP terpecah tidak didukung",
  "ZIP64 archives are not supported": "Arsip ZIP64 tidak didukung",
  "More than {n} files in the archive": "Lebih dari {n} file di dalam arsip",
  "Broken ZIP archive": "Arsip ZIP rusak",
  "Unsafe file name in the archive": "Ada nama file yang tidak aman di dalam arsip",
  "Oversized entry in the archive": "Ada isi arsip yang terlalu besar",
  "Suspicious compression ratio (zip bomb)": "Rasio kompresi mencurigakan (zip bomb)",
  "Encrypted entries are not supported": "Isi arsip terenkripsi tidak didukung",
  "The archive holds two files with the same name": "Arsip berisi dua file dengan nama yang sama",
  "The file's metadata is too large": "Metadata file terlalu besar",
  "{file} is too large to read": "{file} terlalu besar untuk dibaca",

  // ---------- printer state in words, safety checks before a control or a start (control.ts, jobs.ts, actions.ts) ----------
  "The printer is preparing: it must be idle or finished": "Printer sedang bersiap: harus siaga atau selesai",
  "The printer is slicing: it must be idle or finished": "Printer sedang slicing: harus siaga atau selesai",
  "The printer is printing: it must be idle or finished": "Printer sedang mencetak: harus siaga atau selesai",
  "The printer is paused: it must be idle or finished": "Printer sedang dijeda: harus siaga atau selesai",
  "The printer is starting up: it must be idle or finished": "Printer sedang menyala: harus siaga atau selesai",
  "The printer is not reporting its state: it must be idle or finished": "Printer tidak melaporkan statusnya: harus siaga atau selesai",
  "The printer paused because of a fault: fix it, then tick \"I fixed the cause\"":
    "Printer berhenti karena gangguan: perbaiki dulu, lalu centang \"Penyebabnya sudah saya perbaiki\"",
  "printer error {code}": "error printer {code}",
  "urlForm must be sdcard or ftp": "urlForm harus sdcard atau ftp",
  "The bed was confirmed more than 10 min ago: nothing was sent. Check the bed again and start again.":
    "Bed dikonfirmasi lebih dari 10 mnt lalu: tidak ada yang dikirim. Cek bed lagi lalu mulai lagi.",
  "A print ended on this printer after the bed was confirmed: nothing was sent. Clear the bed and start again.":
    "Ada cetakan yang selesai di printer ini setelah bed dikonfirmasi: tidak ada yang dikirim. Kosongkan bed lalu mulai lagi.",
  "The bridge stopped answering during the upload. Check the printer screen, then start again.":
    "Bridge berhenti menjawab saat mengunggah. Cek layar printer, lalu mulai lagi.",
  "The printer never showed the print starting. Check the printer screen, then start again.":
    "Printer tidak pernah menunjukkan cetakan dimulai. Cek layar printer, lalu mulai lagi.",

  // ---------- what the LAN bridge reports back on a control or a print (scripts/bridge/logic.mjs, runner.mjs) ----------
  "The printer paused": "Printer sudah dijeda",
  "The printer is printing again": "Printer mencetak lagi",
  "The printer stopped the print": "Printer sudah menghentikan cetakan",
  "The print speed changed": "Kecepatan cetak sudah berubah",
  "The light is on": "Lampu menyala",
  "The light is off": "Lampu mati",
  "The printer sent its firmware versions": "Printer sudah mengirim versi firmware-nya",
  "The printer accepted it": "Printer menerimanya",
  "Camera frame sent": "Gambar kamera terkirim",
  "The printer refused: {reason}": "Printer menolak: {reason}",
  "The printer refused with error {code}": "Printer menolak dengan error {code}",
  "The printer refused the print: {reason}": "Printer menolak cetakan: {reason}",
  "The printer refused the print with error {code}": "Printer menolak cetakan dengan error {code}",
  "Printer error {code}: the print did not start": "Error printer {code}: cetakan tidak dimulai",
  "The printer did not start the print": "Printer tidak memulai cetakan",
  "The printer did not start within 45 s: check the printer screen, then start again":
    "Printer tidak mulai dalam 45 dtk: cek layar printer, lalu mulai lagi",
  "The printer has not paused yet: check the printer": "Printer belum jeda: cek printernya",
  "The printer did not resume: check the printer screen": "Printer tidak melanjutkan: cek layar printer",
  "The printer has not stopped yet: check the printer": "Printer belum berhenti: cek printernya",
  "No answer from the printer within 15 s: check the printer": "Tidak ada jawaban dari printer dalam 15 dtk: cek printernya",
  "Could not send it to the printer: {error}": "Tidak bisa mengirimnya ke printer: {error}",
  "Not sent: {error}": "Tidak dikirim: {error}",
  "The bridge is not connected to the printer": "Bridge tidak terhubung ke printer",
  "The bridge hit an error: {error}": "Bridge mengalami error: {error}",
  "New printer warning {code} since the print was queued: check it and start again":
    "Ada peringatan printer baru {code} sejak cetakan diantrekan: cek lalu mulai lagi",
  "Another print ({id}) is starting on this printer": "Cetakan lain ({id}) sedang dimulai di printer ini",
  "The job has no download link from this app": "Job ini tidak punya tautan unduhan dari aplikasi ini",
  "Could not download the file (the app answered {http})": "File tidak bisa diunduh (aplikasi menjawab {http})",
  "Could not download the file: {error}": "File tidak bisa diunduh: {error}",
  "The file is empty": "File kosong",
  "The app did not send the file's checksum": "Aplikasi tidak mengirim checksum file",
  "The file changed on the way (checksum mismatch)": "File berubah di jalan (checksum tidak cocok)",
  "The file is not the one the job was made with (checksum mismatch)": "File ini bukan file saat job dibuat (checksum tidak cocok)",
  "The file has {n} bytes; the job says {m}": "File berukuran {n} byte; job menyebut {m}",
  "Upload to the printer failed: {error}": "Unggah ke printer gagal: {error}",
  "The app could not record the start; nothing was sent to the printer": "Aplikasi tidak bisa mencatat mulai cetak; tidak ada yang dikirim ke printer",
  "This printer reports no camera": "Printer ini tidak melaporkan kamera",
  "No camera frame: {error}": "Tidak ada gambar kamera: {error}",
  "Dry run: nothing was sent to the printer": "Uji coba (dry run): tidak ada yang dikirim ke printer",

  // ---------- slicing on the website (src/lib/slicing.ts, slice-rules.ts; the studio PC: scripts/bridge/slicer.mjs) ----------
  "Agent prints are off: only a person can ask for a slice": "Cetak oleh agen mati: hanya orang yang bisa meminta slice",
  "Order is {status}; nothing to slice now": "Pesanan berstatus {status}; tidak ada yang perlu di-slice sekarang",
  "This file cannot be sliced here": "File ini tidak bisa di-slice di sini",
  "Pick an AMS spool (tray 0 to 15)": "Pilih spool AMS (tray 0 sampai 15)",
  "The spool cannot be used": "Spool ini tidak bisa dipakai",
  "{printer} slot {n} is empty": "{printer} slot {n} kosong",
  "{printer} slot {n} holds {type}: only PLA and PETG are sliced here": "{printer} slot {n} berisi {type}: hanya PLA dan PETG yang di-slice di sini",
  "{printer} slot {n} reports no colour": "{printer} slot {n} tidak melaporkan warna",
  "Quality must be standard, fine or draft": "Kualitas harus standar, halus, atau draf",
  "Infill must be a whole number from 0 to 100": "Infill harus bilangan bulat dari 0 sampai 100",
  "Supports must be auto or off": "Support harus otomatis atau mati",
  "The agent cannot ask for this slice": "Agen tidak bisa meminta slice ini",
  "Nobody confirmed the colours on {printer}": "Belum ada yang mengonfirmasi warna di {printer}",
  "{printer} has not reported in the last 2 min": "{printer} belum melapor dalam 2 mnt terakhir",
  "Nobody confirmed the colours on {printer}: check the spool is really {name}": "Belum ada yang mengonfirmasi warna di {printer}: cek apakah spool benar-benar {name}",
  "{printer} has not reported in the last 2 min: its spools may have changed": "{printer} belum melapor dalam 2 mnt terakhir: spool-nya mungkin sudah berganti",
  "At most {n} slices can wait per order": "Paling banyak {n} slice boleh menunggu per pesanan",
  "At most {n} slices can wait on the studio PC": "Paling banyak {n} slice boleh menunggu di PC studio",
  "The same slice is already waiting": "Slice yang sama sudah menunggu",
  "Slice not found": "Slice tidak ditemukan",
  "The slice is {sliceState}": "Slice ini {sliceState}",
  "The slice is {sliceState}; the sliced file was kept on the order": "Slice ini {sliceState}; file hasil slice tetap disimpan di pesanan",
  "The slice is {sliceState}; it cannot become {next}": "Slice ini {sliceState}; tidak bisa menjadi {next}",
  "The studio PC did not take the slice within 15 min: is the bridge running with Bambu Studio?":
    "PC studio tidak mengambil slice dalam 15 mnt: apakah bridge berjalan dengan Bambu Studio?",
  "The studio PC stopped answering while slicing": "PC studio berhenti menjawab saat slicing",
  "The studio PC could not slice it": "PC studio tidak bisa men-slice-nya",
  "Slice {id} is still using this file: cancel the slice first": "Slice {id} masih memakai file ini: batalkan slice-nya dulu",
  // what can be sliced, and what the sliced file must hold
  "Only design files can be sliced": "Hanya file desain yang bisa di-slice",
  "STEP files cannot be sliced here: export an STL from the CAD program": "File STEP tidak bisa di-slice di sini: ekspor STL dari program CAD",
  "Only STL, OBJ or an unsliced Bambu Studio 3MF can be sliced here": "Hanya STL, OBJ, atau 3MF Bambu Studio yang belum di-slice yang bisa di-slice di sini",
  "This 3MF is already sliced": "3MF ini sudah di-slice",
  "This 3MF is not set up for the Bambu Lab A1 0.4 mm: slice it in Bambu Studio": "3MF ini tidak diatur untuk Bambu Lab A1 0,4 mm: slice di Bambu Studio",
  "This 3MF uses several filaments: slice it in Bambu Studio": "3MF ini memakai beberapa filamen: slice di Bambu Studio",
  "The slicer output has no printable plate": "Hasil slicer tidak punya plate yang bisa dicetak",
  "The slicer output has more than one plate": "Hasil slicer punya lebih dari satu plate",
  "The slicer output is not for the Bambu Lab A1": "Hasil slicer bukan untuk Bambu Lab A1",
  "The slicer output uses more than one filament": "Hasil slicer memakai lebih dari satu filamen",
  "The slicer output is not for the 0.4 mm nozzle": "Hasil slicer bukan untuk nozzle 0,4 mm",
  "The slicer output is not for the textured PEI plate": "Hasil slicer bukan untuk plate Textured PEI",
  "The slicer output has no weight or time": "Hasil slicer tidak punya berat atau waktu",
  "The slicer output has the wrong filament or colour": "Hasil slicer punya filamen atau warna yang salah",
  "The slicer output has no readable settings": "Pengaturan di hasil slicer tidak bisa dibaca",
  "The slicer output used another filament profile": "Hasil slicer memakai profil filamen lain",
  "The slicer output used other profiles": "Hasil slicer memakai profil lain",
  "The slicer output has other settings than asked": "Pengaturan hasil slicer berbeda dari yang diminta",
  "The sliced file is larger than 50 MB": "File hasil slice lebih besar dari 50 MB",
  "The sliced file is empty": "File hasil slice kosong",
  "The sliced file changed on the way (checksum mismatch)": "File hasil slice berubah di perjalanan (checksum tidak cocok)",
  "Expected model/3mf": "Harus model/3mf",
  // the studio PC: Bambu Studio's answers and the bridge's own checks
  "The slicer could not start": "Slicer tidak bisa mulai",
  "The slicer did not accept its settings": "Slicer tidak menerima pengaturannya",
  "A file the slicer needs was not found": "File yang dibutuhkan slicer tidak ditemukan",
  "A slicer profile could not be read": "Profil slicer tidak bisa dibaca",
  "The model file could not be read (broken, empty or not a supported 3D file)": "File model tidak bisa dibaca (rusak, kosong, atau bukan file 3D yang didukung)",
  "The quality preset does not fit the Bambu Lab A1": "Preset kualitas tidak cocok untuk Bambu Lab A1",
  "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty": "Model tidak muat di bed A1 (256 x 256 x 256 mm) atau kosong",
  "The slicer rejected the settings": "Slicer menolak pengaturannya",
  "Slicing failed": "Slicing gagal",
  "Slicing failed (code {code})": "Slicing gagal (kode {code})",
  "Slicing took longer than {n} min and was stopped": "Slicing lebih lama dari {n} mnt dan dihentikan",
  "Bambu Studio was not found on the studio PC": "Bambu Studio tidak ditemukan di PC studio",
  "Bambu Studio could not be started": "Bambu Studio tidak bisa dijalankan",
  "The Bambu Studio profiles were not found on the studio PC": "Profil Bambu Studio tidak ditemukan di PC studio",
  "The slicer wrote no file": "Slicer tidak menulis file",
  "The sliced file could not be read": "File hasil slice tidak bisa dibaca",
  "The model file is empty or larger than 50 MB": "File model kosong atau lebih besar dari 50 MB",
  "The model file is larger than 50 MB": "File model lebih besar dari 50 MB",
  "Only STL and OBJ files can be sliced here": "Hanya file STL dan OBJ yang bisa di-slice di sini",
  "Only a Bambu Studio 3MF can be sliced with its own settings": "Hanya 3MF Bambu Studio yang bisa di-slice dengan pengaturannya sendiri",
  "Only PLA and PETG can be sliced here": "Hanya PLA dan PETG yang bisa di-slice di sini",
  "The colour must be #RRGGBB": "Warna harus #RRGGBB",
  "Unknown quality": "Kualitas tidak dikenal",
  "Infill must be 0-100 %": "Infill harus 0-100 %",
  "The slice has no download link from this app": "Slice ini tidak punya tautan unduh dari aplikasi ini",
  "Could not download the model": "Model tidak bisa diunduh",
  "Could not download the model (the app answered {http})": "Model tidak bisa diunduh (aplikasi menjawab {http})",
  "The model changed on the way (checksum mismatch)": "Model berubah di perjalanan (checksum tidak cocok)",
  "The model is not the file the slice was asked for": "Model ini bukan file yang diminta untuk di-slice",
  "The slicer hit an error on the studio PC": "Slicer mengalami error di PC studio",
  "Could not upload the sliced file to the app": "File hasil slice tidak bisa diunggah ke aplikasi",
  "The app did not take the sliced file (it answered {http})": "Aplikasi tidak menerima file hasil slice (menjawab {http})",
};

/** Slice state (src/lib/slicing.ts), lower case. */
const SLICE_STATE: Dict = { queued: "dalam antrean", slicing: "sedang di-slice", done: "selesai", failed: "gagal", cancelled: "dibatalkan" };

// ---------- the same texts filled in, so a plain t(value) finds them ----------

/** Adds `en` filled with each row of values, in English and in Indonesian (the template itself is above). */
function filled(en: string, rows: [Vars, Vars?][]): void {
  const target = id[en];
  if (!target) throw new Error(`lib.ts: no template for "${en}"`);
  for (const [enVars, idVars] of rows) id[fill(en, enVars)] = fill(target, idVars ?? enVars);
}

// Today's config (the defaults, as on the live site): the authority card and the Chief page render these.
filled("Price PLA and PETG by weight from the slicer grams a person entered: {price}, unit price rounded up to {round}", [[{ price: "Rp1.500/g", round: "Rp500" }]]);
filled("Heartbeat checks every {every}: wakes the Chief when an order needs a decision", [
  ...[1, 2, 3, 5, 10, 15, 30, 60].map((n): [Vars, Vars] => [{ every: `${n} min` }, { every: `${n} mnt` }]),
  ...[10, 15, 20, 30, 45, 90].map((n): [Vars, Vars] => [{ every: `${n} s` }, { every: `${n} dtk` }]),
]);
filled("Checks up to {n} escrow transfers on Arc per heartbeat; a mismatch becomes a question for a person", [[{ n: 5 }]]);
filled("Orders under {amount} need the owner's approval", [[{ amount: "Rp100.000" }]]);
filled("Orders above {amount} need the owner's approval", [[{ amount: "Rp1.000.000" }]]);
filled("Partners only for orders of {amount} or more", [[{ amount: "Rp300.000" }]]);
filled("Never prices under a {pct}% margin on its own", [[{ pct: 15 }]]);
filled("No payment tool: {n} tools, none moves money; release and refund run in code through the policy", [[{ n: 12 }], [{ n: 13 }]]);
filled("Runs on {network} (test USDC); mainnet is locked unless KESUNI_ALLOW_MAINNET=1", [[{ network: "Arc Testnet" }]]);
filled("Runs on {network} (real USDC); mainnet is unlocked by KESUNI_ALLOW_MAINNET=1", [[{ network: "Arc" }]]);
filled("Runs on {network} (real USDC); mainnet is locked: KESUNI_ALLOW_MAINNET is not 1", [[{ network: "Arc" }]]);
filled("At most {n} background wake-ups per hour (all orders together)", [[{ n: 20 }]]);
filled("Grams per piece must be above 0 and at most {max}", [[{ max: 5000 }]]);
filled("File is larger than {n} MB", [[{ n: 50 }]]);
filled("Message is longer than {n} characters", [[{ n: 500 }]]);
filled("The Chief has already written {n} messages on this order; a person writes from now on", [[{ n: 20 }]]);

// Every status word: "Order is PAID; quotes are closed" → "Pesanan berstatus DIBAYAR; penawaran sudah ditutup".
const each = (words: Dict, key: string): [Vars, Vars][] => Object.entries(words).map(([en, idw]) => [{ [key]: en }, { [key]: idw }]);
for (const en of [
  "Order is {status}; too late to open an escrow", "Order is {status}; the spec is closed", "Order is {status}; quotes are closed",
  "Order is {status}; plan already chosen", "Order is {status}; evidence is closed", "Order is {status}; approval is for choosing a plan",
  "Order is {status}; QC evidence required first", "Order is {status}; choose a plan before printing",
  "Order is {status}; QC photos belong to an order in production", "Order is {status}; a QC photo stays once evidence is submitted",
]) filled(en, each(ORDER_STATUS, "status"));
filled("Order is {status}; nothing to slice now", each(ORDER_STATUS, "status"));
filled("The slice is {sliceState}", each(SLICE_STATE, "sliceState"));
filled("The slice is {sliceState}; the sliced file was kept on the order", each(SLICE_STATE, "sliceState"));
filled("At most {n} slices can wait per order", [[{ n: 3 }]]);
filled("At most {n} slices can wait on the studio PC", [[{ n: 10 }]]);
filled("Slicing took longer than {n} min and was stopped", [[{ n: 10 }]]);
filled("Escrow is {state}, not FUNDED", each(ESCROW_STATE, "state"));
filled("Escrow is {state}", each(ESCROW_STATE, "state"));
filled("printer state is {state}", each({ ...PRINTER_STATE, FAILED: "GAGAL", UNKNOWN: "TIDAK DIKETAHUI" }, "state"));
filled("The printer is {state}: it must be idle or finished", each({ ...PRINTER_STATE, FAILED: "GAGAL", UNKNOWN: "TIDAK DIKETAHUI" }, "state"));
filled("The job is {jobState}; stop the print on the printer instead", each(JOB_STATE, "jobState"));
filled("More than {n} files in the archive", [[{ n: 2000 }]]);
filled("Pick at most {n} colours", [[{ n: 4 }]]);
filled("Expected a {kind}, got \"{ext}\"", [
  [{ kind: "design file (STL, 3MF, STEP, OBJ)", ext: "no extension" }, { kind: "file desain (STL, 3MF, STEP, OBJ)", ext: "tanpa ekstensi" }],
  [{ kind: "reference image (JPG, PNG, WEBP)", ext: "no extension" }, { kind: "gambar referensi (JPG, PNG, WEBP)", ext: "tanpa ekstensi" }],
  [{ kind: "QC photo (JPG, PNG, WEBP)", ext: "no extension" }, { kind: "foto QC (JPG, PNG, WEBP)", ext: "tanpa ekstensi" }],
]);

// Agent prints (src/i18n/id/autoprint.ts): its reasons are library texts too, so tLib finds their templates.
Object.assign(id, autoprint);

export default id;
