import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildMqttPayload, canStartPrint, commandReasons, isPersonName, NOT_A_FAULT_PRINT_ERRORS, parseReply, resumeNeedsFix, sdFileName, SD_FILE_NAME,
  subtaskName, type StartCheck,
} from "./control";
import { BENIGN_PRINT_ERRORS, emptySnapshot, INTERNAL_PRINT_ERRORS, type AmsTray, type PrinterSnapshot } from "./bambu";
import errorTable from "./bambu-errors.json";
import type { Printer, ThreeMfInfo } from "../types";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const tray = (slot: number, type: string | null, color: string | null): AmsTray => ({
  ams: 0, slot, empty: !type, type, subBrand: null, infoIdx: null, color, colors: color ? [color] : [], remainPct: null, bambu: false,
});
const snap = (over: Partial<PrinterSnapshot> = {}): PrinterSnapshot => ({
  ...emptySnapshot(new Date(NOW).toISOString()), state: "IDLE", hms: [], sdcard: true, sdAbnormal: false,
  nozzle: { diameter: "0.4", type: "stainless_steel" },
  ams: { trays: [tray(0, "PLA", "#FEC600"), tray(1, null, null), tray(2, "PLA", "#C52C18"), tray(3, "PETG", "#FFFFFF")], activeSlot: null, externalActive: false, humidity: null, lite: true },
  externalSpool: { type: "PETG", color: "#FFFFFF" },
  ...over,
});
const printer = (over: Partial<Printer> = {}, s: Partial<PrinterSnapshot> = {}): Printer =>
  ({ id: "a1", name: "A1 Combo #1", lastSeen: new Date(NOW - 5_000).toISOString(), snapshot: snap(s), ...over });
const INFO: ThreeMfInfo = {
  sliced: true, printerModel: "Bambu Lab A1", printerModelId: "N2S", nozzle: "0.4",
  projectFilaments: [{ type: "PLA", color: "#FCE300" }, { type: "PLA", color: "#C52C18" }],
  plates: [{ index: 1, predictionSec: 1644, weightG: 9.82, nozzle: "0.4", filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 9.82 }] }],
};
const job = (over: Partial<StartCheck> = {}): StartCheck => ({
  info: INFO, plate: 1, amsMapping: [0, -1], options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true },
  bedEmptyConfirmed: true, personPresent: true, by: "Khelda", orderId: "ORD-012", ...over,
});

