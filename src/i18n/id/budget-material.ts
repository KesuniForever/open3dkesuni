// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// New order: the budget in rupiah or USDC (shown as Rp, USDC and US$), the material (PLA or PETG) and the finishing
// choice. Money formats stay as the app writes them: Rp1.650, 12.5 USDC, US$12.50.
const id: Record<string, string> = {
  // ---------- New order form (src/app/components/NewOrderForm.tsx) ----------
  "Budget": "Anggaran",
  "Currency": "Mata uang",
  "1 USDC = US$1 = {rate} (app rate)": "1 USDC = US$1 = {rate} (kurs aplikasi)",

  // ---------- budget reasons from the form and POST /api/orders (src/lib/budget.ts) ----------
  "Type the budget in whole rupiah, like 50.000": "Tulis anggaran dalam rupiah bulat, mis. 50.000",
  "The budget is required (rupiah or USDC)": "Anggaran wajib diisi (rupiah atau USDC)",
  "Give the budget in rupiah or in USDC, not both": "Isi anggaran dalam rupiah atau USDC, jangan keduanya",

  // ---------- order lists (home page, /orders) ----------
  "{id} · {units} · budget {budget} · due {due} ·": "{id} · {units} · anggaran {budget} · tenggat {due} ·",

  // ---------- spec: finishing choices, stored in English (src/lib/spec-choices.ts) ----------
  "Sanded": "Diamplas",
  "Primed for paint": "Diberi primer, siap dicat",
  "Finishing must be Standard, Sanded or Primed for paint": "Hasil akhir harus Standar, Diamplas, atau Diberi primer, siap dicat",
  "In USDC the dot is a decimal point. For rupiah, switch to Rp.": "Dalam USDC titik adalah tanda desimal. Untuk rupiah, pilih Rp.",
};

export default id;
