import { describe, expect, it } from "vitest";
import { detectEvents, errorCodeText, mergeReport, type PrinterSnapshot } from "./bambu";

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

describe("mergeReport", () => {
  it("merges partial A1 updates into the full snapshot", () => {
    const { snap } = run([
      full({ gcode_state: "RUNNING", mc_percent: 10, subtask_name: "clicker_aini", total_layer_num: 120 }),
      { print: { mc_percent: 40, layer_num: 48 } }, // partial: no gcode_state, no name
    ]);
    expect(snap).toMatchObject({ state: "RUNNING", percent: 40, layer: 48, totalLayers: 120, jobName: "clicker_aini" });
  });

  it("ignores messages that are not print reports", () => {
    expect(mergeReport(undefined, { info: { command: "get_version" } }, at(0))).toBeUndefined();
    expect(mergeReport(undefined, null, at(0))).toBeUndefined();
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

  it("pause with an error needs an operator, then resumes", () => {
    const { events } = run([
      full({ gcode_state: "RUNNING", mc_percent: 62, subtask_name: "clicker_aini" }),
      { print: { gcode_state: "PAUSE", print_error: 0x07008011 } },
      { print: { gcode_state: "RUNNING", print_error: 0 } },
    ]);
    expect(events.map((e) => e.kind)).toEqual(["needs_operator", "resumed"]);
    expect(events[0]).toMatchObject({ percent: 62, errorCode: 0x07008011, jobName: "clicker_aini" });
  });

  it("reports a failed print", () => {
    const { events } = run([full({ gcode_state: "RUNNING", mc_percent: 20 }), { print: { gcode_state: "FAILED", print_error: 0x0300400c } }]);
    expect(events.map((e) => e.kind)).toEqual(["failed"]);
  });

  it("does not invent events from the first report after connecting", () => {
    expect(run([full({ gcode_state: "FINISH", mc_percent: 100 })]).events).toEqual([]);
  });
});

it("formats error codes like the Bambu wiki", () => {
  expect(errorCodeText(0x07008011)).toBe("0700-8011");
});
