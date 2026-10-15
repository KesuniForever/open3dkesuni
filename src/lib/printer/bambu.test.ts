import { describe, expect, it } from "vitest";
import {
  activeIssues, detectEvents, errorCodeText, fanPct, hmsCode, mergeReport, stageOf, trayHex, type PrinterSnapshot,
} from "./bambu";

const at = (s: number) => new Date(Date.UTC(2026, 9, 5, 10, 0, s)).toISOString();

/** Feed a sequence of MQTT messages, collect every event. */
function run(messages: unknown[]) {
  let snap: PrinterSnapshot | undefined;
  const events = [];
  for (const [i, m] of messages.entries()) {
    const next = mergeReport(snap, m, at(i));
    if (!next) continue;
    events.push(...detectEvents(snap, next));
    snap = next;
  }
  return { snap, events };
}

const full = (over: Record<string, unknown> = {}) => ({
  print: { command: "push_status", gcode_state: "IDLE", mc_percent: 0, mc_remaining_time: 0, layer_num: 0,
    total_layer_num: 0, subtask_name: "", print_error: 0, nozzle_temper: 25, bed_temper: 25, ...over },
});

// Printer #3's full report after pushall (15 Oct 2026, read-only probe), trimmed: idle, one fatal HMS (AMS lite
// firmware does not match), four generic spools, no external spool.
const PRINTER3 = {
  print: {
    nozzle_temper: 28.4375, nozzle_target_temper: 0, bed_temper: 28.71875, bed_target_temper: 0, heatbreak_fan_speed: "0",
    cooling_fan_speed: "0", mc_percent: 0, mc_remaining_time: 0, spd_mag: 100, spd_lvl: 2, print_error: 0, wifi_signal: "-72dBm",
    gcode_state: "IDLE", gcode_file_prepare_percent: "0", subtask_name: "", gcode_file: "", stg: [], stg_cur: 255, print_type: "idle",
    home_flag: 847201688, sdcard: true, layer_num: 0, total_layer_num: 0, nozzle_diameter: "0.4", nozzle_type: "stainless_steel",
    ipcam: { ipcam_dev: "1", ipcam_record: "enable", timelapse: "disable", resolution: "1080p", tutk_server: "disable", mode_bits: 3 },
    hms: [{ attr: 84935680, code: 65604, action: 0, timestamp: 1792049055 }],
    lights_report: [{ node: "chamber_light", mode: "off" }], command: "push_status", msg: 0, sequence_id: "7903",
    ams: {
      ams: [{ id: "0", humidity: "5", info: "1002", tray: [
        { id: "0", state: 3, remain: 100, tray_info_idx: "GFL03", tray_type: "PLA", tray_sub_brands: "", tray_color: "000000FF", cols: ["000000FF"] },
        { id: "1", state: 3, remain: 100, tray_info_idx: "GFG99", tray_type: "PETG", tray_sub_brands: "", tray_color: "0085D5FF", cols: ["0085D5FF"] },
        { id: "2", state: 3, remain: 100, tray_info_idx: "GFL99", tray_type: "PLA", tray_sub_brands: "", tray_color: "FF6910FF", cols: ["FF6910FF"] },
        { id: "3", state: 3, remain: 100, tray_info_idx: "GFG99", tray_type: "PETG", tray_sub_brands: "", tray_color: "FFFFFFFF", cols: ["FFFFFFFF"] },
      ] }],
      ams_exist_bits: "1", tray_exist_bits: "f", tray_is_bbl_bits: "f", tray_now: "255",
    },
    vt_tray: { id: "254", tray_type: "", tray_color: "00000000" },
  },
};

