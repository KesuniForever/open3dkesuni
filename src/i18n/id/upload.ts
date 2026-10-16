// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// The customer's own design upload (STL or OBJ) and the automatic weighing that prices it.
const id: Record<string, string> = {
  // ---------- the order form (src/app/request/[code]/OrderForm.tsx) ----------
  "Your design (one piece)": "Desain Anda (satu buah)",
  "Optional. One file is one piece: the price is multiplied by the quantity. STL or OBJ, up to 25 MB. Kesuni weighs it to set the price. For a 3MF or several colours, send the file on WhatsApp.":
    "Opsional. Satu file untuk satu buah; harganya dikalikan dengan jumlah pesanan. STL atau OBJ, maksimal 25 MB. Kesuni menimbangnya untuk menentukan harga. Untuk file 3MF atau beberapa warna, kirim filenya lewat WhatsApp.",
  "Sending your design…": "Mengirim desain Anda…",
  "Remove file": "Hapus file",
  // why a design is refused (src/lib/file-rules.ts, src/lib/auto-weigh.ts, POST /api/c)
  "STEP files cannot be weighed here: export an STL from your CAD program": "File STEP tidak bisa ditimbang di sini: ekspor STL dari program CAD Anda",
  "Export your model as an STL or OBJ. Send a 3MF project on WhatsApp.": "Ekspor model Anda sebagai STL atau OBJ. Kirim proyek 3MF lewat WhatsApp.",
  "Send your design as an STL or OBJ file": "Kirim desain Anda sebagai file STL atau OBJ",
  "Your design file is empty": "File desain Anda kosong",
  "Your design is larger than 25 MB. Send it on WhatsApp instead.": "Desain Anda lebih dari 25 MB. Kirim lewat WhatsApp saja.",
  "This STL file is broken or empty. Export it again and send it.": "File STL ini rusak atau kosong. Ekspor ulang lalu kirim lagi.",
  "This OBJ file is broken or empty. Export it again and send it.": "File OBJ ini rusak atau kosong. Ekspor ulang lalu kirim lagi.",
  "Your design cannot be used": "Desain Anda tidak bisa dipakai",
  "Blocked: this request came from another site.": "Diblokir: permintaan ini datang dari situs lain.",
  // the order route's other answers (POST /api/c, POST /api/c/<token>)
  "Your order could not be read. Please try again.": "Pesanan Anda tidak terbaca. Silakan coba lagi.",
  "The order is too long": "Isi pesanannya terlalu panjang",
  "The request is too long": "Isi permintaannya terlalu panjang",
  "Too many tries in one hour. Try again later or contact Kesuni.": "Terlalu banyak percobaan dalam satu jam. Coba lagi nanti atau hubungi Kesuni.",
  "Too many designs sent in one hour. Try again later or contact Kesuni.": "Terlalu banyak desain yang dikirim dalam satu jam. Coba lagi nanti atau hubungi Kesuni.",
  "Kesuni is receiving other designs right now. Try again in a minute.": "Kesuni sedang menerima desain lain. Coba lagi sebentar lagi.",

  // ---------- the customer's order page (src/app/c/[token]/CustomerView.tsx) ----------
  "Weighing your design…": "Sedang menimbang desain Anda…",
  "Your design: {g} g per piece": "Desain Anda: {g} g per buah",
  "Kesuni will check your file": "Kesuni akan mengecek file Anda",

  // ---------- the order page (operator) ----------
  "From the customer": "Dari pelanggan",
  "Automatic slice": "Slice otomatis",
  "automatic, for the price": "otomatis, untuk harga",
  // the decision log (src/lib/ops.ts describeEntry)
  "Grams from the automatic weighing": "Gram dari penimbangan otomatis",
  "Customer sent their design": "Pelanggan mengirim desainnya",
  "Customer's design not stored": "Desain pelanggan tidak tersimpan",
  "Automatic weighing could not start": "Penimbangan otomatis tidak bisa dimulai",
  "Design weighed automatically": "Desain ditimbang otomatis",
  "Automatic weighing: a person enters the grams": "Penimbangan otomatis: tim Kesuni mengisi gramnya",
  "Weighing the customer's design": "Menimbang desain pelanggan",
  // reasons the libraries give (src/lib/slicing.ts, src/lib/agreement.ts, src/lib/auto-weigh.ts, src/lib/printer/autoprint.ts)
  "The design cannot be weighed automatically now": "Desain tidak bisa ditimbang otomatis sekarang",
  "The studio PC's slicer has not asked for work in the last 2 min": "Slicer di PC studio belum meminta pekerjaan dalam 2 mnt terakhir",
  "Too many designs are being weighed: a person enters the grams": "Terlalu banyak desain yang sedang ditimbang: tim Kesuni mengisi gramnya",
  "Only an STL or OBJ is weighed automatically: a person enters the grams": "Hanya STL atau OBJ yang ditimbang otomatis: tim Kesuni mengisi gramnya",
  "Not weighed automatically": "Tidak ditimbang otomatis",
  "The design could not be stored": "Desain tidak bisa disimpan",
  "Saving the file failed on the studio PC": "File gagal disimpan di PC studio",
  "The order already has grams per unit: they stay": "Pesanan sudah punya gram per unit: tetap dipakai",
  "The sliced design has more than one plate: a person enters the grams": "Desain hasil slice punya lebih dari satu plate: tim Kesuni mengisi gramnya",
  "Not a finished automatic weighing": "Bukan penimbangan otomatis yang sudah selesai",
  "Its grams were not used": "Gramnya tidak dipakai",
  "A person already slices this file: a person enters the grams": "Tim Kesuni sudah men-slice file ini: gramnya diisi oleh tim",
  "Sliced only to weigh the design: the agent slices it again to print": "Di-slice hanya untuk menimbang desain: agen men-slice ulang untuk mencetak",
};

export default id;
