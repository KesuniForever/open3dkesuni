// What the Chief does on its own, and where code limits it: built from the live config (the agent's tool list, the
// owner's rules, pricing, the network switch, the wake limit, the heartbeat interval), not from fixed prose, so the
// card on the home page changes when the config does. Plus today's activity from the agent log. Read-only.
import * as store from "../store";
import { ownerRules } from "../owner-rules";
import { pricingConfig, pricingFor } from "../pricing";
import { network } from "../network";
import { LLM_TOOLS } from "./tools";
import { maxWakesPerHour } from "./chief";
import { ARC_CHECKS_PER_BEAT, heartbeatIntervalSeconds } from "./heartbeat";
import { dailyFacts, jakartaDay } from "./daily-review";
import { ACTION_TOOLS, countableRows, SKILLS, skillOf, type Skill } from "./skills";

export interface AuthorityItem { id: string; text: string; by: "Chief (Claude)" | "code"; skill: Skill }
/** Work the Chief always hands to a person, and what keeps it there: code (a refusal or a missing tool) or only its instructions. */
export interface HandOff { id: string; text: string; enforcedBy: "code" | "instructions"; how: string }
export interface ChiefAuthority {
  decidesAlone: AuthorityItem[];
  limitedByCode: { id: string; text: string }[];
  handedToPerson: HandOff[];
  /** Tool names the LLM gets, and whether any of them can move money (must be false). */
  tools: string[];
  hasPaymentTool: boolean;
  today: {
    day: string;            // Jakarta day
    decisions: number;      // plan, price, printer and task decisions the Chief made itself
    escalations: number;    // questions handed to a person (request_human_decision)
    messages: number;       // updates the Chief posted to customers
    settlements: number;    // escrow releases/refunds started by code after the customer decided
    refusals: number;       // tool calls the policy or a rule refused
    bySkill: Record<Skill, number>; // actions the Chief (and its code) took today, per skill
  };
}

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
/** Names that would mean the LLM can move money. None of the LLM's tools may match. */
const MONEY_TOOL = /pay|release|refund|transfer|withdraw|send_usdc|escrow/i;

