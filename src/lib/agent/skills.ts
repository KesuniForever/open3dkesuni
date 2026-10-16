// One Chief, five skills. Which skill a step belongs to is decided here, in code, from the tool name (and for an
// operator task, its kind), never from what the model says about itself. Pure: imported by the order page too.

export const SKILLS = ["Finance", "Operations", "Machines", "Quality", "Customer"] as const;
export type Skill = (typeof SKILLS)[number];

/** What each skill covers, for the Chief card and the authority card. */
export const SKILL_TEXT: Record<Skill, string> = {
  Finance: "price by weight, budget and margin checks, Arc payment checks",
  Operations: "read the order, choose the plan, ask the owner or the operator",
  Machines: "printer status, choose a printer, filament and printer tasks",
  Quality: "collect-and-QC tasks; the QC verdict and any reprint stay with a person",
  Customer: "updates on the customer's order page",
};

const BY_TOOL: Record<string, Skill> = {
  // Finance
  price_by_weight: "Finance", estimate_cost: "Finance", get_available_budget: "Finance", check_vendor_policy: "Finance",
  price_from_costing: "Finance", price_with_calculator: "Finance", propose_payment: "Finance", owner_approval: "Finance",
  release_escrow: "Finance", refund_escrow: "Finance", arc_verify: "Finance",
  // Operations
  get_order: "Operations", get_quotes: "Operations", choose_plan: "Operations", request_human_decision: "Operations",
  heartbeat: "Operations", slicer_grams: "Operations", agent_start: "Operations", agent_thought: "Operations",
  agent_summary: "Operations", llm_unavailable: "Operations", agent_wake_skipped: "Operations", remove_file: "Operations",
  // Machines
  get_production_status: "Machines", choose_printer: "Machines", link_printer: "Machines", suggest_reroute: "Machines",
  start_print: "Machines", printer_command: "Machines", print_job: "Machines",
  slice_request: "Machines", slice_result: "Machines", slice_cancel: "Machines",
  // Agent prints (src/lib/printer/dispatch.ts): the dispatcher's starts and reasons, the Chief's request, a person's switch and bed.
  auto_print: "Machines", auto_print_wait: "Machines", request_dispatch: "Machines", auto_print_switch: "Machines", auto_print_runs: "Machines",
  clear_bed: "Machines",
  // Customer
  message_customer: "Customer", customer_agreement: "Customer", customer_review: "Customer", customer_decision: "Customer",
  customer_colors: "Customer",
};

const TASK_SKILL: Record<string, Skill> = {
  change_filament: "Machines", check_printer: "Machines", collect_and_qc: "Quality", reprint: "Quality", needs_info: "Operations",
};

/** The skill of one decision-log step. Unknown tools count as Operations. */
export function skillOf(tool: string, input?: unknown): Skill {
  if (tool === "create_operator_task") {
    const kind = input && typeof input === "object" ? (input as { kind?: unknown }).kind : undefined;
    return TASK_SKILL[String(kind)] ?? "Machines";
  }
  return BY_TOOL[tool] ?? "Operations";
}

type LogRow = { tool: string; orderId: string; input: unknown; at: string };
const kindOf = (input: unknown) => (input && typeof input === "object" ? String((input as { kind?: unknown }).kind ?? "") : "");

/**
 * One row per action, for counting. Some steps are logged twice: by the tool wrapper (callTool) and by the code it
 * calls (createTask, choosePrinter), within the same moment. And a question to a person (request_human_decision) also
 * logs the needs_info task it opens. Keeps the first of each pair; the decision log itself still shows every row.
 */
export function countableRows<T extends LogRow>(rows: T[]): T[] {
  const kept: T[] = [];
  const last = new Map<string, number>();
  for (const r of [...rows].sort((a, b) => a.at.localeCompare(b.at))) {
    if (r.tool === "create_operator_task" && kindOf(r.input) === "needs_info") continue;
    const key = `${r.tool}|${r.orderId}|${kindOf(r.input)}`;
    const t = Date.parse(r.at);
    const prev = last.get(key);
    if (prev !== undefined && Math.abs(t - prev) <= 2_000) continue;
    last.set(key, t);
    kept.push(r);
  }
  return kept;
}

/** Steps that change something (not reads, not the run's own bookkeeping): what "actions per skill" counts. */
export const ACTION_TOOLS = [
  "price_by_weight", "choose_plan", "request_human_decision", "choose_printer", "create_operator_task", "suggest_reroute",
  "message_customer", "release_escrow", "refund_escrow", "arc_verify", "auto_print", "slice_request",
];
