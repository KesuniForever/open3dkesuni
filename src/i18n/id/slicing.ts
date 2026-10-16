// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// Slicing on the website: "Slice here" in "Colours & print" on the order page (src/app/orders/[id]/SlicePanel.tsx).
// Bambu Studio words stay as they are: slice, slicer, spool, slot, plate, nozzle, infill, support, bridge, AMS. The
// reasons and errors the libraries and the studio PC return are in lib.ts (templates for tLib).
const id: Record<string, string> = {
  "Slice here": "Slice di sini",
  "Bambu Studio on the studio PC slices the file for the A1 (0.4 mm nozzle, textured PEI plate) in the colour of the spool you pick. The sliced file shows below and prints from that spool. Multi-colour: paint the 3MF in Bambu Studio and upload the .gcode.3mf.":
    "Bambu Studio di PC studio men-slice file untuk A1 (nozzle 0,4 mm, plate Textured PEI) dengan warna spool yang Anda pilih. File hasil slice muncul di bawah dan dicetak dari spool itu. Multiwarna: warnai 3MF di Bambu Studio lalu unggah .gcode.3mf-nya.",
  "File": "File",
  "Spool": "Spool",
  "No spools reported": "Belum ada spool yang dilaporkan",
  "Infill %": "Infill %",
  "Supports": "Support",
  "Auto": "Otomatis",
  "Standard 0.20 mm": "Standar 0,20 mm",
  "Fine 0.16 mm": "Halus 0,16 mm",
  "Draft 0.24 mm": "Draf 0,24 mm",
  "Project settings": "Pengaturan proyek",
  "infill {n}%": "infill {n}%",
  "supports auto": "support otomatis",
  "no supports": "tanpa support",
  "One colour: an STL carries no colours.": "Satu warna: STL tidak membawa warna.",
  "Keeps the project's own settings; one colour.": "Memakai pengaturan proyek itu sendiri; satu warna.",
  "Slice": "Slice",
  "Studio PC ready": "PC studio siap",
  "Studio PC not seen": "PC studio belum terlihat",
  "The studio PC has not asked for slices in the last 2 min: is the bridge running with Bambu Studio?":
    "PC studio belum meminta slice dalam 2 mnt terakhir: apakah bridge berjalan dengan Bambu Studio?",
  "Slice this file?": "Slice file ini?",
  "Cancel this slice?": "Batalkan slice ini?",
  "Cancel slice": "Batalkan slice",
  "Already sliced with these settings.": "Sudah di-slice dengan pengaturan ini.",
  "This slice is already on its way.": "Slice ini sudah dalam proses.",
  "Sent to the studio PC.": "Dikirim ke PC studio.",
  "Slice cancelled.": "Slice dibatalkan.",
  "Waiting for the studio PC": "Menunggu PC studio",
  "Slicing…": "Sedang di-slice…",
  "Sliced": "Sudah di-slice",
  "Print it": "Cetak",
  "Older slices ({n})": "Slice lama ({n})",
  "Slice it above, or upload a .gcode.3mf from Bambu Studio under Files.": "Slice di atas, atau unggah .gcode.3mf dari Bambu Studio di bagian File.",
  // the decision log (src/lib/ops.ts describeEntry)
  "Slice asked by {name}": "Slice diminta oleh {name}",
  "Agent asked for a slice": "Agen meminta slice",
  "Sliced on the studio PC": "Di-slice di PC studio",
  "Slice failed": "Slice gagal",
  "Slice cancelled by {name}": "Slice dibatalkan oleh {name}",
  // project 3MFs the studio PC refuses before Bambu Studio sees them (scripts/bridge/slicer.mjs projectProblem)
  "The 3MF could not be read (broken, or a suspicious archive)": "3MF tidak bisa dibaca (rusak, atau arsip mencurigakan)",
  "The 3MF unpacks to more than 500 MB": "3MF ini membesar lebih dari 500 MB saat dibuka",
  "The 3MF has no readable Bambu Studio settings": "3MF ini tidak punya pengaturan Bambu Studio yang bisa dibaca",
  "The 3MF runs a post-processing script: slice it in Bambu Studio": "3MF ini menjalankan skrip post-processing: slice di Bambu Studio",
  "The 3MF uses its own printer settings: slice it in Bambu Studio": "3MF ini memakai pengaturan printer sendiri: slice di Bambu Studio",
};

export default id;
