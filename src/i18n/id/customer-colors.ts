// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// The colour picker on the customer pages (/c/<token>, /request/<code>): colours loaded in the studio's AMS right now.
// Written for Indonesian small-business customers: plain, friendly, "Anda". Colour names are in lib.ts.
const id: Record<string, string> = {
  // the picker (src/app/c/ColorPicker.tsx)
  "Material and colour": "Bahan dan warna",
  "PLA: neat and rigid, good for most items. PETG: tougher, and handles heat and water better.":
    "PLA: rapi dan kaku, cocok untuk kebanyakan barang. PETG: lebih kuat, serta lebih tahan panas dan air.",
  "Colours": "Warna",
  "Available colours": "Warna yang tersedia",
  "The spools loaded in Kesuni's printers right now. A dashed circle means Kesuni still checks that colour.":
    "Gulungan filamen yang sedang terpasang di printer Kesuni. Lingkaran bergaris putus-putus berarti warnanya masih dicek Kesuni.",
  "Loading colours…": "Memuat warna…",
  "No colours to show right now. Write the colour you want in the notes.":
    "Belum ada warna yang bisa ditampilkan. Tulis warna yang Anda inginkan di catatan.",
  "Kesuni still checks this colour": "Warna ini masih dicek Kesuni",
  "Multi-colour needs a 3MF file from Bambu Studio. Send it to Kesuni on WhatsApp.":
    "Multi warna perlu file 3MF dari Bambu Studio. Kirim file itu ke Kesuni lewat WhatsApp.",
  "An STL file has no colours. Paint the colours in Bambu Studio, then save the project as a 3MF file.":
    "File STL tidak menyimpan warna. Warnai model di Bambu Studio, lalu simpan proyeknya sebagai file 3MF.",
  "Kesuni is already pricing your order in this material.": "Kesuni sudah menghitung harga pesanan Anda dengan bahan ini.",
  "Not chosen yet": "Belum dipilih",
  "Any colour": "Warna bebas",

  // the order page (src/app/c/[token]/CustomerView.tsx)
  "Change": "Ubah",
  "Choose": "Pilih",
  "Save": "Simpan",
  "Multi-colour: remember to send Kesuni the 3MF file.": "Multi warna: jangan lupa kirim file 3MF ke Kesuni.",
  "You can change this until Kesuni sends the price.": "Anda bisa mengubahnya sampai Kesuni mengirim harga.",

  // answers of the customer API (src/lib/customer.ts)
  "These colours cannot be chosen": "Warna ini tidak bisa dipilih",
  "Pick the colours of one material": "Pilih warna dari satu jenis bahan saja",
  "Kesuni has already priced your order. To change the material or colours, message Kesuni.":
    "Kesuni sudah menghitung harga pesanan Anda. Untuk mengubah bahan atau warna, hubungi Kesuni.",
  "Kesuni is already pricing your order. To change the material, message Kesuni.":
    "Kesuni sedang menghitung harga pesanan Anda. Untuk mengubah bahan, hubungi Kesuni.",
  // the operator's views of the customer's choice (OrderView decision log, ops timeline)
  "customer chose {choice}": "pelanggan memilih {choice}",
  "Customer chose material and colours": "Pelanggan memilih bahan dan warna",
};

export default id;