// Printer #1's AMS: two Bambu PLA Basic spools (RFID), slot 2 empty, a generic red; PETG white on the external spool.
const PRINTER1_AMS = {
  ams: { ams: [{ id: "0", humidity: "5", info: "1002", tray: [
    { id: "0", state: 3, remain: 100, tray_info_idx: "GFA00", tray_type: "PLA", tray_sub_brands: "PLA Basic", tray_color: "FEC600FF", cols: ["FEC600FF"] },
    { id: "1" },
    { id: "2", state: 3, remain: 100, tray_info_idx: "GFL99", tray_type: "PLA", tray_sub_brands: "", tray_color: "C52C18FF", cols: ["C52C18FF"] },
    { id: "3", state: 3, remain: 100, tray_info_idx: "GFA00", tray_type: "PLA", tray_sub_brands: "PLA Basic", tray_color: "C12E1FFF", cols: ["C12E1FFF"] },
  ] }], tray_exist_bits: "d", tray_is_bbl_bits: "d", tray_now: "255" },
  vt_tray: { id: "254", tray_type: "PETG", tray_color: "FFFFFFFF" },
};

describe("mergeReport", () => {
  it("merges partial A1 updates into the full snapshot", () => {
    const { snap } = run([
      full({ gcode_state: "RUNNING", mc_percent: 10, subtask_name: "clicker_aini", total_layer_num: 120 }),
      { print: { mc_percent: 40, layer_num: 48 } }, // partial: no gcode_state, no name
    ]);
    expect(snap).toMatchObject({ state: "RUNNING", percent: 40, layer: 48, totalLayers: 120, jobName: "clicker_aini" });
  });

  it("ignores messages that are not status reports, including replies to commands", () => {
    expect(mergeReport(undefined, { info: { command: "get_version" } }, at(0))).toBeUndefined();
    expect(mergeReport(undefined, null, at(0))).toBeUndefined();
    const prev = mergeReport(undefined, full({ gcode_state: "IDLE" }), at(0));
    // The project_file reply echoes subtask_name before anything prints: it must not become the job name.
    expect(mergeReport(prev, { print: { command: "project_file", subtask_name: "ORD-012 Pill", result: "success", sequence_id: "50006" } }, at(1)))
      .toBeUndefined();
  });

  it("reads everything a live A1 reports (printer #3, 15 Oct 2026)", () => {
    const s = mergeReport(undefined, PRINTER3, at(0))!;
    expect(s).toMatchObject({
      state: "IDLE", stage: null, stageCur: 255, nozzleTarget: 0, bedTarget: 0, partFanPct: 0, hotendFanPct: 0, speedLevel: 2,
      speedPct: 100, light: "off", nozzle: { diameter: "0.4", type: "stainless_steel" }, wifiDbm: -72, sdcard: true, sdAbnormal: false,
      fileName: null, printType: "idle", printError: null, externalSpool: null,
      camera: { available: true, recording: true, timelapse: false },
    });
    expect(s.hms).toEqual([{
      code: "HMS_0510_0400_0001_0044", severity: 1, since: "2026-10-15T07:24:15.000Z",
      url: "https://e.bambulab.com/index.php?e=0510040000010044&d=039&s=device_hms&lang=en",
    }]);
    // AMS lite: no humidity sensor, and every spool reports 100 % left, so neither is shown.
    expect(s.ams).toMatchObject({ lite: true, humidity: null, activeSlot: null, externalActive: false });
    expect(s.ams!.trays.map((t) => [t.slot, t.type, t.color, t.remainPct, t.empty, t.bambu])).toEqual([
      [0, "PLA", "#000000", null, false, false], [1, "PETG", "#0085D5", null, false, false],
      [2, "PLA", "#FF6910", null, false, false], [3, "PETG", "#FFFFFF", null, false, false],
    ]);
  });

  it("an empty slot is {id} alone; RFID spools have a sub-brand; the external spool keeps its own colour", () => {
    const s = mergeReport(undefined, { print: { gcode_state: "IDLE", ...PRINTER1_AMS } }, at(0))!;
    expect(s.ams!.trays.map((t) => [t.slot, t.empty, t.type, t.subBrand, t.infoIdx, t.color, t.bambu])).toEqual([
      [0, false, "PLA", "PLA Basic", "GFA00", "#FEC600", true],
      [1, true, null, null, null, null, false],
      [2, false, "PLA", null, "GFL99", "#C52C18", false],
      [3, false, "PLA", "PLA Basic", "GFA00", "#C12E1F", true],
    ]);
    expect(s.externalSpool).toEqual({ type: "PETG", color: "#FFFFFF" });
  });

  it("merges tray deltas: a spool taken out empties the slot, a delta keeps the fields it does not name", () => {
    let s = mergeReport(undefined, { print: { gcode_state: "IDLE", ...PRINTER1_AMS } }, at(0))!;
    s = mergeReport(s, { print: { ams: { ams: [{ id: "0", tray: [{ id: "0" }, { id: "2", tray_color: "00FF00FF" }] }], tray_now: "3" } } }, at(1))!;
    expect(s.ams!.trays[0]).toMatchObject({ empty: true, type: null });
    expect(s.ams!.trays[2]).toMatchObject({ empty: false, type: "PLA", color: "#00FF00", infoIdx: "GFL99" });
    expect(s.ams!.activeSlot).toBe(3);
    s = mergeReport(s, { print: { ams: { tray_now: "254" } } }, at(2))!;
    expect(s.ams).toMatchObject({ activeSlot: null, externalActive: true });
    // A delta without ams keeps the AMS as it was.
    expect(mergeReport(s, { print: { wifi_signal: "-60dBm" } }, at(3))!.ams).toEqual(s.ams);
  });

  it("keeps the last known values when a delta omits them, and replaces hms and lights whole", () => {
    let s = mergeReport(undefined, PRINTER3, at(0))!;
    s = mergeReport(s, { print: { wifi_signal: "-66dBm", command: "push_status", msg: 1, sequence_id: "7769" } }, at(1))!;
    expect(s).toMatchObject({ wifiDbm: -66, speedLevel: 2, light: "off", sdcard: true, nozzle: { diameter: "0.4" } });
    expect(s.hms).toHaveLength(1);
    s = mergeReport(s, { print: { hms: [], lights_report: [{ node: "chamber_light", mode: "on" }] } }, at(2))!;
    expect(s.hms).toEqual([]);
    expect(s.light).toBe("on");
  });

  it("takes the firmware from the get_version reply, never module serials", () => {
    const reply = { info: { command: "get_version", sequence_id: "0", result: "success", module: [
      { name: "ota", sw_ver: "01.08.01.00", hw_ver: "OTA", sn: "SECRET-1", product_name: "Bambu Lab A1" },
      { name: "esp32", sw_ver: "01.16.33.15", hw_ver: "AP05", sn: "SECRET-2" },
      { name: "ams_f1/0", sw_ver: "00.00.07.93", hw_ver: "AMS_F102", sn: "SECRET-3", product_name: "AMS Lite" },
    ] } };
    const prev = mergeReport(undefined, PRINTER3, at(0))!;
    const s = mergeReport(prev, reply, at(1))!;
    expect(s.firmware).toEqual({ product: "Bambu Lab A1", ota: "01.08.01.00", ams: "00.00.07.93" });
    expect(s.state).toBe("IDLE");
    expect(JSON.stringify(s)).not.toContain("SECRET");
  });

  it("shows a stage only while a job is on the printer", () => {
    expect(stageOf("IDLE", [], 0)).toBeNull();
    expect(stageOf("IDLE", [2, 13], 255)).toBeNull();
    expect(stageOf("PREPARE", [], 0)).toEqual({ code: -1, key: "Preparing", needsPerson: false });
    expect(stageOf("PREPARE", [2, 13, 14, 1], 13)).toEqual({ code: 13, key: "Homing toolhead", needsPerson: false });
    expect(stageOf("RUNNING", [2, 13, 0], 0)).toEqual({ code: 0, key: "Printing", needsPerson: false });
    expect(stageOf("RUNNING", [2, 99], 99)).toEqual({ code: 99, key: "Working (stage {n})", needsPerson: false });
    expect(stageOf("PAUSE", [0, 6], 6)).toEqual({ code: 6, key: "Paused (filament ran out)", needsPerson: true });
    expect(stageOf("PAUSE", [0, 16], 16)).toEqual({ code: 16, key: "Paused by the user", needsPerson: true });
    expect(stageOf("PAUSE", [0], 0, 0x07008011)).toEqual({ code: 0, key: "Paused", needsPerson: true });
    const s = run([full({ gcode_state: "PREPARE", stg: [2, 13, 14], stg_cur: 2 }), { print: { stg_cur: 14 } }]).snap!;
    expect(s.stage).toEqual({ code: 14, key: "Cleaning nozzle tip", needsPerson: false });
  });

  it("decodes fans, colours and HMS codes the way Bambu Studio does", () => {
    expect([0, 1, 7, 10, 15].map(fanPct)).toEqual([0, 0, 40, 60, 100]);
    expect(trayHex("FEC600FF")).toBe("#FEC600");
    expect(trayHex("00000000")).toBeNull();
    expect(trayHex("nonsense")).toBeNull();
    expect(hmsCode(84935680, 65604)).toEqual({ code: "HMS_0510_0400_0001_0044", code16: "0510040000010044", severity: 1 });
  });
});

