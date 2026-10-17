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
  "test order": "pesanan uji",

  // the big headline: where the order is now
  "Done. Thank you!": "Selesai. Terima kasih!",
  "Your payment has been released to Kesuni.": "Pembayaran Anda sudah dilepas ke Kesuni.",
  "Thank you!": "Terima kasih!",
  "Your money has been refunded": "Uang Anda sudah dikembalikan",
  "Kesuni will contact you about a fix.": "Kesuni akan menghubungi Anda soal perbaikannya.",
  "Your money is being refunded": "Uang Anda sedang dikembalikan",
  "Kesuni is preparing your price": "Kesuni sedang menyiapkan harga Anda",
  "Processing your payment…": "Pembayaran Anda sedang diproses…",
  "Usually under a minute. This page updates by itself.": "Biasanya kurang dari semenit. Halaman ini diperbarui sendiri.",
  "Your price is ready": "Harga Anda sudah siap",
  "Your item is ready!": "Barang Anda sudah siap!",
  "Printing now": "Sedang dicetak",
  "On printer {printer}. Progress comes straight from the printer.": "Di printer {printer}. Progresnya langsung dari printer.",
  "Print paused for a moment": "Cetak dijeda sebentar",
  "A Kesuni operator is handling it (for example, changing filament).": "Operator Kesuni sedang menanganinya (misalnya, mengganti filamen).",
  "Printing finished": "Cetak selesai",
  "Now being taken off the printer and quality-checked.": "Sekarang sedang diangkat dari printer dan dicek kualitasnya.",
  "Your order is waiting for its turn on a printer.": "Pesanan Anda sedang menunggu giliran di printer.",

  // print progress
  "Print progress {n} percent": "Progres cetak {n} persen",
  "about {n} min left": "sekitar {n} menit lagi",
  "The printer connection dropped for a moment. The numbers will update again.":
    "Koneksi printer sempat terputus. Angkanya akan diperbarui lagi.",

  // price and paying
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
  "Payment uses <b>real USDC</b> on the <b>{network}</b> network.": "Pembayaran memakai <b>USDC nyata</b> di jaringan <b>{network}</b>.",

  // the spec the customer agrees to
  "Size": "Ukuran",
  "Material & colour": "Bahan & warna",
  "Finishing": "Hasil akhir",
  "Standard": "Standar",
  "How the result is checked": "Cara hasil diperiksa",

  // order steps
  "Order steps": "Langkah pesanan",
  "Order received": "Pesanan diterima",
  "Price and payment": "Harga & pembayaran",
  "Printing": "Mencetak",
  // My orders' badge for a printed item Kesuni checks (next to "Your turn: check the item"): its own words
  "Quality check": "Sedang dicek Kesuni",
  "Done": "Selesai",

  // messages, payment proof, updates
  "Messages from Kesuni": "Pesan dari Kesuni",
  "written by the Chief (AI)": "ditulis oleh Chief (AI)",
  "from the Kesuni team": "dari tim Kesuni",
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
  "changed, needs approval again": "berubah, perlu disetujui lagi",
  "Production report": "Laporan produksi",
  "Machine time": "Waktu mesin",
  "{n} h": "{n} jam",
  "(limit ±{n} mm)": "(batas ±{n} mm)",
  "{n} of {total}": "{n} dari {total}",
  "Measured by a Kesuni operator": "Diukur oleh operator Kesuni",
  "You still check the item yourself.": "Anda tetap memeriksa barangnya sendiri.",

  // accept or reject
  "Quality-check photo": "Foto cek kualitas",
  "Your name": "Nama Anda",
  "Name": "Nama",
  "Note (optional)": "Catatan (opsional)",
  "For example: neat, as ordered": "Contoh: rapi, sesuai pesanan",
  "I have checked the size, colour, finish and function of the item I received.":
    "Saya sudah memeriksa ukuran, warna, hasil akhir, dan fungsi barang yang saya terima.",
  "Accept the item anyway": "Tetap terima barang",
  "Accept the item": "Terima barang",
  "Reject": "Tolak",
  "Yes, reject and refund": "Ya, tolak & kembalikan uang",
  "Your decision": "Keputusan Anda",
  "accepted": "diterima",
  "rejected": "ditolak",
  "by {name}": "oleh {name}",
  "Connection lost. Please try again.": "Koneksi terputus. Silakan coba lagi.",

  // review
  "How did it turn out?": "Bagaimana hasilnya?",
  "Item quality": "Kualitas barang",
  "Communication": "Komunikasi",
  "Value for money": "Sepadan dengan harga",
  "A few words (optional)": "Komentar singkat (opsional)",
  "What was right, what should improve?": "Apa yang bagus? Apa yang kurang?",
  "Send review": "Kirim ulasan",
  "Your review": "Ulasan Anda",
  "Quality {quality}/5 · Communication {communication}/5 · Value for money {value}/5":
    "Kualitas {quality}/5 · Komunikasi {communication}/5 · Sepadan dengan harga {value}/5",

  // footer
  "Your note:": "Catatan Anda:",

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
  "For example: 150.000 or 150rb": "Contoh: 150.000 atau 150rb",
  "Type the budget in rupiah, like 150.000 or 150rb": "Tulis anggaran dalam rupiah, misalnya 150.000 atau 150rb",
  "Optional": "Opsional",
  "Do not write your address or phone number here. Kesuni asks for them directly on WhatsApp.":
    "Jangan tulis alamat atau nomor HP Anda di sini. Kesuni akan menanyakannya langsung lewat WhatsApp.",
  "Sending…": "Mengirim…",
  "Send order": "Kirim pesanan",

  // errors from the customer API routes (src/app/api/c), shown only on these pages
  "This order link is not valid": "Link pesanan ini tidak berlaku",
  "Too many orders in one hour. Try again later or contact Kesuni.": "Terlalu banyak pesanan dalam satu jam. Coba lagi nanti atau hubungi Kesuni.",
  "Pick a date from today on.": "Pilih tanggal mulai hari ini.",
  "This couldn't go through. Kesuni has been told and will contact you.": "Belum bisa diproses. Kesuni sudah diberi tahu dan akan menghubungi Anda.",

  // ---------- the order page, plain words (17 Oct bug hunt) ----------
  // a way out and a way to reach Kesuni
  "We can't find this order. The link may be cut off or replaced by a new one, or the order was cancelled.":
    "Pesanan ini tidak ditemukan. Mungkin link-nya terpotong atau sudah diganti link baru, atau pesanan sudah dibatalkan.",
  "My order link does not work.": "Link pesanan saya tidak bisa dibuka.",
  "Chat Kesuni on WhatsApp": "Chat Kesuni di WhatsApp",
  "Order {id}": "Pesanan {id}",
  "Order sent! Save this link so you can open your order later.": "Pesanan terkirim! Simpan link ini supaya pesanan bisa dibuka lagi.",
  "Copy link": "Salin link",
  "Send to my WhatsApp": "Kirim ke WhatsApp saya",
  // headline and steps: the order's status first
  "Kesuni is checking your order. The price will appear on this page. You can close it and open the link again later.":
    "Kesuni sedang memeriksa pesanan Anda. Harga akan muncul di halaman ini. Anda boleh menutupnya dan membuka link ini lagi nanti.",
  "Pay first. The money only goes to Kesuni after you accept the item.": "Bayar dulu. Uang baru diteruskan ke Kesuni setelah Anda menerima barangnya.",
  "Payment received and kept safe": "Pembayaran diterima dan disimpan aman",
  "Your order is being made": "Pesanan Anda sedang dibuat",
  "The payment is still open: pay below.": "Belum dibayar: bayar di bawah.",
  "The payment is still open: pay below, then you can accept or reject here.":
    "Belum dibayar: bayar di bawah, lalu Anda bisa menerima atau menolak di sini.",
  "Payment still open": "Belum dibayar",
  "The payment did not go through": "Pembayaran belum berhasil",
  "Tap Pay again, or wait: Kesuni has been told.": "Ketuk Bayar lagi, atau tunggu: Kesuni sudah diberi tahu.",
  // testnet: the rupiah go to Kesuni on WhatsApp; the app only agrees and runs its test escrow
  "Check the details below, then agree.": "Cek detailnya di bawah, lalu setujui.",
  "Kesuni sends the payment details on WhatsApp.": "Kesuni mengirim cara bayarnya lewat WhatsApp.",
  "Price agreed": "Harga disepakati",
  "It did not go through": "Belum berhasil",
  "Tap the button again, or wait: Kesuni has been told.": "Ketuk tombolnya lagi, atau tunggu: Kesuni sudah diberi tahu.",
  // an order printed piece by piece, between two runs (order page and My orders)
  "Your order is being printed": "Pesanan Anda sedang dicetak",
  "{printed} of {total} pieces printed.": "{printed} dari {total} buah sudah dicetak.",
  "Printed {printed} of {total}": "Tercetak {printed} dari {total}",
  "When the item is in your hands, check it, then accept or reject here.": "Setelah barang ada di tangan Anda, periksa, lalu terima atau tolak di sini.",
  "The quality-check photos are below.": "Foto cek kualitas ada di bawah.",
  "Your order is complete.": "Pesanan Anda selesai.",
  "Kesuni is finishing the payment. Nothing for you to do.": "Kesuni sedang menyelesaikan pembayaran. Anda tidak perlu melakukan apa-apa.",
  "Your payment is on its way to Kesuni.": "Pembayaran Anda sedang diteruskan ke Kesuni.",
  "You rejected the item": "Anda menolak barangnya",
  "Kesuni is finishing the refund. Nothing for you to do.": "Kesuni sedang menyelesaikan pengembalian uang. Anda tidak perlu melakukan apa-apa.",
  "It is on its way back to you.": "Uangnya sedang dalam perjalanan kembali ke Anda.",
  "Running late. Kesuni will tell you the new date.": "Pesanan terlambat. Kesuni akan memberi tahu tanggal barunya.",
  "You check the item": "Anda memeriksa barang",
  "Rejected, money back": "Ditolak, uang kembali",
  // printing
  "Paused. Kesuni is on it.": "Dijeda. Tim Kesuni sedang menangani.",
  "Printing started": "Mulai dicetak",
  "Printing again": "Lanjut dicetak",
  "Paused, Kesuni is on it": "Dijeda, tim Kesuni sedang menangani",
  "Printing stopped, Kesuni is on it": "Cetak dihentikan, tim Kesuni sedang menangani",
  "This print didn't work, Kesuni will print it again": "Cetakan gagal, Kesuni akan cetak ulang",
  // price and paying: rupiah first, the test USDC behind the ⓘ
  "Print time: about {n} hour": "Waktu cetak: sekitar {n} jam",
  "Print time: about {n} hours": "Waktu cetak: sekitar {n} jam",
  "Kesuni changed the price or details after you agreed. Please check them again.": "Kesuni mengubah harga atau detail setelah Anda setuju. Mohon periksa lagi.",
  "Agree to {price}": "Setujui harga {price}",
  "Agree & pay {amount} USDC": "Setuju & bayar {amount} USDC",
  "Tick the box and write your name to continue.": "Centang kotak dan tulis nama Anda untuk lanjut.",
  "Your money does <b>not</b> go straight to Kesuni. It is kept safe first.": "Uang Anda <b>tidak</b> langsung ke Kesuni. Uangnya disimpan aman dulu.",
  "It goes to Kesuni only after you tap <b>Accept</b>.": "Uang baru diteruskan ke Kesuni setelah Anda mengetuk <b>Terima</b>.",
  "If you tap <b>Reject</b>, you get the full amount back.": "Jika Anda mengetuk <b>Tolak</b>, uang Anda kembali utuh.",
  "Today you pay Kesuni in rupiah: Kesuni sends the payment details on WhatsApp. In the app, the same amount runs as a test USDC escrow on {network}.":
    "Untuk saat ini Anda membayar Kesuni dalam rupiah: Kesuni mengirim cara bayarnya lewat WhatsApp. Di aplikasi, jumlah yang sama berjalan sebagai escrow USDC uji di {network}.",
  "In the app: {amount}. Test USDC is sent to your payment wallet automatically, then held in escrow (a safety wallet) until you accept or reject. No real money moves in the app.":
    "Di aplikasi: {amount}. USDC uji dikirim ke wallet pembayaran Anda secara otomatis, lalu ditahan di escrow (dompet pengaman) sampai Anda menerima atau menolak. Tidak ada uang sungguhan yang berpindah di aplikasi.",
  "Payment proof (technical)": "Bukti pembayaran (teknis)",
  // agreement and production report, without jargon
  "Ready by": "Selesai paling lambat",
  "Every unit is checked for size, colour, finish and function before hand-over.":
    "Setiap buah dicek ukuran, warna, hasil akhir, dan fungsinya sebelum diserahkan.",
  "Material used": "Bahan terpakai",
  "Size accuracy": "Ketepatan ukuran",
  "OK first time": "Langsung lolos cek",
  "size not as agreed": "ukuran tidak sesuai",
  // accept or reject
  "Warning: the size is not as agreed.": "Peringatan: ukurannya tidak sesuai kesepakatan.",
  "Kesuni measured up to {deviation} mm off, while the agreed limit is ±{tolerance} mm. Check the item carefully. You may still accept; if you do, this is recorded. If it is not right, choose Reject and your money is refunded.":
    "Kesuni mengukur selisih sampai {deviation} mm, sedangkan batas yang disepakati ±{tolerance} mm. Periksa barang dengan teliti. Anda tetap boleh menerima; jika begitu, hal ini dicatat. Jika tidak sesuai, pilih Tolak dan uang Anda dikembalikan.",
  "Accept: Kesuni gets paid. Reject: you get your money back.": "Terima: Kesuni dibayar. Tolak: uang Anda kembali.",
  "Thank you! Your review helps Kesuni get better.": "Terima kasih! Ulasan Anda membantu Kesuni jadi lebih baik.",
  // the design and the colours
  "Drag to turn your model. Kesuni weighs it to set the price.": "Geser untuk memutar model. Kesuni menimbangnya untuk menentukan harga.",
  "Have a 3D file? (optional)": "Punya file 3D? (opsional)",
  "More than one colour? Kesuni will help you set the colours on WhatsApp.": "Lebih dari satu warna? Kesuni akan bantu atur warnanya lewat WhatsApp.",
  "Switched to {material}: one material per order.": "Ganti ke {material}: satu bahan per pesanan.",
  "Colours Kesuni usually has": "Warna yang biasanya ada di Kesuni",
  "The printers are not reporting right now: these are the colours they had loaded last.":
    "Printer sedang tidak mengirim laporan: ini warna yang terakhir terpasang.",
  // footer: the date the customer asked for, until the agreement's "Ready by"
  "Needed by: {date}": "Dibutuhkan tanggal: {date}",
  "Your maximum budget: {price}": "Anggaran maksimal Anda: {price}",
  "Your address and phone number are not stored on this page.": "Alamat dan nomor HP Anda tidak disimpan di halaman ini.",
  "Your address and phone number are not stored on this page. Your money only moves when you accept or reject.":
    "Alamat dan nomor HP Anda tidak disimpan di halaman ini. Uang Anda hanya berpindah saat Anda menerima atau menolak.",

  // ---------- the order form ----------
  "This is the most you want to pay; the price may be lower.": "Ini batas maksimal Anda; harganya bisa lebih murah.",
  "3D file (optional)": "File 3D (opsional)",
  "No 3D file? Skip this and describe the item in the notes.": "Tidak punya file 3D? Lewati saja, jelaskan barangnya di catatan.",
  "Please choose your 3D file again.": "Silakan pilih file 3D Anda lagi.",
  "Anything else? (size, use, ideas)": "Ada lagi? (ukuran, kegunaan, ide)",
};

export default id;
