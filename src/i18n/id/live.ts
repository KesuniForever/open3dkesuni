// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// The public Live studio page (/live, src/app/live): what the printers, the agent and the Arc escrow do now, read-only.
// Words kept as the studio says them: live, bed, spool, slot, AMS, bridge, heartbeat, escrow, Chief. Texts the page
// shares with My machines, the Chief page and the home page (status words, "Real orders", "Deposit") are in their own
// files. This file is merged last: a key here wins everywhere, so only keys of this page go here.
const id: Record<string, string> = {
  "Live studio": "Studio live",
  "Live studio · Open3DKesuni": "Studio live · Open3DKesuni",
  "Read only": "Hanya baca",
  "A real 3D-print studio in Padang, Indonesia. An AI agent runs the order desk; people do the hands-on work.":
    "Studio cetak 3D sungguhan di Padang, Indonesia. Agen AI mengurus meja pesanan; orang mengerjakan bagian fisiknya.",
  "Nothing on this page can move a printer or money.": "Halaman ini tidak bisa menggerakkan printer atau uang.",
  "Bridge offline · last report {ago}": "Bridge offline · laporan terakhir {ago}",
  "Last Arc transfer": "Transfer Arc terakhir",
  "Rules": "Aturan",
  "allowed": "diizinkan",
  "not allowed": "tidak diizinkan",

  // ---------- overview (the tab the page opens on; the tab names are in shell.ts and autoprint.ts) ----------
  "Running now": "Sedang berjalan",
  "Printers with a print running or paused. Stage words and time left come from the printer; the finish time is an estimate.":
    "Printer yang sedang mencetak atau dijeda. Kata tahap dan sisa waktu berasal dari printer; jam selesai adalah perkiraan.",
  "Ready for a job": "Siap dipakai",
  "Parts to collect": "Hasil perlu diambil",
  "No printer is printing right now.": "Saat ini tidak ada printer yang mencetak.",
  "{time} left": "sisa {time}",
  "Done around {time} WIB": "Selesai sekitar {time} WIB",
  "tomorrow {time}": "besok {time}",
  "Every order on this site, by id only: no customer names or product titles. In progress: not paid out or rejected yet.":
    "Semua pesanan di situs ini, hanya ID-nya: tanpa nama pelanggan atau judul produk. Berjalan: belum dibayarkan dan belum ditolak.",
  "Transactions on Arc": "Transaksi di Arc",
  "Completed escrow transfers on Arc. Only the transfers of real orders count; the team's tests are shown apart.":
    "Transfer escrow yang selesai di Arc. Hanya transfer pesanan nyata yang dihitung; uji coba tim ditampilkan terpisah.",
  "Volume": "Volume",
  "Tests, not counted": "Uji coba, tidak dihitung",
  "Agent today": "Agen hari ini",
  "The AI agent watches the orders and printers by itself and asks a person when it is not sure. Counted from midnight WIB.":
    "Agen AI memantau pesanan dan printer sendiri, dan bertanya ke orang kalau ragu. Dihitung sejak pukul 00.00 WIB.",
  "Claude ran {n} time today.": "Claude berjalan {n} kali hari ini.",
  "Claude ran {n} times today.": "Claude berjalan {n} kali hari ini.",
  "No agent print yet: people started every print so far.": "Belum ada cetak oleh agen: sejauh ini semua cetakan dimulai oleh orang.",

  // ---------- printers ----------
  "Three Bambu Lab A1 Combo printers in the studio. A bridge on the studio network reads them and reports here. Stage and fault texts are Bambu's own.":
    "Tiga printer Bambu Lab A1 Combo di studio. Sebuah bridge di jaringan studio membacanya dan melapor ke sini. Teks tahap dan gangguan adalah kata-kata Bambu sendiri.",
  "Holds a part to collect": "Ada hasil yang perlu diambil",
  "No status yet": "Belum ada status",

  // ---------- the agent at work ----------
  "The agent at work": "Agen sedang bekerja",
  "The Chief is one Claude agent with five skills. A heartbeat checks open orders and printers every few minutes and wakes it when a decision is needed. Rules in code limit what it may do; agent prints are started by code, never by Claude. Names and files are hidden here.":
    "Chief adalah satu agen Claude dengan lima keahlian. Heartbeat memeriksa pesanan aktif dan printer tiap beberapa menit dan membangunkannya saat perlu keputusan. Aturan di kode membatasi apa yang boleh dilakukannya; cetak oleh agen dimulai oleh kode, bukan oleh Claude. Nama dan file disembunyikan di sini.",
  "Code starts them, never Claude, and only after a person confirms the bed is empty. So far: {n}.":
    "Kode yang memulainya, bukan Claude, dan hanya setelah orang memastikan bed kosong. Sejauh ini: {n}.",
  "No agent activity yet.": "Belum ada aktivitas agen.",
  "Refused by policy": "Ditolak oleh kebijakan",
  "Claude could not be reached. The rules carried on.": "Claude tidak bisa dihubungi. Aturan tetap berjalan.",
  "Chief run · a person asked": "Chief berjalan · diminta orang",
  "Chief run · after the owner's OK": "Chief berjalan · setelah pemilik setuju",
  "Chief run · after slicer grams": "Chief berjalan · setelah gram slicer diisi",
  "Agent opened a task for a person": "Agen membuat tugas untuk orang",
  "A person started a print on {printer}": "Seseorang memulai cetak di {printer}",

  // ---------- money on Arc ----------
  "Money on Arc": "Uang di Arc",
  "A customer pays into a USDC escrow on Arc (Circle wallets). It goes to Kesuni only after the customer accepts the print, or back after a rejection. Each transfer links to the Arc explorer.":
    "Pelanggan membayar ke escrow USDC di Arc (wallet Circle). Uang baru ke Kesuni setelah pelanggan menerima hasil cetak, atau kembali setelah ditolak. Setiap transfer bertautan ke explorer Arc.",
  "“Verified on Arc” means this site read the transaction back from Arc itself: sender, recipient and amount match.":
    "“Terverifikasi di Arc” berarti situs ini membaca transaksi langsung dari Arc: pengirim, penerima, dan jumlah cocok.",
  "All money here is test USDC on Arc Testnet.": "Semua uang di sini USDC uji di Arc Testnet.",
  "Transfers on real orders": "Transfer pesanan nyata",
  "Of those, verified": "Yang terverifikasi",
  "{n} test transfer": "{n} transfer uji",
  "{n} test transfers": "{n} transfer uji",
  "Latest transfers": "Transfer terbaru",
  "Test transfers are real Arc Testnet transactions too, but they are not counted above.":
    "Transfer uji juga transaksi nyata di Arc Testnet, tetapi tidak dihitung di atas.",
  "No Arc transfers yet.": "Belum ada transfer Arc.",
  "in progress": "sedang diproses",
  "View on the Arc explorer": "Lihat di explorer Arc",

  // ---------- footer ----------
  "Simulated orders are the team's own tests. They are never counted as real business.":
    "Pesanan simulasi adalah uji coba tim sendiri. Tidak pernah dihitung sebagai bisnis nyata.",
  "The printers stay on the studio network. Only the studio's bridge talks to them, and it calls out to this site.":
    "Printer tetap di jaringan studio. Hanya bridge studio yang terhubung ke printer, dan bridge itu yang menghubungi situs ini.",
  "This page refreshes by itself every {n} s.": "Halaman ini diperbarui sendiri tiap {n} dtk.",
};

export default id;
