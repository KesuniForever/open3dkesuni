import { describe, expect, it } from "vitest";
import { readEvents, readSnapshot } from "./report-input";
import { detectEvents, mergeReport } from "./bambu";

const AT = "2026-10-15T07:30:00.000Z";
const LIVE = {
  print: {
    gcode_state: "IDLE", mc_percent: 0, print_error: 0, nozzle_temper: 28, bed_temper: 28, stg: [], stg_cur: 255, spd_lvl: 2, spd_mag: 100,
    wifi_signal: "-72dBm", sdcard: true, home_flag: 847201688, nozzle_diameter: "0.4", nozzle_type: "stainless_steel",
    lights_report: [{ node: "chamber_light", mode: "off" }], hms: [{ attr: 84935680, code: 65604, timestamp: 1792049055 }],
    ipcam: { ipcam_dev: "1", ipcam_record: "enable", timelapse: "disable" },
    ams: { ams: [{ id: "0", info: "1002", humidity: "5", tray: [{ id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic", remain: 100 }, { id: "1" }] }], tray_now: "255" },
    vt_tray: { id: "254", tray_type: "PETG", tray_color: "FFFFFFFF" },
  },
};

describe("what the bridge may send", () => {
  it("a full snapshot from the new bridge survives the trip unchanged (JSON in, same snapshot out)", () => {
    const snap = mergeReport(undefined, LIVE, AT)!;
    expect(readSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it("an older bridge's short snapshot is still accepted, without the new fields", () => {
    const old = { state: "RUNNING", percent: 10, remainingMin: 50, layer: 3, totalLayers: 100, jobName: "x", errorCode: 0, nozzleTemp: 220, bedTemp: 60, at: AT };
    expect(readSnapshot(old)).toEqual(old);
    expect(readSnapshot({ state: "RUNNING", percent: 10, at: AT })).toMatchObject({ remainingMin: null, jobName: null, errorCode: 0 });
  });

  it("drops anything of the wrong shape and caps sizes", () => {
    expect(readSnapshot({ state: "EXPLODING", percent: 1, at: AT })).toBeNull();
    expect(readSnapshot({ state: "IDLE", at: AT })).toBeNull();
    const s = readSnapshot({
      state: "IDLE", percent: 250, at: AT, jobName: "j".repeat(500), speedLevel: 9, light: "disco",
      hms: [{ code: "<script>", severity: 1 }, { code: "HMS_0510_0400_0001_0044", severity: 1, url: "https://evil.example/x" }],
      ams: { trays: [{ ams: 0, slot: 7, type: "PLA" }, { ams: 0, slot: 1, type: "PLA", color: "red", colors: ["#FFFFFF", 5] }] },
      firmware: { ota: "01.08.01.00", sn: "SECRET" },
    })!;
    expect(s.percent).toBe(100);
    expect(s.jobName).toHaveLength(120);
    expect(s.speedLevel).toBeNull();
    expect(s.light).toBeNull();
    expect(s.hms).toEqual([{ code: "HMS_0510_0400_0001_0044", severity: 1, url: "https://wiki.bambulab.com/en/hms/home", since: null }]);
    expect(s.ams!.trays).toEqual([{ ams: 0, slot: 1, empty: false, type: "PLA", subBrand: null, infoIdx: null, color: null, colors: ["#FFFFFF"], remainPct: null, bambu: false }]);
    expect(JSON.stringify(s)).not.toContain("SECRET");
  });

  it("accepts the new error events and refuses unknown kinds", () => {
    const prev = mergeReport(undefined, { print: { gcode_state: "IDLE", hms: [] } }, AT)!;
    const next = mergeReport(prev, LIVE, AT)!;
    const events = JSON.parse(JSON.stringify(detectEvents(prev, next)));
    expect(readEvents(events)).toEqual(detectEvents(prev, next).map((e) => ({ ...e, errorCode: undefined })));
    expect(readEvents([{ kind: "explode", percent: 0, at: AT }])).toBeNull();
    expect(readEvents("nope")).toBeNull();
  });
});
