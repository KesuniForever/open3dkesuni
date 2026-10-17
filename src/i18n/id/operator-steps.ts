// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// The operator's order page as six steps (src/app/orders/[id]/Steps.tsx, operator-step.ts, OrderView.tsx and the step
// panels): the Now banner, the step cards, their one-line summaries and the new lines in Slice, Price and Print.
// Words that already had an entry ("Slice", "Price", "Now", "Waiting", "In production", "Rejected", "Price agreed",
// "Price ready", "Run agent", "Mark this task done?", "Mesin saya") are not repeated here.
const id: Record<string, string> = {
  // ---------- chrome ----------
  "Model": "Model",
  "Print": "Cetak",
  "Collect & QC": "Ambil & QC",
  "Hand-over & payment": "Serah terima & pembayaran",
  "Owner & agent tools": "Alat pemilik & agen",
  "Price check, spec, owner's rules, quotes, agent log, plan vs actual": "Cek harga, spek, aturan pemilik, penawaran, log agen, rencana vs aktual",
  "Done ✓": "Selesai ✓",
  "Later": "Nanti",
  "Step {n} of 6": "Langkah {n} dari 6",
  "Go to step {n}": "Ke langkah {n}",
  "Open tasks": "Tugas terbuka",
  "More options": "Opsi lainnya",

  // ---------- the first line of each step ----------
  "The customer's model and the order's other files.": "Model dari pelanggan dan file lain pesanan ini.",
  "The studio PC turns the model into a ready-to-print file, in the colour of the spool you pick.":
    "PC studio mengubah model jadi file siap cetak, dengan warna spool yang Anda pilih.",
  "The price comes from the slice's weight. The customer agrees and pays on their own page.":
    "Harga dihitung dari berat hasil slice. Pelanggan setuju dan membayar di halamannya sendiri.",
  "Start the print at the printer. Pause or stop it on My machines.": "Mulai cetak saat Anda di dekat printer. Jeda atau hentikan di Mesin saya.",
  "Take the pieces off the bed, check them, then record the QC result.": "Ambil hasil cetak dari bed, cek, lalu catat hasil QC.",
  "The customer accepts the pieces; then the payment is released.": "Pelanggan menerima hasilnya; setelah itu pembayaran dicairkan.",

  // ---------- the Now line ----------
  "Waiting for the model file. Upload it in step 1, or ask the customer for it.": "Menunggu file model. Unggah di langkah 1, atau minta ke pelanggan.",
  "The model is a STEP file: export it as STL from the CAD program, then upload it in step 1.":
    "Modelnya file STEP: ekspor jadi STL dari program CAD, lalu unggah di langkah 1.",
  "Weighing the model on the studio PC… Nothing to do now.": "Model sedang ditimbang di PC studio… Belum ada yang perlu dikerjakan.",
  "Slicing on the studio PC… Nothing to do now.": "Sedang di-slice di PC studio… Belum ada yang perlu dikerjakan.",
  "Slice the model to get its weight for the price.": "Slice modelnya dulu untuk dapat beratnya (untuk harga).",
  "Slice the model in the customer's colour, ready to print.": "Slice modelnya dengan warna pilihan pelanggan, siap untuk dicetak.",
  "The Chief is making the price. Nothing to do now.": "Chief sedang menghitung harga. Belum ada yang perlu dikerjakan.",
  "Make the price from the slice.": "Buat harganya dari hasil slice.",
  "Price sent. Waiting for the customer to agree.": "Harga sudah dikirim. Menunggu pelanggan setuju.",
  "Waiting for the customer's payment. Printing opens once it is in escrow.": "Menunggu pembayaran pelanggan. Baru bisa dicetak setelah pembayaran masuk escrow.",
  "Price made. The Chief picks the plan next; then the customer sees the price. Nothing to do now.":
    "Harga sudah dibuat. Chief memilih rencananya berikutnya; setelah itu pelanggan bisa melihat harganya. Belum ada yang perlu dikerjakan.",
  "Price made. Press Run agent in step 3 so it picks the plan; then the customer sees the price.":
    "Harga sudah dibuat. Tekan Jalankan agen di langkah 3 supaya agen memilih rencananya; setelah itu pelanggan bisa melihat harganya.",
  "Ready to print. Go to the printer, check the bed is empty, then press Start print.":
    "Siap dicetak. Datangi printernya, pastikan bed kosong, lalu tekan Mulai cetak.",
  "The agent prints this order after someone confirms the bed on My machines.":
    "Agen mencetak pesanan ini setelah ada yang memastikan bed kosong di Mesin saya.",
  "Printing on {printer} · {pct}% · about {left} left. Nothing to do until it ends.":
    "Sedang dicetak di {printer} · {pct}% · sekitar {left} lagi. Tunggu sampai selesai.",
  "Printing on {printer} · {pct}%. Nothing to do until it ends.": "Sedang dicetak di {printer} · {pct}%. Tunggu sampai selesai.",
  "Paused on {printer} at {pct}%. Check the printer on My machines.": "Dijeda di {printer} pada {pct}%. Cek printernya di Mesin saya.",
  "{printer} has not reported for {ago} (last: printing {pct}%). Check the printer.":
    "{printer} sudah {ago} tidak melapor (terakhir: mencetak {pct}%). Cek printernya.",
  "Sending the print to {printer}… Nothing to do now.": "Cetakan sedang dikirim ke {printer}… Belum ada yang perlu dikerjakan.",
  "Sending the print to the printer… Nothing to do now.": "Cetakan sedang dikirim ke printer… Belum ada yang perlu dikerjakan.",
  "Print finished on {printer}. Take the pieces off, check them, then record the QC result.":
    "Cetakan di {printer} selesai. Ambil hasilnya, cek, lalu catat hasil QC.",
  "Print finished. Take the pieces off, check them, then record the QC result.": "Cetakan selesai. Ambil hasilnya, cek, lalu catat hasil QC.",
  "Print finished on {printer}. Take the pieces off, then confirm the bed on My machines so the agent prints the next one ({done} of {needed} done).":
    "Cetakan di {printer} selesai. Ambil hasilnya, lalu pastikan bed kosong di Mesin saya supaya agen mencetak berikutnya ({done} dari {needed} selesai).",
  "QC done. Waiting for the customer to accept the pieces.": "QC selesai. Menunggu pelanggan menerima hasilnya.",
  "The customer accepted. The payment is released next (step 6).": "Pelanggan sudah menerima. Pembayaran dicairkan berikutnya (langkah 6).",
  "The customer accepted. Release the payment to Kesuni in Customer payment.": "Pelanggan sudah menerima. Cairkan pembayaran ke Kesuni di Pembayaran pelanggan.",
  "Go to the payment": "Ke pembayaran",
  "Finished and paid. Nothing left to do.": "Selesai dan sudah dibayar. Tidak ada lagi yang perlu dikerjakan.",
  "The customer rejected this order. The owner decides what happens next.": "Pelanggan menolak pesanan ini. Pemilik yang memutuskan langkah berikutnya.",

  // ---------- the order's status in plain words ----------
  "Being priced": "Sedang dihitung harganya",
  "QC done, waiting for the customer": "QC selesai, menunggu pelanggan",
  "Accepted by the customer": "Diterima pelanggan",
  "Paid": "Lunas",

  // ---------- a closed card's one line ----------
  "{file} · {n} files": "{file} · {n} file",
  "{file} · {n} file": "{file} · {n} file",
  "No model yet.": "Belum ada model.",
  "Ready to print: {what} · {grams} · {time}": "Siap cetak: {what} · {grams} · {time}",
  "Weighed for the price: {grams} (any colour)": "Ditimbang untuk harga: {grams} (warna bebas)",
  "Not sliced yet.": "Belum di-slice.",
  "{unit} per piece × {qty} = {total}": "{unit} per buah × {qty} = {total}",
  "Needs the weight from step 2.": "Perlu berat dari langkah 2.",
  "Printing on {printer} · {pct}%": "Dicetak di {printer} · {pct}%",
  "Printed on {printer} ✓": "Sudah dicetak di {printer} ✓",
  "Printed ✓": "Sudah dicetak ✓",
  "{done} of {needed} prints done": "{done} dari {needed} cetakan selesai",
  "After the customer pays.": "Setelah pelanggan membayar.",
  "Ready to start.": "Siap dimulai.",
  "QC recorded ✓": "QC sudah dicatat ✓",
  "After printing.": "Setelah dicetak.",
  "After QC.": "Setelah QC.",
  "Waiting for the customer.": "Menunggu pelanggan.",

  // ---------- step 2 · Slice ----------
  "Customer wants": "Keinginan pelanggan",
  "Spec colour: {color}": "Warna di spek: {color}",
  "customer's colour ✓": "warna pelanggan ✓",
  "This spool is not one of the customer's colours.": "Spool ini bukan warna pilihan pelanggan.",
  "Settings: {settings}": "Pengaturan: {settings}",
  "The slicing PC is off. Turn on the studio PC (Bambu Studio and the Kesuni bridge) or tell the owner. A slice waits up to 15 min.":
    "PC untuk slice sedang mati. Nyalakan PC studio (Bambu Studio dan bridge Kesuni) atau kabari pemilik. Slice menunggu sampai 15 menit.",
  "For the price only": "Hanya untuk harga",
  "by the agent": "oleh agen",
  // A printer and its AMS slot: reads the same.
  "{printer} slot {slots}": "{printer} slot {slots}",

  // ---------- step 4 · Print ----------
  "You start this print here. Agent prints are off.": "Anda yang memulai cetakan ini di sini. Cetak oleh agen sedang mati.",
  "You start this print here. The agent does not print this order (0 prints set).":
    "Anda yang memulai cetakan ini di sini. Agen tidak mencetak pesanan ini (0 cetakan).",
  "The agent prints this order: {done} of {needed} prints done. It starts only after someone confirms the bed on My machines.":
    "Agen mencetak pesanan ini: {done} dari {needed} cetakan selesai. Agen baru mulai setelah ada yang memastikan bed kosong di Mesin saya.",
  "{done} of {needed} prints done. The agent prints no more of this order.": "{done} dari {needed} cetakan selesai. Agen tidak mencetak pesanan ini lagi.",
  "You start this print here.": "Anda yang memulai cetakan ini di sini.",
  "You start this print here. The agent cannot print it now:": "Anda yang memulai cetakan ini di sini. Agen belum bisa mencetaknya sekarang:",
  "Change agent prints": "Ubah cetakan agen",
  "Prints for the agent": "Jumlah cetakan untuk agen",
  "This order has {units}; one print is one plate.": "Pesanan ini {units}; satu cetakan = satu plate.",
  "The agent may start at once if a printer's bed is already confirmed empty.": "Agen bisa langsung mulai kalau bed printer sudah dipastikan kosong.",
  "Ready-to-print file": "File siap cetak",
  "for the price only": "hanya untuk harga",
  "No ready-to-print file yet. Slice the model in step 2, or upload a .gcode.3mf from Bambu Studio in step 1.":
    "Belum ada file siap cetak. Slice modelnya di langkah 2, atau unggah .gcode.3mf dari Bambu Studio di langkah 1.",
  "In Bambu Studio: slice for the Bambu Lab A1 (0.4 mm), then File > Export > Export plate sliced file. Upload the .gcode.3mf in step 1.":
    "Di Bambu Studio: slice untuk Bambu Lab A1 (0,4 mm), lalu File > Export > Export plate sliced file. Unggah .gcode.3mf di langkah 1.",
  "check first": "cek dulu",
  "can't print": "tidak bisa",
  "This file was sliced only to weigh the model, in any colour. Slice it in the customer's colour first (step 2).":
    "File ini di-slice hanya untuk menimbang model, dengan warna bebas. Slice dulu dengan warna pilihan pelanggan (langkah 2).",
  "Not the customer's colour: they chose {wanted}, this file prints {got}.": "Bukan warna pilihan pelanggan: pelanggan memilih {wanted}, file ini mencetak {got}.",
  "The customer has not agreed to the price yet. Print now only if the owner says so.":
    "Pelanggan belum setuju harganya. Cetak sekarang hanya kalau pemilik bilang boleh.",
  "Before you start": "Sebelum mulai",
  "I checked the warnings above": "Saya sudah cek peringatan di atas",
  "Can't start yet: {reason}": "Belum bisa mulai: {reason}",
  "Can't start yet: {reason} (+{n} more above)": "Belum bisa mulai: {reason} (+{n} lagi di atas)",
  "Start another print": "Mulai cetakan lain",
  "Print history ({n})": "Riwayat cetak ({n})",
  "All printers": "Semua printer",
  "Reserve for this order": "Tahan untuk pesanan ini",
  "Keeps this printer for this order. It does not start a print.": "Menahan printer ini untuk pesanan ini. Tidak memulai cetakan.",
  "Test: mark as printed": "Uji: tandai sudah dicetak",

  // ---------- step 3 · Price ----------
  "Price: {unit} per piece × {qty} = {total}": "Harga: {unit} per buah × {qty} = {total}",
  "{grams} g per piece · priced by {who} · {date}": "{grams} g per buah · dihitung oleh {who} · {date}",
  "the operator": "operator",
  "Customer agreed ✓": "Pelanggan setuju ✓",
  "Waiting for the customer to agree": "Menunggu pelanggan setuju",
  "Paid ✓": "Sudah dibayar ✓",
  "Not paid yet": "Belum dibayar",
  "Test order: no payment needed": "Pesanan uji: tidak perlu bayar",
  "The price uses {priced} g per piece, but the newest slice weighs {sliced} g per piece. Check which is right before the customer pays.":
    "Harga memakai {priced} g per buah, tapi slice terbaru beratnya {sliced} g per buah. Cek mana yang benar sebelum pelanggan membayar.",
  "The Chief is pricing it with {grams} g per piece from the slice.": "Chief sedang menghitung harga dengan {grams} g per buah dari hasil slice.",
  "From the slice: {grams} g per piece ({file})": "Dari hasil slice: {grams} g per buah ({file})",
  "Send {grams} g to the Chief": "Kirim {grams} g ke Chief",
  "Make the price: {total}": "Buat harga: {total}",
  "Slice the model first (step 2) to get its weight.": "Slice modelnya dulu (langkah 2) untuk dapat beratnya.",
  "Type the grams by hand": "Ketik gram secara manual",
  "Make the price myself": "Buat harga sendiri",
  "Send the grams to the Chief": "Kirim gramnya ke Chief",
  "Fill in the grams and where they come from.": "Isi gram dan dari mana angkanya.",
  "Price details": "Rincian harga",

  // ---------- step 5 · Collect & QC ----------
  "{printer} still has this order's print on the bed.": "{printer} masih menyimpan cetakan pesanan ini di bed.",
  "Part collected": "Hasil sudah diambil",
  "Part collected from {printer}?": "Hasil di {printer} sudah diambil?",
  "This frees the printer for the next order. It does not start any print.": "Ini membebaskan printer untuk pesanan berikutnya. Tidak memulai cetakan apa pun.",
  "Add a QC photo": "Tambah foto QC",
  "QC comes after the last run ({done} of {needed} printed).": "QC dilakukan setelah cetakan terakhir ({done} dari {needed} sudah dicetak).",
  "Needed before the customer's payment can be released. Add a QC photo in step 1 (Model); it does not replace this result.":
    "Wajib sebelum pembayaran pelanggan bisa diteruskan. Tambahkan foto QC di langkah 1 (Model); foto itu tidak menggantikan hasil ini.",
  "Add a production note": "Tambah catatan produksi",
};

export default id;