describe("controls a person may send", () => {
  it("each control only in the printer state where it makes sense", () => {
    const at = (state: PrinterSnapshot["state"]) => printer({}, { state });
    expect(commandReasons(at("RUNNING"), "pause", {}, NOW)).toEqual([]);
    expect(commandReasons(at("IDLE"), "pause", {}, NOW)).toEqual(["Pause works only while the printer is printing or preparing"]);
    expect(commandReasons(at("PAUSE"), "resume", {}, NOW)).toEqual([]);
    expect(commandReasons(at("RUNNING"), "resume", {}, NOW)).toEqual(["Resume works only while the printer is paused"]);
    expect(commandReasons(at("PAUSE"), "stop", {}, NOW)).toEqual([]);
    expect(commandReasons(at("FINISH"), "stop", {}, NOW)).toEqual(["Stop works only while a print is on the printer"]);
    expect(commandReasons(at("RUNNING"), "speed", { level: 3 }, NOW)).toEqual([]);
    expect(commandReasons(at("RUNNING"), "speed", { level: 5 }, NOW)).toEqual(["Speed level must be 1 (silent), 2 (standard), 3 (sport) or 4 (ludicrous)"]);
    expect(commandReasons(at("IDLE"), "speed", { level: 2 }, NOW)).toEqual(["The speed can only change while the printer is printing"]);
    expect(commandReasons(at("IDLE"), "light", { on: true }, NOW)).toEqual([]);
    expect(commandReasons(at("IDLE"), "light", {}, NOW)).toEqual(["Say whether the light goes on or off"]);
    expect(commandReasons(printer({ lastSeen: new Date(NOW - 5 * 60_000).toISOString() }), "light", { on: true }, NOW))
      .toEqual(["The printer is offline (no report in the last 2 min)"]);
    expect(commandReasons(at("IDLE"), "gcode_line" as never, {}, NOW)).toEqual(["Unknown printer command"]);
  });

  it("resuming after a fault pause needs the person's \"I fixed the cause\", also when the request skips the page", () => {
    const fixIt = "The printer paused because of a fault: fix it, then tick \"I fixed the cause\"";
    const paused = (s: Partial<PrinterSnapshot>) => printer({}, { state: "PAUSE", ...s });
    // A person's pause (stage 16, 0300-8001): no box to tick.
    const mine = paused({ stage: { code: 16, key: "Paused by the user", needsPerson: true }, errorCode: 0x03008001 });
    expect(resumeNeedsFix(mine.snapshot)).toBe(false);
    expect(commandReasons(mine, "resume", {}, NOW)).toEqual([]);
    // Front cover off, a clog, filament out, a serious HMS: the box must be ticked.
    for (const s of [
      { stage: { code: 17, key: "Pause (front cover fall off)", needsPerson: true } },
      { stage: { code: -1, key: "Paused", needsPerson: true }, errorCode: 0x07008011 },
      { hms: [{ code: "HMS_0300_0100_0002_0001", severity: 2, url: "", since: null }] },
    ] as Partial<PrinterSnapshot>[]) {
      expect(resumeNeedsFix(paused(s).snapshot)).toBe(true);
      expect(commandReasons(paused(s), "resume", {}, NOW)).toEqual([fixIt]);
      expect(commandReasons(paused(s), "resume", { fixed: true }, NOW)).toEqual([]);
    }
  });

  it("needs a person's name, never the Chief's", () => {
    for (const name of ["Khelda", "Felia", "Bang Agung"]) expect(isPersonName(name)).toBe(true);
    for (const name of ["", "  ", "agent", "Chief", "chief kesuni officer", "Claude", "heartbeat", "system", "bridge", 42, undefined]) {
      expect(isPersonName(name), String(name)).toBe(false);
    }
  });
});