describe("detectEvents", () => {
  it("start, progress milestones, finish", () => {
    const { events } = run([
      full(),
      { print: { gcode_state: "PREPARE", subtask_name: "clicker_aini" } },
      { print: { gcode_state: "RUNNING", mc_percent: 5 } },
      { print: { mc_percent: 30 } },
      { print: { mc_percent: 80 } }, // jumps over 50 and 75
      { print: { gcode_state: "FINISH", mc_percent: 100 } },
    ]);
    expect(events.map((e) => e.kind === "progress" ? `progress ${e.percent}` : e.kind)).toEqual([
      "started", "progress 25", "progress 50", "progress 75", "finished",
    ]);
  });

  it("pause with an error needs an operator and raises the error; resuming clears it", () => {
    const { events } = run([
      full({ gcode_state: "RUNNING", mc_percent: 62, subtask_name: "clicker_aini" }),
      { print: { gcode_state: "PAUSE", print_error: 0x07008011 } },
      { print: { gcode_state: "RUNNING", print_error: 0 } },
    ]);
    expect(events.map((e) => e.kind)).toEqual(["needs_operator", "error", "resumed", "error_cleared"]);
    expect(events[0]).toMatchObject({ percent: 62, errorCode: 0x07008011, jobName: "clicker_aini" });
    expect(events[1].issue).toEqual({ kind: "print_error", code: "0700-8011", severity: null, url: "https://wiki.bambulab.com/en/hms/home" });
  });

  it("reports a failed print; a cancel by a person is not an error", () => {
    const { events } = run([full({ gcode_state: "RUNNING", mc_percent: 20 }), { print: { gcode_state: "FAILED", print_error: 0x0300400c } }]);
    expect(events.map((e) => e.kind)).toEqual(["failed"]);
  });

  it("does not invent state events from the first report after connecting", () => {
    expect(run([full({ gcode_state: "FINISH", mc_percent: 100 })]).events).toEqual([]);
  });

  it("raises a fault the printer already shows when it connects, once, and clears it when it goes", () => {
    const { events, snap } = run([PRINTER3, { print: { wifi_signal: "-70dBm" } }, { print: { hms: [] } }]);
    expect(events.map((e) => [e.kind, e.issue?.code])).toEqual([
      ["error", "HMS_0510_0400_0001_0044"], ["error_cleared", "HMS_0510_0400_0001_0044"],
    ]);
    expect(activeIssues(snap!)).toEqual([]);
  });

  it("info messages are not faults, and a snapshot without hms cannot clear one", () => {
    const info = { attr: 0x05000200, code: 0x00040001 }; // severity 4
    expect(run([full({ hms: [info] })]).events).toEqual([]);
    const withHms = mergeReport(undefined, PRINTER3, at(0))!;
    const { hms: _gone, ...older } = withHms;
    void _gone;
    expect(detectEvents(withHms, { ...older, at: at(1) })).toEqual([]);
  });
});

it("formats error codes like the Bambu wiki", () => {
  expect(errorCodeText(0x07008011)).toBe("0700-8011");
});