export function chiefAuthority(now: Date = new Date()): ChiefAuthority {
  const tools = LLM_TOOLS.map((t) => t.name);
  const has = (name: string) => tools.includes(name);
  const r = ownerRules();
  const pc = pricingConfig();
  const net = network();
  const beat = heartbeatIntervalSeconds();
  const mainnetUnlocked = process.env.KESUNI_ALLOW_MAINNET === "1";

  // PLA and PETG (owner, 15 Oct 2026); one price when PETG costs the customer the same as PLA, else both.
  const pla = pricingFor(pc, "PLA").pricePerGramIdr;
  const petg = pricingFor(pc, "PETG").pricePerGramIdr;
  const perGram = pla === petg ? `${rp(pla)}/g` : `PLA ${rp(pla)}/g, PETG ${rp(petg)}/g`;
  const llm: [string, string][] = [
    ["price_by_weight", `Price PLA and PETG by weight from the slicer grams a person entered: ${perGram}, unit price rounded up to ${rp(pc.roundIdr)}`],
    ["choose_plan", "Choose the production plan within the customer's budget and the owner's rules"],
    ["choose_printer", "Choose a ready printer once the customer has paid into escrow"],
    ["create_operator_task", "Ask the operator for filament changes and printer checks"],
    ["message_customer", "Message the customer on their order page"],
    ["request_human_decision", "Ask a person only when a number is missing or a rule needs the owner"],
  ];
  const decidesAlone: AuthorityItem[] = [
    ...llm.filter(([id]) => has(id)).map(([id, text]) => ({ id, text, by: "Chief (Claude)" as const, skill: skillOf(id) })),
    ...(has("create_operator_task")
      ? [{ id: "qc_task", text: "Ask the operator to collect and QC a finished print", by: "Chief (Claude)" as const, skill: "Quality" as const }]
      : []),
    {
      id: "heartbeat", by: "code", skill: "Operations",
      text: beat > 0
        ? `Heartbeat checks every ${beat >= 60 && beat % 60 === 0 ? `${beat / 60} min` : `${beat} s`}: wakes the Chief when an order needs a decision`
        : "Heartbeat checks are off (KESUNI_HEARTBEAT_SECONDS=0)",
    },
    { id: "arc_verify", by: "code", skill: "Finance", text: `Checks up to ${ARC_CHECKS_PER_BEAT} escrow transfers on Arc per heartbeat; a mismatch becomes a question for a person` },
    { id: "release", by: "code", skill: "Finance", text: "Release escrow to Kesuni after the customer accepts, if the policy allows" },
    { id: "refund", by: "code", skill: "Finance", text: "Refund the customer after a rejection" },
  ];

  const hasPaymentTool = tools.some((t) => MONEY_TOOL.test(t));
  const limitedByCode = [
    { id: "min_order", text: `Orders under ${rp(r.minOrderIdr)} need the owner's approval` },
    { id: "approval_above", text: `Orders above ${rp(r.approvalAboveIdr)} need the owner's approval` },
    { id: "partner_min", text: `Partners only for orders of ${rp(r.partnerMinIdr)} or more` },
    { id: "min_margin", text: `Never prices under a ${r.minMarginPct}% margin on its own` },
    { id: "deadline", text: "The chosen plan must finish before the deadline" },
    {
      id: "no_payment_tool",
      text: hasPaymentTool
        ? "WARNING: a tool that looks like a payment tool is in the agent's tool list"
        : `No payment tool: ${tools.length} tools, none moves money; release and refund run in code through the policy`,
    },
    { id: "one_order", text: "Works on one order per run; it cannot touch other orders or their quotes" },
    { id: "privacy", text: "Never sees the customer's name, phone or address" },
    {
      id: "mainnet",
      text: net.isTestnet
        ? `Runs on ${net.name} (test USDC); mainnet is locked unless KESUNI_ALLOW_MAINNET=1`
        : `Runs on ${net.name} (real USDC); mainnet is ${mainnetUnlocked ? "unlocked by KESUNI_ALLOW_MAINNET=1" : "locked: KESUNI_ALLOW_MAINNET is not 1"}`,
    },
    { id: "wakes", text: `At most ${maxWakesPerHour()} background wake-ups per hour (all orders together)` },
  ];

  const handedToPerson: HandOff[] = [
    { id: "qc", text: "Whether a print passes QC, and whether to reprint it", enforcedBy: "code", how: "no QC tool, and the Chief's task tool refuses reprints: a person records QC and the customer accepts or rejects" },
    { id: "printability", text: "Whether a design can be printed (size, supports, strength)", enforcedBy: "code", how: "no slicer or file access: grams per unit come only from a person" },
    { id: "material", text: "Materials other than PLA and PETG", enforcedBy: "code", how: "price_by_weight refuses when the spec is not PLA or PETG or the order text names another material (a keyword list, so a person double-checks)" },
    { id: "printers", text: "Starting, pausing or stopping a print", enforcedBy: "code", how: "no printer control tool: people start and control prints on the website, each with their name" },
    { id: "machines", text: "Machines Kesuni does not run", enforcedBy: "code", how: "the Chief only picks among the studio's printers and the quotes people entered; partners only within the owner's rules" },
    { id: "price_change", text: "A price change after the plan is chosen, discounts, exceptions to the owner's rules", enforcedBy: "code", how: "quotes close once a plan is chosen; the policy refuses exceptions until the owner approves" },
    { id: "money", text: "Moving money", enforcedBy: "code", how: "no payment tool: release and refund run in code after the customer decides" },
    { id: "unknown", text: "Anything that rests on missing or stale data", enforcedBy: "code", how: "a printer with no report in the last 2 minutes counts as offline; missing grams block pricing" },
    { id: "disputes", text: "Complaints, disputes, legal and tax questions", enforcedBy: "instructions", how: "the Chief is told to ask the owner; it has no tool to settle them" },
  ];

  const day = jakartaDay(now);
  const chief = dailyFacts(day, now).chief;
  const from = new Date(Date.parse(`${day}T00:00:00+07:00`)).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00+07:00`) + 86_400_000).toISOString();
  const todayLog = store.listLogBetween(from, to);
  const settlements = todayLog
    .filter((e) => e.actor === "agent" && e.ok && (e.tool === "release_escrow" || e.tool === "refund_escrow")).length;
  const bySkill = Object.fromEntries(SKILLS.map((s) => [s, 0])) as Record<Skill, number>;
  for (const e of countableRows(todayLog.filter((x) => x.actor === "agent" && x.ok && ACTION_TOOLS.includes(x.tool)))) bySkill[skillOf(e.tool, e.input)]++;

  return {
    decidesAlone, limitedByCode, handedToPerson, tools, hasPaymentTool,
    today: {
      day, decisions: chief.decisions, escalations: chief.escalations, messages: chief.messagesToCustomers, settlements, refusals: chief.refusals, bySkill,
    },
  };
}
