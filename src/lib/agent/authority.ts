// What the Chief does on its own, and where code limits it: built from the live config (the agent's tool list, the
// owner's rules, pricing, the network switch, the wake limit, the heartbeat interval), not from fixed prose, so the
// card on the home page changes when the config does. Plus today's activity from the agent log. Read-only.
import * as store from "../store";
import { ownerRules } from "../owner-rules";
import { pricingConfig } from "../pricing";
import { network } from "../network";
import { LLM_TOOLS } from "./tools";
import { maxWakesPerHour } from "./chief";
import { ARC_CHECKS_PER_BEAT, heartbeatIntervalSeconds } from "./heartbeat";
import { dailyFacts, jakartaDay } from "./daily-review";

export interface AuthorityItem { id: string; text: string; by: "Chief (Claude)" | "code" }
export interface ChiefAuthority {
  decidesAlone: AuthorityItem[];
  limitedByCode: { id: string; text: string }[];
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

  const llm: [string, string][] = [
    ["price_by_weight", `Price by weight from the slicer grams a person entered: ${rp(pc.pricePerGramIdr)}/g, unit price rounded up to ${rp(pc.roundIdr)}`],
    ["choose_plan", "Choose the production plan within the customer's budget and the owner's rules"],
    ["choose_printer", "Choose a ready printer once the customer has paid into escrow"],
    ["create_operator_task", "Create operator tasks (filament, collect the print, QC)"],
    ["message_customer", "Message the customer on their order page"],
    ["request_human_decision", "Ask a person only when a number is missing or a rule needs the owner"],
  ];
  const decidesAlone: AuthorityItem[] = [
    ...llm.filter(([id]) => has(id)).map(([id, text]) => ({ id, text, by: "Chief (Claude)" as const })),
    {
      id: "heartbeat", by: "code",
      text: beat > 0
        ? `Heartbeat checks every ${beat >= 60 && beat % 60 === 0 ? `${beat / 60} min` : `${beat} s`}: wakes the Chief when an order needs a decision, checks up to ${ARC_CHECKS_PER_BEAT} transfers on Arc`
        : "Heartbeat checks are off (KESUNI_HEARTBEAT_SECONDS=0)",
    },
    { id: "release", by: "code", text: "Release escrow to Kesuni after the customer accepts, if the policy allows" },
    { id: "refund", by: "code", text: "Refund the customer after a rejection" },
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

  const day = jakartaDay(now);
  const chief = dailyFacts(day, now).chief;
  const from = new Date(Date.parse(`${day}T00:00:00+07:00`)).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00+07:00`) + 86_400_000).toISOString();
  const settlements = store.listLogBetween(from, to)
    .filter((e) => e.actor === "agent" && e.ok && (e.tool === "release_escrow" || e.tool === "refund_escrow")).length;

  return {
    decidesAlone, limitedByCode, tools, hasPaymentTool,
    today: {
      day, decisions: chief.decisions, escalations: chief.escalations, messages: chief.messagesToCustomers, settlements, refusals: chief.refusals,
    },
  };
}