describe("canStartPrint", () => {
  it("starts when everything is right", () => {
    expect(canStartPrint(printer(), job(), NOW)).toEqual({ ok: true, reasons: [], warnings: [] });
    expect(canStartPrint(printer({}, { state: "FINISH" }), job(), NOW).ok).toBe(true);
  });

  it("the printer never checks the bed, the person or who pressed: we do", () => {
    const r = canStartPrint(printer(), job({ bedEmptyConfirmed: false, personPresent: false, by: "agent" }), NOW);
    expect(r.reasons).toEqual([
      "A person's name is required", "A person must be at the printer when it starts", "A person must confirm the bed is empty and clean",
    ]);
  });

  it("refuses a busy, stale, faulty or SD-less printer", () => {
    const reasons = (p: Printer, j = job()) => canStartPrint(p, j, NOW).reasons;
    expect(reasons(printer({}, { state: "RUNNING" }))).toEqual(["The printer is printing: it must be idle or finished"]);
    expect(reasons(printer({}, { state: "PAUSE" }))).toEqual(["The printer is paused: it must be idle or finished"]);
    expect(reasons(printer({ lastSeen: new Date(NOW - 90_000).toISOString() }))).toEqual(["The printer has not reported in the last minute (is the bridge running?)"]);
    expect(reasons(printer({ currentOrderId: "ORD-009" }))).toEqual(["The printer is linked to ORD-009"]);
    expect(reasons(printer(), job({ jobInFlight: "PJ-3-x" }))).toEqual(["Another print job (PJ-3-x) on this printer has not started yet"]);
    const fatal = { code: "HMS_0510_0400_0001_0044", severity: 1, url: "u", since: null };
    expect(reasons(printer({}, { hms: [fatal] }))).toEqual(["Printer error HMS_0510_0400_0001_0044: fix it before printing"]);
    expect(reasons(printer({}, { errorCode: 0x07008011 }))).toEqual(["Printer error 0700-8011: fix it before printing"]);
    expect(reasons(printer({}, { errorCode: 0x0300400c }))).toEqual([]); // a person's cancel is not a fault
    expect(reasons(printer({}, { sdcard: false }))).toEqual(["No microSD card in the printer (printing needs one)"]);
    expect(reasons(printer({}, { sdcard: undefined }))).toEqual(["The bridge does not report the SD card yet: update and restart the bridge"]);
    expect(reasons(printer({}, { sdAbnormal: true }))).toEqual(["The printer reports a problem with the SD card"]);
  });

  it("a common HMS is a warning the person must tick", () => {
    const warn = { code: "HMS_0300_0D00_0003_0001", severity: 3, url: "u", since: null };
    const r = canStartPrint(printer({}, { hms: [warn] }), job(), NOW);
    expect(r.warnings).toEqual(["Printer warning HMS_0300_0D00_0003_0001: check it before printing"]);
    expect(r.reasons).toEqual(["Check the warnings and tick \"I checked this\""]);
    expect(canStartPrint(printer({}, { hms: [warn] }), job({ warningsChecked: true }), NOW).ok).toBe(true);
  });

  it("checks the file: sliced, for the A1, the right nozzle, the plate exists", () => {
    const reasons = (info: ThreeMfInfo | undefined, plate = 1) => canStartPrint(printer(), job({ info, plate }), NOW).reasons;
    expect(reasons(undefined)).toEqual(["Not a sliced file: in Bambu Studio use File > Export > Export plate sliced file (.gcode.3mf)"]);
    expect(reasons({ sliced: false, plates: [], error: "Not a ZIP archive" })).toEqual(["The 3MF could not be read: Not a ZIP archive"]);
    expect(reasons({ ...INFO, printerModelId: "N1", printerModel: "Bambu Lab A1 mini" })).toEqual(["The file is sliced for Bambu Lab A1 mini, not the Bambu Lab A1"]);
    expect(reasons({ ...INFO, printerModelId: undefined })).toEqual([]); // older files name the printer in project settings
    expect(reasons(INFO, 2)).toEqual(["Plate 2 is not in the sliced file"]);
    expect(reasons({ ...INFO, plates: [{ ...INFO.plates[0], nozzle: "0.2" }] })).toEqual(["The file is for a 0.2 mm nozzle; the printer has 0.4 mm"]);
  });

  it("checks every used filament against the slot it is mapped to: same material, slot not empty", () => {
    const reasons = (amsMapping: number[]) => canStartPrint(printer(), job({ amsMapping }), NOW).reasons;
    expect(reasons([2, -1])).toEqual([]);
    expect(reasons([0])).toEqual(["The AMS mapping needs 2 entries, one per filament in the project"]);
    expect(reasons([-1, -1])).toEqual(["Filament 1 (PLA) has no AMS slot"]);
    expect(reasons([1, -1])).toEqual(["Filament 1 (PLA) is mapped to slot 2, which is empty"]);
    expect(reasons([3, -1])).toEqual(["Filament 1 needs PLA, but slot 4 holds PETG"]);
    expect(reasons([99, -1])).toEqual(["The AMS mapping holds an invalid slot", "Filament 1 (PLA) is mapped to AMS 25 slot 4, which is empty"]);
  });

  it("without the AMS: one filament from the external spool, same material", () => {
    const ext = job({ amsMapping: [], options: { bedLevelling: true, flowCali: false, timelapse: false, useAms: false } });
    expect(canStartPrint(printer(), ext, NOW).reasons).toEqual(["The external spool holds PETG; the file needs PLA"]);
    expect(canStartPrint(printer({}, { externalSpool: { type: "PLA", color: "#FFFFFF" } }), ext, NOW).ok).toBe(true);
    expect(canStartPrint(printer({}, { externalSpool: null }), ext, NOW).reasons).toEqual(["No external spool is set on the printer"]);
  });
});

