import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySnapshot, hmsUrl, stageOf, type PrinterSnapshot } from "@/lib/printer/bambu";
import { liveView, type LiveRows } from "@/lib/live";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import { LocaleProvider } from "@/i18n/client";
import type { Order, Printer } from "@/lib/types";
import type { Traction } from "@/lib/traction";
import type { PortalToken } from "@/lib/portal";
import { issueTexts } from "../machines/issue-texts";
import LiveStudio, { LIVE_TABS, liveTab, type LiveTab } from "./LiveStudio";

// The page body as the server renders it: what a judge sees, with no button, form or link into the operator pages.
const NOW = new Date("2026-10-16T05:00:00.000Z");
const RECENT = new Date(NOW.getTime() - 8000).toISOString();
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const snap = (over: Partial<PrinterSnapshot>): PrinterSnapshot => ({ ...emptySnapshot(RECENT), state: "IDLE", ...over });
const TABS: LiveTab[] = ["overview", "printers", "agent", "money", "token"];
/** The token research as the customer portal shapes it (src/lib/portal.ts portalToken). */
const TOKEN: PortalToken = {
  overall: "ISSUANCE BLOCKED", passed: 1, total: 2,
  gates: [
    { n: "01", id: "traction", title: "Real traction", status: "PASS", line: "Enough real orders." },
    { n: "02", id: "signoff", title: "Owner sign-off", status: "NOT YET", line: "Not given." },
  ],
};

const printers: Printer[] = [
  {
    id: "a1", name: "A1 Combo #1", lastSeen: RECENT, currentOrderId: "ORD-010",
    snapshot: snap({
      state: "RUNNING", percent: 62, layer: 80, totalLayers: 200, remainingMin: 42, stage: stageOf("RUNNING", [2, 0], 0), nozzleTemp: 220, nozzleTarget: 220,
      bedTemp: 65, bedTarget: 65, jobName: "lia_keychain.gcode.3mf",
      ams: { trays: [{ ams: 0, slot: 0, empty: false, type: "PLA", subBrand: "PLA Basic", infoIdx: null, color: "#FEC600", colors: ["#FEC600"], remainPct: null, bambu: true }], activeSlot: 0, externalActive: false, humidity: null, lite: true },
    }),
  },
  { id: "a1-2", name: "A1 Combo #2", lastSeen: RECENT, bedOccupiedBy: "ORD-011", snapshot: snap({ state: "FINISH" }) },
  {
    id: "a1-3", name: "A1 Combo #3", lastSeen: RECENT,
    snapshot: snap({ hms: [{ code: "HMS_0510_0400_0001_0044", severity: 1, url: hmsUrl("0510040000010044"), since: RECENT }] }),
  },
];
const orders: Order[] = [
  { id: "ORD-010", jobId: "J", product: "lia: keychain", quantity: 1, deadline: "2026-10-20", designVersion: "v1", mandateMicro: 1, status: "IN_PRODUCTION", label: "real", customerName: "Lia" },
  { id: "ORD-011", jobId: "J", product: "Test vase", quantity: 1, deadline: "2026-10-20", designVersion: "v1", mandateMicro: 1, status: "IN_PRODUCTION", label: "simulated" },
];
const usage = {
  rule: "Simulated orders, demo top-ups and internal transfers are not counted.", realCustomers: 0, realOrders: 1,
  arcTxs: { count: 1, verifiedOnArc: 1, mismatchOnArc: 0, notCheckedYet: 0, volume: { testnet: { micro: 100_000, usdc: "0.1" }, mainnet: { micro: 0, usdc: "0" } } },
  excluded: { simulatedOrders: 1, demoTopups: 0 },
} as unknown as Traction;
/** The same counts with no transfer on a real order. */
const noRealTransfer = { ...usage, arcTxs: { ...usage.arcTxs, count: 0, verifiedOnArc: 0, volume: { testnet: { micro: 0, usdc: "0" }, mainnet: { micro: 0, usdc: "0" } } } } as Traction;
const rows = (locale: Locale): LiveRows => ({
  printers, orders, usage, agentPrints: { on: false }, heartbeat: { at: RECENT, mode: "claude" }, network: { name: "Arc Testnet", isTestnet: true }, issueTexts: issueTexts(printers, locale), people: [],
  log: [
    { id: 1, orderId: "ORD-010", actor: "agent", tool: "heartbeat", input: {}, ok: true, output: { findings: [{ text: "ORD-010 is paid into escrow but has no printer yet." }] }, at: RECENT },
    { id: 2, orderId: "ORD-010", actor: "agent", tool: "price_by_weight", input: {}, ok: true, output: { unitPriceIdr: 1650 }, at: RECENT },
  ],
  escrows: [{
    orderId: "ORD-010", amountMicro: 100_000, escrowWalletId: "w", escrowAddress: "0xe", customerWalletId: "c", customerAddress: "0xc", state: "FUNDED",
    network: "ARC-TESTNET", label: "testnet", createdAt: RECENT,
    txs: [{ kind: "deposit", from: "0xc", to: "0xe", amountMicro: 100_000, idempotencyKey: "k", state: "COMPLETE", txHash: `0x${"cd34".repeat(16)}`, at: RECENT, verified: { ok: true, at: RECENT } }],
  }],
});
const page = (locale: Locale = "en", over: Partial<LiveRows> = {}, tab?: LiveTab, token: PortalToken | null = TOKEN) => renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <LiveStudio v={liveView({ ...rows(locale), ...over }, NOW, makeT(locale, ID), locale)} t={makeT(locale, ID)} locale={locale} seconds={15} tab={tab} token={token} />
  </LocaleProvider>,
);

