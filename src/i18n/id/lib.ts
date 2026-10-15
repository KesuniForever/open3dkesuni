// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// The fixed texts that shared libraries (src/lib, src/app/api) hand to pages: the Chief's rules and skills, the
// "Needs attention" lines, status words, and the reasons and errors the API returns to forms. Pages render them
// with t(value). Texts that the code builds with a value in them are listed twice: as a template with {placeholders}
// (tLib in src/lib/lib-text.ts reverse-matches any value) and filled with today's config or every status word, so a
// plain t(value) finds them too. Data from the database (task texts, notes, the Chief's own words) is never here.

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
  "Price by weight from the slicer grams a person entered: {price}/g, unit price rounded up to {round}":
    "Harga per berat dari gram slicer yang diisi orang: {price}/g, harga satuan dibulatkan ke atas ke {round}",
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
  "Materials other than plain PLA": "Material selain PLA biasa",
  "price_by_weight refuses when the spec is not plain PLA or the order text names another material (a keyword list, so a person double-checks)":
    "price_by_weight menolak jika spesifikasi bukan PLA biasa atau teks pesanan menyebut material lain (daftar kata kunci, jadi orang tetap mengecek ulang)",
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
  "Grams per unit must be above 0 and at most {max}": "Gram per unit harus di atas 0 dan maksimal {max}",
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
  "Budget minimal Rp1.000": "Anggaran minimal Rp1.000",
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
  "File refused": "File ditolak",
  "File not found": "File tidak ditemukan",
  "File is too large": "File terlalu besar",
  "Expected multipart form data with a file": "Kirim form multipart berisi file",
  "Expected a file field": "Field file tidak ada",

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
};

// ---------- the same texts filled in, so a plain t(value) finds them ----------

/** Adds `en` filled with each row of values, in English and in Indonesian (the template itself is above). */
function filled(en: string, rows: [Vars, Vars?][]): void {
  const target = id[en];
  if (!target) throw new Error(`lib.ts: no template for "${en}"`);
  for (const [enVars, idVars] of rows) id[fill(en, enVars)] = fill(target, idVars ?? enVars);
}

// Today's config (the defaults, as on the live site): the authority card and the Chief page render these.
filled("Price by weight from the slicer grams a person entered: {price}/g, unit price rounded up to {round}", [[{ price: "Rp1.500", round: "Rp500" }]]);
filled("Heartbeat checks every {every}: wakes the Chief when an order needs a decision", [
  ...[1, 2, 3, 5, 10, 15, 30, 60].map((n): [Vars, Vars] => [{ every: `${n} min` }, { every: `${n} mnt` }]),
  ...[10, 15, 20, 30, 45, 90].map((n): [Vars, Vars] => [{ every: `${n} s` }, { every: `${n} dtk` }]),
]);
filled("Checks up to {n} escrow transfers on Arc per heartbeat; a mismatch becomes a question for a person", [[{ n: 5 }]]);
filled("Orders under {amount} need the owner's approval", [[{ amount: "Rp100.000" }]]);
filled("Orders above {amount} need the owner's approval", [[{ amount: "Rp1.000.000" }]]);
filled("Partners only for orders of {amount} or more", [[{ amount: "Rp300.000" }]]);
filled("Never prices under a {pct}% margin on its own", [[{ pct: 15 }]]);
filled("No payment tool: {n} tools, none moves money; release and refund run in code through the policy", [[{ n: 12 }]]);
filled("Runs on {network} (test USDC); mainnet is locked unless KESUNI_ALLOW_MAINNET=1", [[{ network: "Arc Testnet" }]]);
filled("Runs on {network} (real USDC); mainnet is unlocked by KESUNI_ALLOW_MAINNET=1", [[{ network: "Arc" }]]);
filled("Runs on {network} (real USDC); mainnet is locked: KESUNI_ALLOW_MAINNET is not 1", [[{ network: "Arc" }]]);
filled("At most {n} background wake-ups per hour (all orders together)", [[{ n: 20 }]]);
filled("Grams per unit must be above 0 and at most {max}", [[{ max: 5000 }]]);
filled("File is larger than {n} MB", [[{ n: 50 }]]);
filled("Message is longer than {n} characters", [[{ n: 500 }]]);
filled("The Chief has already written {n} messages on this order; a person writes from now on", [[{ n: 20 }]]);

// Every status word: "Order is PAID; quotes are closed" → "Pesanan berstatus DIBAYAR; penawaran sudah ditutup".
const each = (words: Dict, key: string): [Vars, Vars][] => Object.entries(words).map(([en, idw]) => [{ [key]: en }, { [key]: idw }]);
for (const en of [
  "Order is {status}; too late to open an escrow", "Order is {status}; the spec is closed", "Order is {status}; quotes are closed",
  "Order is {status}; plan already chosen", "Order is {status}; evidence is closed", "Order is {status}; approval is for choosing a plan",
  "Order is {status}; QC evidence required first", "Order is {status}; choose a plan before printing",
  "Order is {status}; QC photos belong to an order in production",
]) filled(en, each(ORDER_STATUS, "status"));
filled("Escrow is {state}, not FUNDED", each(ESCROW_STATE, "state"));
filled("Escrow is {state}", each(ESCROW_STATE, "state"));
filled("printer state is {state}", each({ ...PRINTER_STATE, FAILED: "GAGAL", UNKNOWN: "TIDAK DIKETAHUI" }, "state"));
filled("Expected a {kind}, got \"{ext}\"", [
  [{ kind: "design file (STL, 3MF, STEP, OBJ)", ext: "no extension" }, { kind: "file desain (STL, 3MF, STEP, OBJ)", ext: "tanpa ekstensi" }],
  [{ kind: "reference image (JPG, PNG, WEBP)", ext: "no extension" }, { kind: "gambar referensi (JPG, PNG, WEBP)", ext: "tanpa ekstensi" }],
  [{ kind: "QC photo (JPG, PNG, WEBP)", ext: "no extension" }, { kind: "foto QC (JPG, PNG, WEBP)", ext: "tanpa ekstensi" }],
]);

export default id;