describe("MQTT messages (spec §4)", () => {
  it("pause, resume, stop, speed, light, get_version: exactly as Bambu Studio sends them", () => {
    expect(buildMqttPayload("pause", {}, "50001")).toEqual({ payload: { print: { sequence_id: "50001", command: "pause", param: "" } }, qos: 1 });
    expect(buildMqttPayload("resume", {}, "50002").payload).toEqual({ print: { sequence_id: "50002", command: "resume", param: "" } });
    expect(buildMqttPayload("stop", {}, "50003").payload).toEqual({ print: { sequence_id: "50003", command: "stop", param: "" } });
    expect(buildMqttPayload("speed", { level: 3 }, "50004").payload).toEqual({ print: { sequence_id: "50004", command: "print_speed", param: "3" } });
    expect(buildMqttPayload("light", { on: true }, "50005").payload).toEqual({ system: {
      sequence_id: "50005", command: "ledctrl", led_node: "chamber_light", led_mode: "on", led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0,
    } });
    expect(buildMqttPayload("get_version", {}, "0")).toEqual({ payload: { info: { sequence_id: "0", command: "get_version" } }, qos: 0 });
  });

  it("start_print: project_file from the SD root with one ams_mapping entry per project filament", () => {
    const fileName = sdFileName("ORD-012", 1, 1792072000);
    expect(fileName).toBe("ORD-012_p1_1792072000.gcode.3mf");
    const m = buildMqttPayload("start_print", {
      plate: 1, fileName, subtaskName: "ORD-012 Pill Bottom", amsMapping: [2, -1, 0],
      options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true },
    }, "50006");
    expect(m).toEqual({
      qos: 1,
      payload: { print: {
        sequence_id: "50006", command: "project_file", param: "Metadata/plate_1.gcode", url: "file:///sdcard/ORD-012_p1_1792072000.gcode.3mf",
        file: "", md5: "", subtask_name: "ORD-012 Pill Bottom", project_id: "0", profile_id: "0", task_id: "0", subtask_id: "0",
        bed_type: "auto", timelapse: false, bed_leveling: true, bed_levelling: true, flow_cali: true, vibration_cali: false,
        layer_inspect: true, use_ams: true, ams_mapping: [2, -1, 0],
      } },
    });
    const ftp = buildMqttPayload("start_print", { plate: 1, fileName, subtaskName: "x", amsMapping: [], urlForm: "ftp",
      options: { bedLevelling: false, flowCali: false, timelapse: false, useAms: false } }, "50007").payload.print as Record<string, unknown>;
    expect(ftp).toMatchObject({ url: `ftp:///${fileName}`, use_ams: false, bed_leveling: false, bed_levelling: false, flow_cali: false });
    expect(ftp).not.toHaveProperty("ams_mapping");
  });

  it("refuses anything else: raw G-code, moves, temperatures, unsafe names", () => {
    for (const kind of ["gcode_line", "gcode_file", "calibration", "unload_filament", "ams_change_filament", "set_temp", "camera_snapshot", "home"]) {
      expect(() => buildMqttPayload(kind as never, {}, "50010"), kind).toThrow(/not an allowed printer command/);
    }
    expect(() => buildMqttPayload("speed", { level: 9 }, "50011")).toThrow();
    expect(() => buildMqttPayload("light", { on: "yes" }, "50012")).toThrow();
    const bad = (fileName: string) => () => buildMqttPayload("start_print", { plate: 1, fileName, subtaskName: "x", amsMapping: [0],
      options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true } }, "50013");
    for (const name of ["../x.gcode.3mf", "cache/x.gcode.3mf", "a b.gcode.3mf", "x.3mf", "model/Benchy.gcode.3mf"]) expect(bad(name), name).toThrow(/safe/);
    expect(() => buildMqttPayload("pause", {}, "abc")).toThrow();
  });

  it("reads replies, case-insensitively, and ignores status reports", () => {
    expect(parseReply({ print: { command: "pause", sequence_id: "50001", result: "SUCCESS", reason: "" } }))
      .toEqual({ type: "print", command: "pause", sequenceId: "50001", ok: true, reason: "" });
    expect(parseReply({ print: { command: "project_file", sequence_id: "50006", result: "fail", reason: "busy" } })).toMatchObject({ ok: false, reason: "busy" });
    expect(parseReply({ system: { command: "ledctrl", sequence_id: "50005", result: "success" } })).toMatchObject({ type: "system", ok: true });
    expect(parseReply({ print: { command: "push_status", gcode_state: "IDLE" } })).toBeNull();
    // A device error code is a refusal, with or without result "fail"; 0 is no error.
    expect(parseReply({ print: { command: "project_file", sequence_id: "50006", result: "success", err_code: 0x05004004 } }))
      .toMatchObject({ ok: false, errCode: "0500-4004" });
    expect(parseReply({ print: { command: "pause", sequence_id: "50001", result: "success", err_code: 0 } })).toEqual(
      { type: "print", command: "pause", sequenceId: "50001", ok: true, reason: "" });
  });

  it("Bambu's internal device errors do not block a start", () => {
    expect(canStartPrint(printer({}, { errorCode: 0x0500c011 }), job(), NOW).ok).toBe(true);
    expect(canStartPrint(printer({}, { errorCode: 0x05004033 }), job(), NOW).reasons).toEqual(["Printer error 0500-4033: fix it before printing"]);
  });

  it("names on the printer: safe SD names and an ASCII job name with the order code", () => {
    expect(SD_FILE_NAME.test(sdFileName("ORD-012", 2, 1792072000))).toBe(true);
    expect(sdFileName("../../x y", 1, 5)).toBe("xy_p1_5.gcode.3mf");
    expect(subtaskName("ORD-012", "Gantungan kunci “Aini” – merah")).toBe("ORD-012 Gantungan kunci Aini merah");
  });
});