describe("Live studio page", () => {
  it("opens on the Overview: what runs now, the orders, the Arc transfers and the agent today, in English", () => {
    const en = text(page());
    expect(en).toMatch(/Live Read only Arc Testnet · test USDC Open3DKesuni A real 3D-print studio in Padang, Indonesia\. An AI agent runs the order desk; people do the hands-on work\./);
    expect(en).toMatch(/Nothing on this page can move a printer or money\. Last Arc transfer: Deposit 0\.1 test USDC · Verified on Arc Overview Printers Agent Money on Arc Token research Updated 12:00:00 WIB /);
    expect(en).toMatch(/Running now .* Printers Printers online 3 \/ 3 Printing 1 Ready for a job 0 Parts to collect 1 /);
    expect(en).toMatch(/A1 Combo #1 ORD-010 real 62% Printing 42m left Done around 12:41 WIB A1 Combo #2 Holds a part to collect ORD-011 simulated /);
    expect(en).toMatch(/Orders .* All 2 In progress 2 Finished 0 real 1 simulated 1 .* Next deadline ORD-010 real in 4 d Tue 20 Oct /);
    // The headline is real orders only, with the rupiah next to the USDC; the tests apart.
    expect(en).toMatch(/Transactions on Arc .* Transfers on real orders 1 Verified on Arc 1 \/ 1 Volume 0\.1 test USDC ≈ Rp1\.650 Tests, not counted 0 transfers · 0 test USDC /);
    expect(en).toMatch(/Agent today .* Decisions today 1 Handed to a person 0 today Agent prints 0 not allowed Claude ran 0 times today\. No agent print yet: people started every print so far\./);
    expect(en).toMatch(/Only the studio's bridge talks to them, and it calls out to this site\. This page refreshes by itself every 15 s\. ?$/);
    // The other tabs' details stay on their tabs; the hero's old tiles are in the Overview only, once.
    expect(en).not.toMatch(/Nozzle|The agent at work|Latest transfers|Real customers/);
    expect(en.match(/Printers online/g)).toHaveLength(1);
    // No "agent check" (heartbeat) on the Overview: visitors do not know what it means.
    expect(en).not.toMatch(/Agent check|heartbeat/i);
  });

  it("each card links to its tab; the menu marks the open tab and Overview is plain /live", () => {
    const html = page();
    const tabs = [...html.matchAll(/<a([^>]*class="tab[^"]*"[^>]*)>/g)].map((m) => m[1]);
    expect(tabs.map((a) => /href="([^"]+)"/.exec(a)![1])).toEqual(["/live", "/live?tab=printers", "/live?tab=agent", "/live?tab=money", "/live?tab=token"]);
    expect(tabs.map((a) => /aria-current="page"/.test(a))).toEqual([true, false, false, false, false]);
    const more = [...html.matchAll(/class="live-ov-more" href="([^"]+)"|href="([^"]+)" class="live-ov-more"/g)].map((m) => m[1] ?? m[2]);
    expect(more).toEqual(["/live?tab=printers#live-tabs", "/live?tab=money#live-tabs", "/live?tab=money#live-tabs", "/live?tab=agent#live-tabs"]);
    const money = page("en", {}, "money");
    expect(/<a[^>]*aria-current="page"[^>]*>([^<]+)</.exec(money)![1]).toBe("Money on Arc");
  });

  it("each tab shows its details: the printers, the agent at work, the money on Arc", () => {
    const printersTab = text(page("en", {}, "printers"));
    expect(printersTab).toMatch(/Printing 62% .*A1 Combo #1 Online · Last report 8 s ago Doing now Printing 62% .*220 °C Nozzle target 220 °C/);
    // The printer cannot see its bed: while it prints, the bed is in use, not empty.
    expect(printersTab).toMatch(/AMS lite 1 PLA Yellow Order ORD-010 real Bed In use/);
    expect(printersTab).toMatch(/A1 Combo #3 .* Order None Bed Empty/);
    // The pill says the state only; online and the last report have their own line.
    expect(printersTab).toMatch(/Finished .*A1 Combo #2 Online · Last report 8 s ago/);
    // A part on the bed names its order there: no "Order: None" above it.
    expect(printersTab).toMatch(/A1 Combo #2 .* Remaining Bed Holds a part to collect ORD-011 simulated/);
    expect(printersTab).toMatch(/Printer error fatal The firmware of AMS lite does not match the printer/i);
    expect(printersTab).not.toMatch(/Running now|The agent at work|Latest transfers/);

    const agent = text(page("en", {}, "agent"));
    expect(agent).toMatch(/Agent prints off Code starts them, never Claude, and only after a person confirms the bed is empty\. So far: 0\./);
    expect(agent).toMatch(/Heartbeat noticed 1 problem 16 Oct, 11:59 WIB ORD-010 is paid into escrow but has no printer yet\. Operations Code ORD-010 real/);
    expect(agent).not.toMatch(/Running now|Nozzle|Latest transfers/);

    const money = text(page("en", {}, "money"));
    expect(money).toMatch(/Real customers 0 Real orders 1 Transfers on real orders 1 Of those, verified 1 \/ 1 Not counted: 1 simulated order · 0 test transfers/);
    expect(money).toMatch(/Deposit 0\.1 test USDC ≈ Rp1\.650 16 Oct, 11:59 WIB ORD-010 real Verified on Arc 0xcd34cd…cd34/);
    expect(money).not.toMatch(/Running now|Nozzle|The agent at work/);
    // How the money works, in view (not only behind an ⓘ), with who holds the wallets said plainly.
    expect(money).toMatch(/How the money works: Circle \+ Arc Two Circle wallets per order: the customer's and the escrow\. .*Each transfer gets an idempotency key, saved before Circle is called\. .*Circle's Gas Station pays the gas\. .*ERC-4337.*Every transfer is re-checked on Arc\. .*Payment is in rupiah, outside the app; the deposits are test USDC, not customer money\. .*Kesuni holds these wallets\. Release and refund are guarded by the policy engine in our code, not by a smart contract\./);

    const token = text(page("en", {}, "token"));
    expect(token).toMatch(/Token research ISSUANCE BLOCKED Research only\. No token exists and nothing is sold\. .*1 of 2 checks passed 01 Real traction .*PASS 02 Owner sign-off .*NOT YET/);
    expect(token).not.toMatch(/Running now|Nozzle|The agent at work|Latest transfers/);
    expect(text(page("en", {}, "token", null))).toMatch(/The token research could not be read right now\./);
    for (const tab of TABS) expect(text(page("en", {}, tab)).match(/every 15 s/g), tab).toHaveLength(1);
  });

  it("has no controls, no form, no camera and no link into the operator pages; no product title or file name, on any tab", () => {
    for (const locale of ["en", "id"] as const) {
      for (const tab of TABS) {
        const html = page(locale, {}, tab);
        expect(html, `${locale} ${tab}`).not.toMatch(/<button|<form|<input|<select|<textarea|<img/);
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        expect(hrefs.length).toBeGreaterThan(0);
        for (const h of hrefs) {
          expect(h, `${locale} ${tab}: ${h}`).toMatch(/^(\/live(\?tab=(printers|agent|money|token)(#live-tabs)?)?|https:\/\/(e\.bambulab\.com|explorer\.testnet\.arc\.io)\/.*)$/);
        }
        // Lia: Indonesian "keahlian" (skill) holds the letters.
        expect(html, `${locale} ${tab}`).not.toMatch(/keychain|lia_|Lia|Test vase|camera/i);
      }
    }
  });

  it("with no printer online it does not claim to be live; a simulated order's transfer is marked as a test", () => {
    const old = new Date(NOW.getTime() - 20 * 60_000).toISOString();
    const over = {
      printers: printers.map((p) => ({ ...p, lastSeen: old })), escrows: rows("en").escrows.map((e) => ({ ...e, orderId: "ORD-011" })), usage: noRealTransfer,
    };
    const en = text(page("en", over));
    expect(en).toMatch(/^ ?Bridge offline · last report 20 min ago Read only/);
    expect(en).not.toMatch(/ Live /);
    // The last known reading of a print, without a finish time.
    expect(en).toMatch(/Printers online 0 \/ 3 Printing 0 Ready for a job 0 Parts to collect 1 A1 Combo #1 ORD-010 real 62% Printing Last known reading 42m left A1 Combo #2/);
    expect(en).not.toMatch(/Done around/);
    expect(en).toMatch(/Transfers on real orders 0 Verified on Arc 0 \/ 0 Volume 0 test USDC Tests, not counted 1 transfer · 0\.1 test USDC ≈ Rp1\.650 · 1 verified/);
    const money = text(page("en", over, "money"));
    expect(money).toMatch(/Not counted: 1 simulated order · 1 test transfer .*Test transfers are real Arc Testnet transactions too, but they are not counted above\. Deposit 0\.1 test USDC .*ORD-011 simulated/);
  });

  it("no printer printing: says so plainly, with the printers online, ready and holding a part", () => {
    const idle = printers.map((p) => (p.id === "a1" ? { ...p, currentOrderId: undefined, snapshot: snap({ state: "IDLE" }) } : p));
    const en = text(page("en", { printers: idle }));
    expect(en).toMatch(/Printers online 3 \/ 3 Printing 0 Ready for a job 1 Parts to collect 1 No printer is printing right now\. A1 Combo #2 Holds a part to collect ORD-011 simulated/);
    expect(text(page("id", { printers: idle }))).toMatch(/Printer online 3 \/ 3 Mencetak 0 Siap dipakai 1 Hasil perlu diambil 1 Saat ini tidak ada printer yang mencetak\./);
  });

  it("in Indonesian", () => {
    const id = text(page("id"));
    expect(id).toMatch(/Live Hanya baca Arc Testnet · USDC uji Open3DKesuni Studio cetak 3D sungguhan di Padang, Indonesia\. Agen AI mengurus meja pesanan/);
    expect(id).toMatch(/Halaman ini tidak bisa menggerakkan printer atau uang\. Transfer Arc terakhir: Setoran 0\.1 USDC uji · Terverifikasi di Arc Ringkasan Printer Agen Uang di Arc Riset token Diperbarui 12\.00\.00 WIB /);
    expect(id).toMatch(/Sedang berjalan .* Printer online 3 \/ 3 Mencetak 1 Siap dipakai 0 Hasil perlu diambil 1 A1 Combo #1 ORD-010 nyata 62% Mencetak sisa 42m Selesai sekitar 12\.41 WIB/);
    expect(id).toMatch(/Pesanan .* Semua 2 Berjalan 2 Selesai 0 nyata 1 simulasi 1 .* Tenggat berikutnya ORD-010 nyata 4 hari lagi Sel 20 Okt/);
    expect(id).toMatch(/Transaksi di Arc .* Transfer pesanan nyata 1 Terverifikasi di Arc 1 \/ 1 Volume 0\.1 USDC uji ≈ Rp1\.650 Uji coba, tidak dihitung 0 transfer · 0 USDC uji/);
    expect(id).toMatch(/Agen hari ini .* Keputusan hari ini 1 Diserahkan ke orang 0 hari ini Cetak oleh agen 0 tidak diizinkan Claude berjalan 0 kali hari ini\./);

    const printersTab = text(page("id", {}, "printers"));
    expect(printersTab).toMatch(/Error printer fatal Firmware AMS lite tidak sesuai dengan printer/);
    expect(printersTab).toMatch(/Ada hasil yang perlu diambil ORD-011 simulasi/);
    expect(text(page("id", {}, "agent"))).toMatch(/Agen sedang bekerja/);
    const money = text(page("id", {}, "money"));
    expect(money).toMatch(/Uang di Arc/);
    expect(money).toMatch(/Transfer pesanan nyata 1 Yang terverifikasi 1 \/ 1 Tidak dihitung: 1 pesanan simulasi · 0 transfer uji/);
    expect(money).toMatch(/Cara kerja uangnya: Circle \+ Arc Dua dompet Circle per pesanan: milik pelanggan dan escrow\./);
    expect(money).toMatch(/Kesuni yang memegang dompet-dompet ini\. Pencairan dan pengembalian dijaga oleh policy engine di kode kami, bukan oleh smart contract\./);
    expect(text(page("id", {}, "printers"))).toMatch(/Pesanan ORD-010 nyata Bed cetak Sedang dipakai/);
  });
});

describe("Live studio menu", () => {
  it("Overview first; ?tab= opens a known tab, anything else the Overview", () => {
    expect(LIVE_TABS.map((x) => x.id)).toEqual(["overview", "printers", "agent", "money", "token"]);
    expect(liveTab("token")).toBe("token");
    expect(liveTab(undefined)).toBe("overview");
    expect(liveTab("")).toBe("overview");
    expect(liveTab("printers")).toBe("printers");
    expect(liveTab("agent")).toBe("agent");
    expect(liveTab("money")).toBe("money");
    expect(liveTab("PRINTERS")).toBe("overview");
    expect(liveTab("machines")).toBe("overview");
    expect(liveTab("<script>")).toBe("overview");
    expect(liveTab(["money", "agent"])).toBe("money");
    expect(liveTab([])).toBe("overview");
  });
});
