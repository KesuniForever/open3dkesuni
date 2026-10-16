// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// The public landing page (/welcome, src/app/welcome): what Open3DKesuni is, for judges and first-time visitors.
// Words kept as the studio says them: escrow, live, slicer, bed, USDC, Arc, Circle, Claude. Merged first in index.ts:
// a word another part of the app already translates ("Customer", "Printing") keeps that translation.
const id: Record<string, string> = {
  "Open3DKesuni · A 3D-print studio that runs itself": "Open3DKesuni · Studio cetak 3D yang berjalan sendiri",
  "An AI agent runs the order desk of a real 3D-print studio in Padang; the customer's USDC waits in escrow on Arc until they accept the part.":
    "Agen AI mengurus meja pesanan studio cetak 3D sungguhan di Padang; USDC pelanggan menunggu di escrow di Arc sampai mereka menerima hasilnya.",

  // ---------- hero ----------
  "About the studio": "Tentang studio",
  "Real studio · Padang, Indonesia": "Studio sungguhan · Padang, Indonesia",
  "3 Bambu Lab printers": "3 printer Bambu Lab",
  "Circle wallets on Arc Testnet": "Dompet Circle di Arc Testnet",
  "A 3D-print studio that runs itself, and gets paid only when the customer is happy.":
    "Studio cetak 3D yang berjalan sendiri, dan baru dibayar saat pelanggan puas.",
  "Open3DKesuni is the order desk of Kesuni, a real 3D-print studio in Padang, Indonesia. An AI agent takes the orders, prices them, plans the printers and keeps the customer updated. The customer's money waits in a USDC escrow on Arc until they accept the part.":
    "Open3DKesuni adalah meja pesanan Kesuni, studio cetak 3D sungguhan di Padang, Indonesia. Agen AI menerima pesanan, menghitung harga, mengatur printer, dan memberi kabar ke pelanggan. Uang pelanggan menunggu di escrow USDC di Arc sampai mereka menerima hasilnya.",
  "See the studio live": "Lihat studio secara live",
  "Watch the demo": "Tonton demo",
  "AI agent": "Agen AI",
  "Priced by weight": "Harga dari berat",
  "Escrow on Arc": "Escrow di Arc",
  "USDC held": "USDC ditahan",
  "Printer": "Printer",
  "Accepts": "Menerima",
  "Paid only after acceptance": "Dibayar hanya setelah diterima",
  "Live numbers": "Angka live",
  "Orders handled": "Pesanan ditangani",
  "Arc transfers verified": "Transfer Arc terverifikasi",
  "Live from the studio. Includes practice orders and test USDC on Arc Testnet; the live page labels each one.":
    "Langsung dari studio. Termasuk pesanan latihan dan USDC uji di Arc Testnet; halaman live menandai masing-masing.",

  // ---------- the problem ----------
  "The problem": "Masalahnya",
  "Running a small print studio is messy": "Menjalankan studio cetak kecil itu repot",
  "Too many jobs to track by hand": "Terlalu banyak pekerjaan untuk dicatat manual",
  "Orders, weights, prices, printers and deadlines live in chats and notes.":
    "Pesanan, berat, harga, printer, dan tenggat tersebar di chat dan catatan.",
  "Mistakes in the middle": "Kesalahan di tengah jalan",
  "A wrong colour, a wrong price, a part left on the bed, a missed deadline.":
    "Warna salah, harga salah, hasil tertinggal di bed, tenggat terlewat.",
  "Who pays first?": "Siapa bayar duluan?",
  "The customer is afraid to pay before seeing the part; the studio is afraid to print before being paid. \"Print finished\" is not \"customer happy\".":
    "Pelanggan takut bayar sebelum melihat hasilnya; studio takut mencetak sebelum dibayar. \"Cetak selesai\" bukan berarti \"pelanggan puas\".",

  // ---------- why ----------
  "Why this idea": "Kenapa ide ini",
  "We are the studio owners.": "Kami pemilik studionya.",
  "Routine decisions done by an agent.": "Keputusan rutin dikerjakan oleh agen.",
  "The business rules in code that cannot be talked around.": "Aturan bisnis di kode yang tidak bisa dibujuk.",
  "Money held fairly in the middle.": "Uang ditahan secara adil di tengah.",

  // ---------- how it works ----------
  "How it works": "Cara kerjanya",
  "From order to payment, step by step": "Dari pesanan sampai pembayaran, langkah demi langkah",
  "Who acts": "Siapa yang bertindak",
  "Blockchain": "Blockchain",
  "Customer orders": "Pelanggan memesan",
  "AI agent prices by weight and checks the owner's rules": "Agen AI menghitung harga dari berat dan memeriksa aturan pemilik",
  "Customer pays into escrow (Circle wallet on Arc)": "Pelanggan membayar ke escrow (dompet Circle di Arc)",
  "Printers print and report live": "Printer mencetak dan melapor secara live",
  "A person checks quality": "Orang memeriksa kualitas",
  "Customer accepts": "Pelanggan menerima",
  "Code releases the escrow to Kesuni": "Kode mencairkan escrow ke Kesuni",
  "Customer rejects: code refunds the escrow to the customer.": "Pelanggan menolak: kode mengembalikan escrow ke pelanggan.",
  "AI decides. Code constrains. The blockchain executes. Humans control the boundaries.":
    "AI memutuskan. Kode membatasi. Blockchain mengeksekusi. Manusia memegang batasnya.",

  // ---------- technology ----------
  "The technology": "Teknologinya",
  "Three pieces, each with one job": "Tiga bagian, masing-masing satu tugas",
  "The AI agent": "Agen AI-nya",
  "The wallets": "Dompetnya",
  "The network": "Jaringannya",
  "One agent, five skills, no payment tool.": "Satu agen, lima keahlian, tanpa alat pembayaran.",
  "One escrow wallet per order, gas paid by Circle.": "Satu dompet escrow per pesanan, biaya gas dibayar Circle.",
  "USDC-native network: tiny fees, every transfer is public proof, and our code re-checks each one.":
    "Jaringan asli USDC: biaya sangat kecil, setiap transfer jadi bukti publik, dan kode kami memeriksa ulang setiap transfer.",

  // ---------- features ----------
  "Features": "Fitur",
  "What is built and working": "Yang sudah dibangun dan berjalan",
  "Price by weight from the slicer": "Harga dari berat hasil slicer",
  "The owner's rules in code": "Aturan pemilik di dalam kode",
  "Live printers: colours, faults, camera for the team": "Printer live: warna, gangguan, kamera untuk tim",
  "Slicing and printing from the website": "Slicing dan cetak dari website",
  "Escrow per order, released only after acceptance": "Escrow per pesanan, dicairkan hanya setelah diterima",
  "Every transfer re-checked on Arc": "Setiap transfer diperiksa ulang di Arc",
  "Daily report for the owner": "Laporan harian untuk pemilik",
  "Honest labels: real or simulated": "Label jujur: sungguhan atau simulasi",
  "Why three printers?": "Kenapa tiga printer?",
  "They stand in for the partner studios we don't have yet: when one printer can't take a job, the agent picks another. Partner routing and the payment split are not built yet.":
    "Mereka mewakili studio mitra yang belum kami punya: saat satu printer tidak bisa mengambil pekerjaan, agen memilih yang lain. Pembagian ke mitra dan pembagian pembayaran belum dibangun.",

  // ---------- demo ----------
  "Demo": "Demo",
  "See it work": "Lihat cara kerjanya",
  "Open3DKesuni demo video": "Video demo Open3DKesuni",
  "Demo video coming soon": "Video demo segera hadir",
  "Meanwhile, the studio is live:": "Sementara itu, studionya live:",
  "Try the rules": "Coba aturannya",
  "Each scenario runs the real rules engine on a practice order; practice orders are labelled simulated and never counted.":
    "Setiap skenario menjalankan mesin aturan yang sebenarnya pada pesanan latihan; pesanan latihan diberi label simulasi dan tidak pernah dihitung.",
  "Priced and planned": "Harga dan rencana jadi",
  "Waits for the owner's yes": "Menunggu persetujuan pemilik",
  "Owner exception, logged": "Pengecualian pemilik, tercatat",
  "Refused, no override": "Ditolak, tak bisa dilewati",
  "Stopped, no money moved": "Berhenti, tidak ada uang bergerak",
  "A task for a person": "Tugas untuk orang",

  // ---------- who it is for ----------
  "Who it is for": "Untuk siapa",
  "Small businesses that need small batches": "Usaha kecil yang butuh produksi dalam jumlah kecil",
  "Pilot customers in Padang": "Pelanggan pilot di Padang",
  "An accessories shop (50 lighter cases)": "Toko aksesori (50 casing korek)",
  "A graphic designer (modular lamps)": "Desainer grafis (lampu modular)",
  "A boarding-house owner who sells accessories": "Pemilik kos yang juga menjual aksesori",
  "Pilot orders are starting this week; no customer has paid through the app yet.":
    "Pesanan pilot dimulai minggu ini; belum ada pelanggan yang membayar lewat aplikasi.",
  "It also helps": "Juga membantu",
  "Print studios that juggle many small orders": "Studio cetak yang mengurus banyak pesanan kecil",
  "Maker networks that share jobs between printers": "Jaringan maker yang berbagi pekerjaan antar printer",

  // ---------- final call ----------
  "See it for yourself": "Lihat sendiri",
  "Operations dashboard (team login)": "Dasbor operasional (login tim)",
  "Built by the Kesuni team for the Tameion Agents Hackathon · Arc Testnet, test USDC · not real money":
    "Dibuat oleh tim Kesuni untuk Tameion Agents Hackathon · Arc Testnet, USDC uji coba · bukan uang sungguhan",
};

export default id;
