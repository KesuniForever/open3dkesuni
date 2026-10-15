// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
// Customer pages: /c/<token> (the order page opened from WhatsApp) and /request/<code> (the invite order form).
// Written for Indonesian small-business customers: plain, friendly, "Anda".
const id: Record<string, string> = {
  // page titles and header
  "Your order · Open3DKesuni": "Pesanan Anda · Open3DKesuni",
  "Order · Open3DKesuni": "Pesanan · Open3DKesuni",
  "Order for {name}": "Pesanan untuk {name}",
  "Order a 3D print": "Pesan cetak 3D",
  "This order link was not found. Please check the link from Kesuni.": "Link pesanan ini tidak ditemukan. Silakan cek lagi link dari Kesuni.",
  "Loading your order…": "Memuat pesanan Anda…",
  "Order sent. <b>Save the link to this page</b>: every update on your order appears here.":
    "Pesanan terkirim. <b>Simpan link halaman ini</b>: semua kabar pesanan Anda muncul di sini.",
  "test order": "pesanan uji",

  // the big headline: where the order is now
  "Done. Thank you!": "Selesai. Terima kasih!",
  "Your payment has been released to Kesuni.": "Pembayaran Anda sudah dilepas ke Kesuni.",
  "Thank you!": "Terima kasih!",
  "The agent is releasing your payment from escrow to Kesuni.": "Agen sedang melepas pembayaran Anda dari escrow ke Kesuni.",
  "Your money has been refunded": "Uang Anda sudah dikembalikan",
  "Kesuni will contact you about a fix.": "Kesuni akan menghubungi Anda soal perbaikannya.",
  "Your money is being refunded": "Uang Anda sedang dikembalikan",
  "The agent is returning the escrow to your wallet.": "Agen sedang mengembalikan dana escrow ke wallet Anda.",
  "Kesuni is preparing your price": "Kesuni sedang menyiapkan harga Anda",
  "We check the design and the printers first. The price will appear on this page.":
    "Kami cek desain dan printer dulu. Harganya akan muncul di halaman ini.",
  "Processing your payment…": "Pembayaran Anda sedang diproses…",
  "Usually under a minute. This page updates by itself.": "Biasanya kurang dari semenit. Halaman ini diperbarui sendiri.",
  "Your price is ready": "Harga Anda sudah siap",
  "Pay into escrow first. The money only goes to Kesuni after you accept the item.":
    "Bayar ke escrow dulu. Uang baru diteruskan ke Kesuni setelah Anda menerima barangnya.",
  "Your item is ready!": "Barang Anda sudah siap!",
  "Look at the quality-check photos, then decide: accept or reject.": "Lihat foto cek kualitas, lalu putuskan: terima atau tolak.",
  "Printing now": "Sedang dicetak",
  "On printer {printer}. Progress comes straight from the printer.": "Di printer {printer}. Progresnya langsung dari printer.",
  "Print paused for a moment": "Cetak dijeda sebentar",
  "A Kesuni operator is handling it (for example, changing filament).": "Operator Kesuni sedang menanganinya (misalnya, mengganti filamen).",
  "Printing finished": "Cetak selesai",
  "Now being taken off the printer and quality-checked.": "Sekarang sedang diangkat dari printer dan dicek kualitasnya.",
  "Payment safe in escrow": "Pembayaran aman di escrow",
  "Your order is waiting for its turn on a printer.": "Pesanan Anda sedang menunggu giliran di printer.",

  // print progress
  "Print progress {n} percent": "Progres cetak {n} persen",
  "about {n} min left": "sekitar {n} menit lagi",
  "The printer connection dropped for a moment. The numbers will update again.":
    "Koneksi printer sempat terputus. Angkanya akan diperbarui lagi.",

  // price and paying
  "about {n} hour": "sekitar {n} jam",
  "about {n} hours": "sekitar {n} jam",
  "Price by weight: {grams} g × {perGram} = {exact}": "Harga menurut berat: {grams} g × {perGram} = {exact}",
  "rounded up to {price}": "dibulatkan ke {price}",
  "per piece": "per buah",
  "{n} pieces × {price} =": "{n} buah × {price} =",
  "What you agree to": "Yang Anda setujui",
  "Where does your money go?": "Uang Anda untuk apa saja?",
  "Kesuni service & profit": "Jasa & keuntungan Kesuni",
  "Total": "Total",
  "I agree to the price, spec and due date above.": "Saya setuju dengan harga, spesifikasi, dan tenggat di atas.",
  "Processing…": "Memproses…",
  "Agree & pay {amount} USDC": "Setuju & bayar {amount} USDC",
  "Your money does <b>not</b> go straight to Kesuni. It is held in <b>escrow</b> (a safety wallet) first.":
    "Uang Anda <b>tidak</b> langsung ke Kesuni. Uang ditahan dulu di <b>escrow</b> (dompet pengaman).",
  "It is released to Kesuni only after you click <b>Accept</b>.": "Uang baru dilepas ke Kesuni setelah Anda klik <b>Terima</b>.",
  "If you click <b>Reject</b>, you get the full amount back.": "Jika Anda klik <b>Tolak</b>, uang Anda kembali utuh.",
  "Test run on the <b>{network}</b> network: test USDC is sent to your wallet automatically. No real money is used.":
    "Uji coba di jaringan <b>{network}</b>: USDC uji dikirim ke wallet Anda secara otomatis. Tidak memakai uang sungguhan.",
  "Payment uses <b>real USDC</b> on the <b>{network}</b> network.": "Pembayaran memakai <b>USDC nyata</b> di jaringan <b>{network}</b>.",

  // the spec the customer agrees to
  "Size": "Ukuran",
  "Material & colour": "Bahan & warna",
  "Layer / infill": "Lapisan / isian",
  "Finishing": "Hasil akhir",
  "Standard": "Standar",
  "Done by": "Selesai paling lambat",
  "How the result is checked": "Cara hasil diperiksa",

  // order steps
  "Order steps": "Langkah pesanan",
  "Order received": "Pesanan diterima",
  "Price and payment": "Harga & pembayaran",
  "Printing": "Mencetak",
  "Quality check": "Cek kualitas",
  "Done": "Selesai",

  // messages, payment proof, updates
  "Messages from Kesuni": "Pesan dari Kesuni",
  "written by the Chief (AI)": "ditulis oleh Chief (AI)",
  "from the Kesuni team": "dari tim Kesuni",
  "Payment proof on the blockchain": "Bukti pembayaran di blockchain",
  "Test USDC sent to your wallet": "USDC uji dikirim ke wallet Anda",
  "You paid into escrow": "Anda membayar ke escrow",
  "Escrow released to Kesuni": "Escrow dilepas ke Kesuni",
  "Escrow refunded to you": "Escrow dikembalikan ke Anda",
  "succeeded": "berhasil",
  "failed, Kesuni will handle it": "gagal, Kesuni akan menanganinya",
  "confirming": "menunggu konfirmasi",
  "view proof": "lihat bukti",
  "Checked directly on the Arc network: recipient and amount match": "Dicek langsung di jaringan Arc: penerima dan jumlahnya cocok",
  "Verified on Arc": "Terverifikasi di Arc",
  "not matching on Arc yet, Kesuni is checking": "belum cocok di Arc, Kesuni sedang mengecek",
  "Latest updates": "Kabar terbaru",
  "view photo": "lihat foto",
  "straight from the printer": "langsung dari printer",
  "logged by an operator": "dicatat oleh operator",

  // agreement and production report
  "Agreement": "Kesepakatan",
  "Approved by {name}": "Disetujui oleh {name}",
  "version {n}": "versi {n}",
  "changed, needs approval again": "berubah, perlu disetujui lagi",
  "Fingerprint:": "Sidik digital:",
  "(changes if the price or spec changes)": "(berubah jika harga atau spesifikasi berubah)",
  "Production report": "Laporan produksi",
  "Filament used": "Filamen terpakai",
  "Machine time": "Waktu mesin",
  "{n} h": "{n} jam",
  "Largest size deviation": "Selisih ukuran terbesar",
  "(limit ±{n} mm)": "(batas ±{n} mm)",
  "out of tolerance": "di luar toleransi",
  "Passed check without rework": "Lolos cek tanpa perbaikan",
  "{n} of {total}": "{n} dari {total}",
  "Measured by a Kesuni operator": "Diukur oleh operator Kesuni",
  "You still check the item yourself.": "Anda tetap memeriksa barangnya sendiri.",

  // accept or reject
  "Quality-check photo": "Foto cek kualitas",
  "Your name": "Nama Anda",
  "Name": "Nama",
  "Note (optional)": "Catatan (opsional)",
  "For example: neat, as ordered": "Contoh: rapi, sesuai pesanan",
  "Warning: the size is outside the agreed tolerance.": "Peringatan: ukuran di luar toleransi yang disepakati.",
  "The largest deviation Kesuni measured is {deviation} mm, while the limit is ±{tolerance} mm. Check the item carefully. You may still accept; if you do, this is recorded. If it is not right, choose Reject and your money is refunded.":
    "Selisih terbesar yang diukur Kesuni {deviation} mm, sedangkan batasnya ±{tolerance} mm. Periksa barang dengan teliti. Anda tetap boleh menerima; jika begitu, hal ini dicatat. Jika tidak sesuai, pilih Tolak dan uang Anda dikembalikan.",
  "I have checked the size, colour, finish and function of the item I received.":
    "Saya sudah memeriksa ukuran, warna, hasil akhir, dan fungsi barang yang saya terima.",
  "Accept the item anyway": "Tetap terima barang",
  "Accept the item": "Terima barang",
  "Reject": "Tolak",
  "Yes, reject and refund": "Ya, tolak & kembalikan uang",
  "Accept: the agent releases the money from escrow to Kesuni. Reject: the agent returns the money to your wallet.":
    "Terima: agen melepas uang dari escrow ke Kesuni. Tolak: agen mengembalikan uang ke wallet Anda.",
  "Your decision": "Keputusan Anda",
  "accepted": "diterima",
  "rejected": "ditolak",
  "by {name}": "oleh {name}",
  "Your decision is recorded, but the payment was held by the safety rules. Kesuni has been told.":
    "Keputusan Anda sudah dicatat, tetapi pembayarannya ditahan oleh aturan pengaman. Kesuni sudah diberi tahu.",
  "Connection lost. Please try again.": "Koneksi terputus. Silakan coba lagi.",

  // review
  "How did it turn out?": "Bagaimana hasilnya?",
  "Item quality": "Kualitas barang",
  "Communication": "Komunikasi",
  "Value for money": "Sepadan dengan harga",
  "A few words (optional)": "Komentar singkat (opsional)",
  "What was right, what should improve?": "Apa yang bagus? Apa yang kurang?",
  "Send review": "Kirim ulasan",
  "Reviews count toward Kesuni's reputation. The number of orders alone does not raise the score; results that pass checks and arrive on time do.":
    "Ulasan ikut menentukan reputasi Kesuni. Jumlah pesanan saja tidak menaikkan skor; yang menaikkan adalah hasil yang lolos cek dan tiba tepat waktu.",
  "Your review": "Ulasan Anda",
  "Quality {quality}/5 · Communication {communication}/5 · Value for money {value}/5":
    "Kualitas {quality}/5 · Komunikasi {communication}/5 · Sepadan dengan harga {value}/5",

  // footer
  "Needed by: {date}": "Dibutuhkan tanggal: {date}",
  "Your note:": "Catatan Anda:",
  "Your address and phone number are not stored here and are never sent to the AI. Money can only move through the safety rules (policy), never at the AI's will.":
    "Alamat dan nomor HP Anda tidak disimpan di sini dan tidak pernah dikirim ke AI. Uang hanya bisa berpindah lewat aturan pengaman (policy), bukan atas kemauan AI.",

  // order form (/request/<code>)
  "What would you like printed?": "Apa yang ingin Anda cetak?",
  "Fill in your order. Kesuni prepares the price, then you can pay and follow the print from your order page.":
    "Isi pesanan Anda. Kesuni menyiapkan harganya, lalu Anda bisa membayar dan memantau proses cetak dari halaman pesanan Anda.",
  "Your name or business": "Nama Anda atau nama usaha",
  "What to print": "Yang ingin dicetak",
  "For example: lighter case, black": "Contoh: casing korek api, hitam",
  "Quantity": "Jumlah",
  "Needed by": "Dibutuhkan tanggal",
  "Maximum budget (Rupiah)": "Anggaran maksimal (Rupiah)",
  "Notes (size, colour, design)": "Catatan (ukuran, warna, desain)",
  "Optional": "Opsional",
  "Do not write your address or phone number here. Kesuni asks for them directly on WhatsApp.":
    "Jangan tulis alamat atau nomor HP Anda di sini. Kesuni akan menanyakannya langsung lewat WhatsApp.",
  "Sending…": "Mengirim…",
  "Send order": "Kirim pesanan",

  // errors from the customer API routes (src/app/api/c), shown only on these pages
  "This order link is not valid": "Link pesanan ini tidak berlaku",
  "Too many orders in one hour. Try again later or contact Kesuni.": "Terlalu banyak pesanan dalam satu jam. Coba lagi nanti atau hubungi Kesuni.",
};

export default id;
