// English text (exactly as written in the code) → Indonesian. Keep {placeholders} identical on both sides.
//
// Agent prints: the "Agent may start prints" switch (Chief page), "Bed is empty" and "Next agent print" (My machines),
// the Agent line on the order page, and every reason the dispatcher and its gates give (src/lib/printer/autoprint.ts,
// dispatch.ts, jobs.ts). Merged into lib.ts, so tLib also finds the templates with {placeholders} in library texts.
// Words kept as Bambu Studio and the studio say them: bed, spool, slot, slice, bridge, AMS, plate.
const id: Record<string, string> = {
  // ---------- the switch (Chief page) ----------
  "Agent prints": "Cetak oleh agen",
  "When on, code (not Claude) starts the next paid order by itself, only on a printer whose bed a person confirmed empty since its last print: one print per confirmation. People load filament and empty the beds.":
    "Jika aktif, kode (bukan Claude) memulai pesanan lunas berikutnya sendiri, hanya di printer yang bed-nya sudah dipastikan kosong oleh orang sejak cetakan terakhirnya: satu cetakan per konfirmasi. Orang yang memasang filamen dan mengosongkan bed.",
  "by {name}, {when}": "oleh {name}, {when}",
  "Turn on": "Aktifkan",
  "Turn off": "Matikan",
  "Off on this server (KESUNI_AUTO_PRINT=off).": "Mati di server ini (KESUNI_AUTO_PRINT=off).",
  "Last agent decisions": "Keputusan agen terakhir",
  "None yet.": "Belum ada.",
  "Studio": "Studio",
  "Turn agent prints on?": "Aktifkan cetak oleh agen?",
  "Turn agent prints off?": "Matikan cetak oleh agen?",
  "The agent may then start a paid order by itself, each time after a person confirms a bed is empty.":
    "Setelah itu agen boleh memulai pesanan lunas sendiri, setiap kali setelah orang memastikan sebuah bed kosong.",
  "Agent prints that have not reached a printer are cancelled. People start every print again.":
    "Cetakan agen yang belum sampai ke printer dibatalkan. Orang kembali memulai setiap cetakan.",
  "Ask the dispatcher to look": "Minta dispatcher memeriksa",
  "Prints after a person empties the bed": "Mencetak setelah orang mengosongkan bed",
  "Does not turn agent prints on": "Tidak menyalakan cetak oleh agen",

  // ---------- the authority card (src/lib/agent/authority.ts) ----------
  "Ask the code dispatcher to look at the print queue now (it cannot skip a gate)":
    "Meminta dispatcher (kode) memeriksa antrean cetak sekarang (tidak bisa melewati satu gerbang pun)",
  "Starts prints only when a person confirmed the bed empty and the switch is on":
    "Memulai cetak hanya jika orang sudah memastikan bed kosong dan sakelarnya aktif",
  "One agent print per 'Bed is empty' a person pressed after the last print ended (valid 2 h)": "Satu cetakan agen per 'Bed kosong' yang ditekan orang setelah cetakan terakhir selesai (berlaku 2 jam)",
  "Pausing or stopping a print, and emptying the bed": "Menjeda atau menghentikan cetakan, dan mengosongkan bed",
  "no printer control tool; the dispatcher (code, no Claude) queues a print only after a person confirmed the bed empty, once per confirmation, with the switch on":
    "tidak ada alat kontrol printer; dispatcher (kode, tanpa Claude) mengantrekan cetakan hanya setelah orang memastikan bed kosong, sekali per konfirmasi, dengan sakelar aktif",
  "agent prints are off: people start and control prints on the website, each with their name":
    "cetak oleh agen mati: orang memulai dan mengontrol cetakan di website, masing-masing dengan namanya",
  "Turning agent prints on or off": "Menyalakan atau mematikan cetak oleh agen",
  "no tool for the switch: a person's name and confirmation on the Chief page": "tidak ada alat untuk sakelar: nama dan konfirmasi orang di halaman Chief",
  "no slicer or file access for the Chief: grams per unit come only from a person; the dispatcher (code) slices only an STL or OBJ in the order's one colour with the studio's presets, and prints only files it sliced that way":
    "Chief tidak punya akses slicer atau file: gram per unit hanya dari orang; dispatcher (kode) hanya men-slice STL atau OBJ dalam satu warna pesanan dengan preset studio, dan hanya mencetak file yang di-slice dengan cara itu",

  // ---------- My machines ----------
  "Set on the Chief page": "Diatur di halaman Chief",
  "Agent prints on": "Cetak oleh agen aktif",
  "Agent prints off": "Cetak oleh agen mati",
  "Confirmed by {name}": "Dikonfirmasi oleh {name}",
  "Empty · agent may print once": "Kosong · agen boleh mencetak sekali",
  "Next agent print": "Cetak agen berikutnya",
  "Is the bed empty?": "Bed sudah kosong?",
  "Take the print off {printer}. The plate is on the bed, clean and empty.": "Ambil cetakan dari {printer}. Plate terpasang di bed, bersih dan kosong.",
  "Agent prints are on: the agent may then start one print here by itself, within 2 h.": "Cetak oleh agen aktif: setelah itu agen boleh memulai satu cetakan di sini sendiri, dalam 2 jam.",
  "Each control with a person's name. Agent prints (code, when on) start only after a person confirmed the bed empty. Never the Chief; never heat, move or G-code.":
    "Setiap kontrol dengan nama orang. Cetak oleh agen (kode, jika aktif) baru mulai setelah orang memastikan bed kosong. Tidak pernah oleh Chief; tidak pernah memanaskan, menggerakkan, atau G-code.",
  "A person pauses or stops a print with their name. A print starts by a person, or by code after a person confirmed the bed empty when agent prints are on. The app never moves an axis, heats or sends G-code.":
    "Orang menjeda atau menghentikan cetakan dengan namanya. Cetakan dimulai oleh orang, atau oleh kode setelah orang memastikan bed kosong saat cetak oleh agen aktif. Aplikasi tidak pernah menggerakkan sumbu, memanaskan, atau mengirim G-code.",

  // ---------- the order page (Colours & print) ----------
  "Agent": "Agen",
  "Runs {done} of {needed}": "Cetakan {done} dari {needed}",
  "Edit": "Ubah",
  "With agent prints on, code starts this order by itself on a printer whose bed a person confirmed empty, until the runs are printed. 0 runs: never. An order that is not real needs its runs set first.":
    "Dengan cetak oleh agen aktif, kode memulai pesanan ini sendiri di printer yang bed-nya sudah dipastikan kosong oleh orang, sampai semua cetakan selesai. 0 cetakan: tidak pernah. Pesanan yang bukan asli perlu diisi jumlah cetakannya dulu.",
  "Runs for the agent": "Jumlah cetakan untuk agen",
  "Runs saved.": "Jumlah cetakan disimpan.",
  "Prints needed (0 to {max})": "Cetakan yang dibutuhkan (0 sampai {max})",
  "Each finished print of this order counts one, also a person's.": "Setiap cetakan pesanan ini yang selesai dihitung satu, juga cetakan oleh orang.",
  "Print the order's sliced Bambu Studio file on a studio printer. A person confirms the bed is empty and stands at the printer; the LAN bridge uploads the file and starts the print. The Chief (Claude) never starts a print; with agent prints on, code does, only after a person confirmed the bed empty.":
    "Cetak file Bambu Studio pesanan yang sudah di-slice di printer studio. Orang memastikan bed kosong dan berdiri di dekat printer; bridge LAN mengunggah file dan memulai cetakan. Chief (Claude) tidak pernah memulai cetakan; dengan cetak oleh agen aktif, kode yang memulainya, hanya setelah orang memastikan bed kosong.",
  "by the agent (bed: {name})": "oleh agen (bed: {name})",

  // ---------- the decision log (src/lib/ops.ts describeEntry) ----------
  "Agent started a print on {printer}": "Agen memulai cetakan di {printer}",
  "bed confirmed by {name}": "bed dikonfirmasi oleh {name}",
  "Agent print waits": "Cetak agen menunggu",
  "Agent prints turned on by {name}": "Cetak oleh agen diaktifkan oleh {name}",
  "Agent prints turned off by {name}": "Cetak oleh agen dimatikan oleh {name}",
  "Runs set by {name}": "Jumlah cetakan diatur oleh {name}",
  "{n} runs": "{n} cetakan",
  "Bed confirmed empty by {name}": "Bed dipastikan kosong oleh {name}",
  "Asked the dispatcher to look": "Meminta dispatcher memeriksa",

  // ---------- reasons: the switch, the printer, the bed (src/lib/printer/autoprint.ts, autoprint-rules.ts) ----------
  "Agent prints are off": "Cetak oleh agen mati",
  "No report in the last minute": "Tidak ada laporan dalam 1 menit terakhir",
  "No report in the last 2 min": "Tidak ada laporan dalam 2 mnt terakhir",
  "The last print failed: a person starts the next one": "Cetakan terakhir gagal: orang yang memulai cetakan berikutnya",
  "The printer is preparing a print": "Printer sedang menyiapkan cetakan",
  "The printer is printing": "Printer sedang mencetak",
  "The printer is paused": "Printer sedang dijeda",
  "The printer is slicing": "Printer sedang slicing",
  "The printer is starting up": "Printer sedang menyala",
  "The printer does not report its state": "Printer tidak melaporkan statusnya",
  "A print job is on its way to the printer": "Ada pekerjaan cetak yang sedang dikirim ke printer",
  "Printer warning {code}: a person checks it": "Peringatan printer {code}: orang yang memeriksanya",
  "Nobody confirmed the colours on this printer": "Belum ada yang mengonfirmasi warna di printer ini",
  "Linked to {order}": "Terhubung ke {order}",
  "The bed holds a finished print: a person empties it": "Bed berisi cetakan yang sudah selesai: orang yang mengosongkannya",
  "The bed was confirmed more than 2 h ago: confirm it again": "Bed dikonfirmasi lebih dari 2 jam lalu: konfirmasi lagi",
  "Waiting for a person to confirm the bed is empty": "Menunggu orang memastikan bed kosong",
  "No order waits for an agent print": "Tidak ada pesanan yang menunggu cetak agen",
  "The agent prints only after a person confirmed the bed is empty": "Agen hanya mencetak setelah orang memastikan bed kosong",
  "A print started on the printer": "Ada cetakan yang dimulai di printer",
  "A print ended on the printer": "Ada cetakan yang selesai di printer",
  "The printer did not report for a while": "Printer tidak melapor selama beberapa waktu",

  // ---------- reasons: the order and its file ----------
  "Order is {status}": "Pesanan berstatus {status}",
  "Not a real order: a person sets its runs to let the agent print it": "Bukan pesanan asli: orang mengisi jumlah cetakannya agar agen boleh mencetak",
  "A person set 0 runs: the agent does not print it": "Orang mengisi 0 cetakan: agen tidak mencetaknya",
  "Waiting for the customer's payment": "Menunggu pembayaran pelanggan",
  "All runs printed ({done} of {needed})": "Semua cetakan selesai ({done} dari {needed})",
  "Run {n} of {needed} is on the printer": "Cetakan {n} dari {needed} ada di printer",
  "A print failed: a person decides on a reprint (close its task)": "Cetakan gagal: orang memutuskan cetak ulang (tutup tugasnya)",
  "The agent's last print did not start: a person checks the printer (close its task)": "Cetakan terakhir agen tidak mulai: orang memeriksa printer (tutup tugasnya)",
  "The file is not on this order": "File ini bukan milik pesanan ini",
  "Not a sliced file": "Bukan file yang sudah di-slice",
  "The sliced file is not for the Bambu Lab A1": "File hasil slice bukan untuk Bambu Lab A1",
  "The sliced file has {n} plates: a person prints it": "File hasil slice punya {n} plate: orang yang mencetaknya",
  "The sliced file is not for the 0.4 mm nozzle": "File hasil slice bukan untuk nozzle 0,4 mm",
  "The sliced file is not for the textured PEI plate": "File hasil slice bukan untuk plate Textured PEI",
  "The sliced file is {type}; the order is {material}": "File hasil slice berbahan {type}; pesanan berbahan {material}",
  "The sliced file's colours are not the order's": "Warna file hasil slice bukan warna pesanan",
  "The sliced file cannot be printed by the agent": "File hasil slice tidak bisa dicetak oleh agen",
  "No spool of {material} {name} on {printer}": "Tidak ada spool {material} {name} di {printer}",
  "The agent prints only files the studio PC sliced from an STL or OBJ: a person prints this one":
    "Agen hanya mencetak file yang di-slice PC studio dari STL atau OBJ: orang yang mencetak file ini",
  "The design file this was sliced from is gone": "File desain sumber slice ini sudah tidak ada",
  "A newer design file is on the order: this sliced file is out of date": "Ada file desain yang lebih baru di pesanan: file hasil slice ini sudah usang",
  "The spool for filament {n} on {printer} is not the order's colour": "Spool untuk filamen {n} di {printer} bukan warna pesanan",

  // ---------- reasons: what the dispatcher does next (src/lib/printer/dispatch.ts) ----------
  "No spool of {material} {name} loaded": "Tidak ada spool {material} {name} yang terpasang",
  "Waiting for {printer}: {order} goes first": "Menunggu {printer}: {order} lebih dulu",
  "Waiting for a person to confirm the bed on {printer}": "Menunggu orang memastikan bed {printer} kosong",
  "The bed of {printer} holds a finished print: a person empties it": "Bed {printer} berisi cetakan yang sudah selesai: orang yang mengosongkannya",
  "Confirm the bed on {printer} again: the last check is over 2 h old": "Konfirmasi lagi bed {printer}: pengecekan terakhir lebih dari 2 jam lalu",
  "Agent prints are off: a person starts it": "Cetak oleh agen mati: orang yang memulainya",
  "Next: print on {printer}": "Berikutnya: cetak di {printer}",
  "Started on {printer}": "Dimulai di {printer}",
  "No sliced file for the A1 and no STL to slice": "Belum ada file hasil slice untuk A1 dan tidak ada STL untuk di-slice",
  "Pick one colour on the order: the agent slices in one colour": "Pilih satu warna di pesanan: agen men-slice dalam satu warna",
  "Slicing on the studio PC…": "Sedang di-slice di PC studio…",
  "The agent's slice failed: a person slices it on the order page": "Slice oleh agen gagal: orang men-slice-nya di halaman pesanan",
  "A person cancelled the agent's slice: a person slices it on the order page": "Orang membatalkan slice oleh agen: orang men-slice-nya di halaman pesanan",
  "The agent slices only an STL or OBJ: a person slices this order's file": "Agen hanya men-slice STL atau OBJ: orang yang men-slice file pesanan ini",
  "Waiting for the studio PC's slicer (is the bridge running?)": "Menunggu slicer di PC studio (apakah bridge berjalan?)",
  "Next: slice {file} in {material} {name}": "Berikutnya: slice {file} dengan {material} {name}",

  // ---------- refusals and errors (API, bridge, tasks) ----------
  "The agent cannot start this print": "Agen tidak bisa memulai cetakan ini",
  "Another print already used this bed confirmation or printer": "Cetakan lain sudah memakai konfirmasi bed atau printer ini",
  "Agent prints were turned off: nothing was sent.": "Cetak oleh agen dimatikan: tidak ada yang dikirim.",
  "A spool changed after the agent queued the print: nothing was sent. A person confirms the colours again.":
    "Ada spool yang berubah setelah agen mengantrekan cetakan: tidak ada yang dikirim. Orang mengonfirmasi warna lagi.",
  "The bed confirmation this agent print used is no longer valid: nothing was sent. A person confirms the bed again.":
    "Konfirmasi bed yang dipakai cetakan agen ini sudah tidak berlaku: tidak ada yang dikirim. Orang memastikan bed lagi.",
  "Say on: true or false": "Isi on: true atau false",
  "Agent prints are switched off on this server (KESUNI_AUTO_PRINT=off)": "Cetak oleh agen dimatikan di server ini (KESUNI_AUTO_PRINT=off)",
  "Runs must be a whole number from 0 to {n}": "Jumlah cetakan harus bilangan bulat dari 0 sampai {n}",
  "This bridge does not take agent prints (BRIDGE_AGENT_PRINTS is not on on the studio PC)":
    "Bridge ini tidak menerima cetakan agen (BRIDGE_AGENT_PRINTS belum on di PC studio)",
  "Load {material} {name} ({hex}) in an AMS: {order} waits for it.": "Pasang {material} {name} ({hex}) di AMS: {order} menunggunya.",
  "Agent print {id} did not start on {printer}: {error} Check the printer, then mark this task done and press Bed is empty.":
    "Cetakan agen {id} tidak mulai di {printer}: {error} Periksa printer, lalu tandai tugas ini selesai dan tekan Bed kosong.",
};

export default id;