describe("the bridge can import these files straight from Node", () => {
  const dir = path.join(process.cwd(), "src", "lib", "printer");
  it("bambu.ts and control.ts have no runtime imports", () => {
    for (const file of ["bambu.ts", "control.ts"]) {
      const imports = readFileSync(path.join(dir, file), "utf8").split("\n").filter((l) => /^import\s/.test(l));
      expect(imports.every((l) => /^import type\s/.test(l)), file).toBe(true);
    }
  });

  it("node runs them with type stripping, as scripts/printer-bridge.mjs does", () => {
    const control = pathToFileURL(path.join(dir, "control.ts")).href;
    const bambu = pathToFileURL(path.join(dir, "bambu.ts")).href;
    const out = execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e",
      `const c = await import(${JSON.stringify(control)}); const b = await import(${JSON.stringify(bambu)});
       console.log(JSON.stringify([c.buildMqttPayload("pause", {}, "1").payload, b.errorCodeText(0x07008011)]));`], { encoding: "utf8" });
    expect(JSON.parse(out)).toEqual([{ print: { sequence_id: "1", command: "pause", param: "" } }, "0700-8011"]);
  });

  it("knows the same print errors that are no fault as bambu.ts, and Bambu's internal codes as the table", () => {
    expect([...NOT_A_FAULT_PRINT_ERRORS]).toEqual([...BENIGN_PRINT_ERRORS, ...INTERNAL_PRINT_ERRORS]);
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, "0");
    expect(INTERNAL_PRINT_ERRORS.map(hex).sort()).toEqual((errorTable as { internal: string[] }).internal);
    expect(readFileSync(path.join(dir, "control.ts"), "utf8")).not.toMatch(/^import (?!type)/m);
  });
});
