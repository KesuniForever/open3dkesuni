// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
// "The customer decides" (src/lib/budget-raise.ts): Kesuni's price above the customer's budget on their order page
// (/c/<token>) and in "My orders", "Raise my budget", its answers, and the raise on the operator's order page and the
// Chief page.
const id: Record<string, string> = {
  // the customer's order page
  "Your price is above your budget": "Harga melebihi anggaran Anda",
  "Your budget": "Anggaran Anda",
  "Kesuni can only charge up to the budget you set.": "Kesuni hanya bisa menagih sampai anggaran yang Anda tetapkan.",
  "Raising it lets Kesuni prepare your agreement at this price.": "Jika dinaikkan, Kesuni bisa menyiapkan kesepakatan dengan harga ini.",
  "Above {limit} Kesuni's owner also approves.": "Di atas {limit}, pemilik Kesuni juga ikut menyetujui.",
  "Raise my budget to {price}": "Naikkan anggaran saya menjadi {price}",
  "You do not pay yet: you agree to the final price first.": "Anda belum membayar: Anda menyetujui harga akhir dulu.",
  "Or message Kesuni to change the order.": "Atau hubungi Kesuni untuk mengubah pesanan.",
  "Kesuni is preparing your agreement": "Kesuni sedang menyiapkan kesepakatan Anda",
  "Budget raised to {price}.": "Anggaran sudah dinaikkan menjadi {price}.",
  // "My orders" in the customer portal (src/app/request/[code]/order-status.ts)
  "Above your budget": "Melebihi anggaran",
  "Preparing your agreement": "Kesepakatan sedang disiapkan",

  // answers of "Raise my budget"
  "The price changed. Check the new price above.": "Harganya berubah. Periksa harga baru di atas.",
  "Your budget already covers Kesuni's price.": "Anggaran Anda sudah mencukupi harga Kesuni.",
  "Your budget can no longer change here. Message Kesuni.": "Anggaran Anda tidak bisa diubah lagi di sini. Hubungi Kesuni.",

  // the operator's order page ("Budget mandate" and the log) and the Chief page
  "raised by the customer from {from} ({name}, {date})": "dinaikkan oleh pelanggan dari {from} ({name}, {date})",
  "customer raised the budget to Rp{total} (quote {quote})": "pelanggan menaikkan anggaran menjadi Rp{total} (penawaran {quote})",
  "Customer raised the budget": "Pelanggan menaikkan anggaran",
};

export default id;
