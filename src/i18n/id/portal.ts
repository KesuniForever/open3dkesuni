// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// The customer portal (/request/<code>): the customer's own lite pages behind the private invite link.
const id: Record<string, string> = {
  // the page and its menu ("New order", "Machines", "Price calculator" and "Token research" are already in shell.ts / order.ts)
  "Customer portal": "Portal pelanggan",
  "This order link is not valid. Please check the link from Kesuni.": "Link pesanan ini tidak berlaku. Silakan cek lagi link dari Kesuni.",
  "My orders": "Pesanan saya",

  // My orders
  "Orders sent or opened on this phone or browser. Remove from list only hides an order here: the order itself stays.":
    "Pesanan yang dikirim atau dibuka di HP atau browser ini. Hapus dari daftar hanya menyembunyikannya di sini: pesanannya sendiri tetap ada.",
  "No orders from this browser yet.": "Belum ada pesanan dari browser ini.",
  "Not found": "Tidak ditemukan",
  "Remove from list": "Hapus dari daftar",
  "Remove this order from this list? The order itself stays.": "Hapus pesanan ini dari daftar? Pesanannya sendiri tetap ada.",
  "Open": "Buka",
  "Opening…": "Membuka…",
  "Have an order link? Paste it here": "Punya link pesanan? Tempel di sini",
  "This is not an order link. An order link contains /c/ and a code.": "Ini bukan link pesanan. Link pesanan berisi /c/ dan sebuah kode.",
  // an order's status ("Done", "Refunded", "Printing {pct}" and "Quality check" are already translated)
  "Weighing your design": "Desain sedang ditimbang",
  "Preparing your price": "Harga sedang disiapkan",
  "Price ready": "Harga sudah siap",
  "Processing payment": "Pembayaran diproses",
  "Waiting for a printer": "Menunggu printer",
  "Print paused": "Cetak dijeda",
  "Ready to check": "Siap dicek",
  "Refunding": "Sedang dikembalikan",

  // Machines
  "Kesuni's printers right now, straight from the studio. Read only: nothing here can move a printer. The page updates by itself.":
    "Printer Kesuni saat ini, langsung dari studio. Hanya untuk dilihat: dari sini tidak ada yang bisa menggerakkan printer. Halaman ini diperbarui sendiri.",
  "The studio connection is offline. Last report {ago}.": "Koneksi studio sedang offline. Laporan terakhir {ago}.",
  "Waiting for a person at Kesuni": "Menunggu tim Kesuni",
  "Colours loaded": "Warna yang terpasang",

  // Price calculator
  "The weight comes from the slicer (Bambu Studio). Upload your STL in New order and Kesuni weighs it.":
    "Berat didapat dari slicer (Bambu Studio). Unggah file STL Anda di Pesanan baru, lalu Kesuni menimbangnya.",
  "{price} per gram": "{price} per gram",
  "Grams per piece": "Gram per buah",
  "Calculate": "Hitung",
  "{price} per piece": "{price} per buah",
  "An estimate. The final price comes on your order page.": "Ini perkiraan. Harga akhir muncul di halaman pesanan Anda.",
  "Enter the grams per piece as a number, for example 16": "Isi gram per buah dengan angka, misalnya 16",
  "Orders under {min} need Kesuni's approval first, so the price can take longer.":
    "Pesanan di bawah {min} perlu persetujuan Kesuni dulu, jadi harganya bisa lebih lama keluar.",

  // Token research
  "Research only. No token exists and nothing is sold.": "Hanya riset. Tidak ada token dan tidak ada yang dijual.",
  "{n} of {total} checks passed": "{n} dari {total} syarat lulus",
  "Open3DKesuni works without a token. A token would never be offered in Indonesia. These are the checks Kesuni wants passed before even a legal review.":
    "Open3DKesuni berjalan tanpa token. Token tidak akan pernah ditawarkan di Indonesia. Ini syarat yang harus lulus dulu, bahkan sebelum tinjauan hukum.",
};

export default id;
