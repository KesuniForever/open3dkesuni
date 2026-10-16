// What the customer can see and do through their private link (/c/<token>).
// The customer never sees wallet ids, vendor addresses, the agent log or other orders.
// Paying, accepting and rejecting go through the same actions and policy checks as the operator;
// after the customer decides, the agent releases or refunds the escrow on its own (policy-gated).
import * as store from "./store";
import { budgetFromRupiah, createOrder, recordAcceptance, type Fail } from "./actions";
import { deposit, openEscrow, refund, release, syncEscrow, topUpCustomer } from "./escrow";
import { circle } from "./circle";
import { microToUsdc } from "./policy";
import { notReadyReason } from "./printer/actions";
import { idrPerUsdc, idrToMicro } from "./costing";
import { agreementCurrent, costingForChosen, gramPricingForChosen } from "./agreement";
import { isTestnetChain, publicNetwork, type PublicNetwork } from "./network";
import { ownerRules, quoteIdr } from "./owner-rules";
import { raiseOffer } from "./budget-raise";
import { wakeChief } from "./agent/chief";
import { nameOf, parseColorChoices, studioPalette, type PaletteColor } from "./colors";
import { MATERIALS, orderMaterial, priceByWeight, pricingConfig, pricingFor } from "./pricing";
import { customerDesignClosed, customerDesignFile } from "./auto-weigh";
import { autoWeighState } from "./slicing";
import type { Vec3 } from "./mesh";
import type { ActualReport, ChainTx, ColorChoice, Escrow, Material, Order, Review, Spec } from "./types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const live = (t: ChainTx) => !["FAILED", "DENIED", "CANCELLED"].includes(t.state);
const PAYABLE = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];
/** printedOn of a test order marked printed without a print (Order.printDoneDebug): no printer printed it. */
export const TEST_PRINTED_ON = "Test (no real print)";

export { idrPerUsdc };

export const orderForToken = (token: string): Order | undefined =>
  /^[A-Za-z0-9_-]{16,64}$/.test(token) ? store.getOrderByToken(token) : undefined;

export interface CustomerView {
  order: Pick<Order, "id" | "product" | "quantity" | "deadline" | "status" | "label" | "customerName" | "customerNote">;
  price: { usdc: string; idr: number; etaHours: number } | null;
  escrow: {
    state: Escrow["state"]; amountUsdc: string; network: string; label: string;
    /** verifiedOnArc: true = checked on Arc and it matches, false = Arc does not match (Kesuni checks), absent = not checked yet. */
    txs: { kind: ChainTx["kind"]; amountUsdc: string; state: ChainTx["state"]; txHash?: string; at: string; verifiedOnArc?: boolean }[];
  } | null;
  paying: boolean;
  printing: { printer: string; state: string; percent: number; remainingMin: number | null; online: boolean } | null;
  /** The printer whose bed holds the finished part, TEST_PRINTED_ON for a test order marked printed, else null. */
  printedOn: string | null;
  updates: { kind: string; note: string; label: string; at: string; photo?: string }[];
  /** Short updates from the Chief (AI) or a person at Kesuni, oldest first. Text, author kind and time only. */
  messages: { text: string; by: "agent" | "human"; at: string }[];
  acceptance: { accepted: boolean; by: string; note: string; at: string } | null;
  idrPerUsdc: number;
  spec: Spec | null;
  /** The customer must approve the current price and spec (this fingerprint) before paying. */
  agreement: { hash: string; version: number; by: string; at: string; current: boolean } | null;
  /** Where the money goes, when Kesuni priced the order with the cost calculator. Rupiah. */
  costs: { lines: { label: string; idr: number }[]; kesuniIdr: number; totalIdr: number } | null;
  /** How the price was made, when Kesuni priced by weight (the official price). No cost or margin here. */
  weightPrice: { gramsPerUnit: number; pricePerGramIdr: number; exactUnitIdr: number; unitPriceIdr: number; quantity: number; totalIdr: number } | null;
  /** The chain this order's money is on (the escrow's, else the configured one). */
  network: PublicNetwork;
  actual: Pick<ActualReport, "filamentGrams" | "machineHours" | "maxDeviationMm" | "unitsPassed" | "note" | "at"> | null;
  /** The measured size deviation is above the agreed tolerance: a warning before "Accept", never a block. */
  overTolerance: boolean;
  review: Review | null;
  /** The material and colours the customer picked (English names: pages translate them). They may change them while
   *  Kesuni has not priced the order yet (canChange); the material is fixed once a quote exists (materialLocked). */
  choice: { material: Material | null; colors: ColorChoice[]; canChange: boolean; materialLocked: boolean };
  /** The design the customer sent themselves, as their order page shows it. Null without a design of their own. */
  design: CustomerDesignView | null;
  /** The customer may still add their design on the order page ("Add your design": POST /api/c/<token>/design). */
  canAddDesign: boolean;
  /**
   * Kesuni's price is above the customer's budget, and nothing is signed or paid yet (src/lib/budget-raise.ts): they may
   * raise their budget to exactly this price ("raise-budget"). Only the price and their own budget: no cost, margin,
   * grams, where the price came from, or names of people at Kesuni.
   */
  overBudget: { quoteId: string; priceIdr: number; unitIdr: number; quantity: number; priceUsdc: string; budgetIdr: number } | null;
  /** The customer raised their budget and Kesuni prepares the agreement (the order is still CREATED): the new budget. */
  budgetRaised: { toIdr: number } | null;
  /** Above this many rupiah Kesuni's owner approves the price too (the owner's rules), for the page's ⓘ. */
  ownerApprovalAboveIdr: number;
}

/**
 * The customer's own design (order form or "Add your design") on their order page: only what is theirs or about their
 * own piece. Never cost, margin, printer or tray, slicer settings, the sliced file, file ids, storage paths or names of
 * people at Kesuni. The file itself comes from GET /api/c/<token>/design (the 3D view is drawn in their browser).
 */
export interface CustomerDesignView {
  /** Their own file name, as they sent it (cleaned). */
  name: string;
  /** Its size in bytes: a phone asks before downloading a big model for the 3D view. */
  bytes: number;
  /** Width, depth and height in mm, read when it was stored; null for older files (the page measures it then). */
  sizeMm: Vec3 | null;
  /** Being weighed by the studio's slicer, weighed (grams known), or Kesuni checks the file (a person weighs it). */
  state: "weighing" | "weighed" | "check";
  /** The order's grams per piece (what the price is made from). */
  gramsPerPiece: number | null;
  /** The automatic weighing's print time for one piece, in minutes: an estimate. Only when its grams are the order's. */
  printMinutesPerPiece: number | null;
  /** The spool it was weighed with: material, English colour name (pages translate it) and "#RRGGBB". */
  material: Material | null;
  colourName: string | null;
  colourHex: string | null;
  /** The official price by weight for the order's quantity, until Kesuni's own price exists. Not a quote. */
  estimate: { unitIdr: number; totalIdr: number; usdc: string } | null;
  /** Kesuni's price exists (the price block shows it): the page keeps this card short. */
  priced: boolean;
}

export function customerView(order: Order, token: string): CustomerView {
  const quote = order.chosenQuoteId ? store.getQuote(order.chosenQuoteId) : undefined;
  const escrow = store.getEscrow(order.id);
  const rate = idrPerUsdc();
  const printers = store.listPrinters();
  const p = printers.find((x) => x.currentOrderId === order.id);
  const acc = store.getAcceptance(order.id);
  const offer = raiseOffer(order);
  const lastRaise = order.budgetRaises?.at(-1);
  const raised = !offer && lastRaise && order.status === "CREATED" ? { toIdr: lastRaise.toIdr } : null;
  const design = designOf(order);
  return {
    order: {
      id: order.id, product: order.product, quantity: order.quantity, deadline: order.deadline, status: order.status,
      label: order.label, customerName: order.customerName, customerNote: order.customerNote,
    },
    // Rupiah as agreed (by weight or calculator), not converted back from whole USDC cents.
    price: quote ? { usdc: microToUsdc(quote.priceMicro), idr: quoteIdr(order, quote), etaHours: quote.etaHours } : null,
    escrow: escrow ? {
      state: escrow.state, amountUsdc: microToUsdc(escrow.amountMicro), network: escrow.network, label: escrow.label,
      txs: escrow.txs.map((t) => ({
        kind: t.kind, amountUsdc: microToUsdc(t.amountMicro), state: t.state, txHash: t.txHash, at: t.at, verifiedOnArc: t.verified?.ok,
      })),
    } : null,
    paying: Boolean(escrow && escrow.state === "AWAITING_DEPOSIT" && escrow.txs.some(live)),
    printing: p?.snapshot ? {
      printer: p.name, state: p.snapshot.state, percent: p.snapshot.percent, remainingMin: p.snapshot.remainingMin,
      online: !(notReadyReason(p) ?? "").startsWith("offline"),
    } : null,
    // A test order a person marked printed without a print ("Done (debug)") reads as printed: QC comes next.
    printedOn: printers.find((x) => x.bedOccupiedBy === order.id)?.name ?? (order.printDoneDebug ? TEST_PRINTED_ON : null),
    updates: store.listEvidence(order.id).map((e) => ({
      kind: e.kind, note: e.note, label: e.label, at: e.at,
      photo: e.attachmentId ? `/api/c/${token}/files/${e.attachmentId}` : undefined,
    })),
    messages: store.listMessages(order.id).map((m) => ({ text: m.text, by: m.by, at: m.at })),
    acceptance: acc ? { accepted: acc.accepted, by: acc.by, note: acc.note, at: acc.at } : null,
    idrPerUsdc: rate,
    spec: order.spec ?? null,
    agreement: order.agreement
      ? { hash: order.agreement.hash, version: order.agreement.version, by: order.agreement.by, at: order.agreement.at, current: agreementCurrent(order) }
      : null,
    costs: costsFor(order),
    weightPrice: weightPriceFor(order),
    network: publicNetwork(escrow?.network),
    actual: order.actual ? {
      filamentGrams: order.actual.filamentGrams, machineHours: order.actual.machineHours, maxDeviationMm: order.actual.maxDeviationMm,
      unitsPassed: order.actual.unitsPassed, note: order.actual.note, at: order.actual.at,
    } : null,
    overTolerance: overTolerance(order) !== null,
    review: order.review ?? null,
    choice: choiceOf(order),
    // Kesuni's own price is on the page (or the budget was raised to it): the design card's estimate by weight would be a
    // second, maybe different price.
    design: design && (offer || raised) ? { ...design, estimate: null } : design,
    canAddDesign: customerDesignClosed(order) === null,
    overBudget: offer ? {
      quoteId: offer.quote.id, priceIdr: offer.priceIdr, unitIdr: offer.unitIdr, quantity: order.quantity,
      priceUsdc: microToUsdc(offer.quote.priceMicro), budgetIdr: offer.budgetIdr,
    } : null,
    budgetRaised: raised,
    ownerApprovalAboveIdr: ownerRules().approvalAboveIdr,
  };
}

/** The customer's own design and what the automatic weighing found, customer-safe (see CustomerDesignView). */
export function designOf(order: Order, now = Date.now()): CustomerDesignView | null {
  const file = customerDesignFile(order.id);
  if (!file) return null;
  const weigh = autoWeighState(order.id, now);
  const grams = order.slicerGrams?.gramsPerUnit ?? null;
  // The automatic slice whose weight the order's grams are (src/lib/slicing.ts autoGramsFromSlice names it in the source).
  const job = weigh?.state === "done" && order.slicerGrams?.source.startsWith(`slicer (automatic), ${weigh.job.id},`) ? weigh.job : null;
  const sec = job?.result?.predictionSec;
  const priced = Boolean(order.chosenQuoteId);
  return {
    name: file.filename, bytes: file.size, sizeMm: file.mesh?.sizeMm ?? null,
    state: grams !== null ? "weighed" : weigh?.state === "weighing" ? "weighing" : "check",
    gramsPerPiece: grams,
    printMinutesPerPiece: sec && sec > 0 ? Math.max(1, Math.round(sec / 60)) : null,
    material: job?.material ?? null, colourName: job ? nameOf(job.color) : null, colourHex: job?.color ?? null,
    estimate: grams !== null && !priced && order.status === "CREATED" ? estimateFor(order, grams) : null,
    priced,
  };
}

/** The price Kesuni's quote by weight would give (src/lib/agreement.ts quoteByWeight): the order's material and quantity. */
function estimateFor(order: Order, gramsPerUnit: number): CustomerDesignView["estimate"] {
  const r = priceByWeight(gramsPerUnit, order.quantity, order.slicerGrams?.colorMode ?? "single", pricingFor(pricingConfig(), orderMaterial(order)));
  if (!r.ok) return null;
  return { unitIdr: r.price.unitPriceIdr, totalIdr: r.price.totalIdr, usdc: microToUsdc(idrToMicro(r.price.totalIdr)) };
}

/** While the customer may still change colours but a quote exists, the material is the one it was priced in
 *  (no material is priced as PLA). Otherwise only what the customer chose. */
function choiceOf(order: Order): CustomerView["choice"] {
  const canChange = order.status === "CREATED";
  const materialLocked = store.listQuotes(order.id).length > 0;
  return {
    material: order.material ?? (canChange && materialLocked ? orderMaterial(order) ?? "PLA" : null),
    colors: order.preferredColors ?? [], canChange, materialLocked,
  };
}

function weightPriceFor(order: Order): CustomerView["weightPrice"] {
  const w = gramPricingForChosen(order);
  if (!w) return null;
  return {
    gramsPerUnit: w.gramsPerUnit, pricePerGramIdr: w.pricePerGramIdr, exactUnitIdr: Math.round(w.gramsPerUnit * w.pricePerGramIdr),
    unitPriceIdr: w.unitPriceIdr, quantity: w.quantity, totalIdr: w.totalIdr,
  };
}

function costsFor(order: Order): CustomerView["costs"] {
  const c = costingForChosen(order);
  if (!c) return null;
  return {
    lines: c.lines.filter((l) => l.idr > 0).map((l) => ({ label: l.label, idr: l.idr })),
    kesuniIdr: c.revenueIdr - c.businessCostIdr - c.feeIdr,
    totalIdr: c.revenueIdr,
  };
}

/**
 * Bring the order's payment up to date: refresh pending Circle transfers, and once the customer's
 * test USDC has arrived, send their payment into escrow (the customer already pressed "Pay").
 */
export async function refreshPayment(orderId: string): Promise<void> {
  const escrow = store.getEscrow(orderId);
  if (!escrow) return;
  if (escrow.txs.some((t) => !["COMPLETE", "FAILED", "DENIED", "CANCELLED"].includes(t.state))) await syncEscrow(orderId);
  const now = store.getEscrow(orderId)!;
  if (escrow.state === "AWAITING_DEPOSIT" && now.state === "FUNDED") {
    wakeChief(orderId, "The customer's payment just arrived in escrow. Start production.");
  }
  const toppedUp = now.txs.some((t) => t.kind === "customer_topup" && t.state === "COMPLETE");
  const depositing = now.txs.some((t) => t.kind === "deposit" && live(t));
  if (now.state === "AWAITING_DEPOSIT" && toppedUp && !depositing) await deposit(orderId);
}

/** The customer presses "Pay": open the escrow if needed, then pay (on testnet, test USDC first). */
export async function customerPay(orderId: string): Promise<{ ok: true } | Fail> {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!PAYABLE.includes(order.status)) return fail(409, "This order cannot be paid yet");
  let escrow = store.getEscrow(orderId);
  const paid = escrow && escrow.state !== "AWAITING_DEPOSIT";
  if (!paid && !agreementCurrent(order)) return fail(409, "Approve the agreement (price and spec) before paying");
  if (!escrow) {
    const r = await openEscrow(orderId);
    if (!r.ok) return r;
    escrow = r.escrow;
  }
  if (escrow.state !== "AWAITING_DEPOSIT") return { ok: true };
  if (escrow.txs.some((t) => t.kind === "deposit" && live(t))) return { ok: true };
  const balance = await circle().usdcBalanceMicro(escrow.customerWalletId);
  if (balance >= escrow.amountMicro) {
    const r = await deposit(orderId);
    return r.ok ? { ok: true } : r;
  }
  if (escrow.txs.some((t) => t.kind === "customer_topup" && live(t))) return { ok: true }; // deposit follows on refresh
  // Mainnet: no test USDC. Funding a customer wallet with real USDC is not built yet (docs/PILOT.md).
  if (!isTestnetChain(escrow.network)) {
    return fail(409, "Your payment wallet does not hold enough USDC yet. Contact Kesuni to learn how to top it up.");
  }
  const r = await topUpCustomer(orderId);
  return r.ok ? { ok: true } : r;
}

const mm = (n: number) => String(n);

/**
 * Quality gate: the operator's measured max deviation is above the tolerance in the agreed spec. Returns the two
 * numbers, or null when within tolerance or not measured yet. Only a warning for the customer; never blocks money.
 */
export function overTolerance(order: Order): { maxDeviationMm: number; toleranceMm: number } | null {
  if (!order.actual || !order.spec) return null;
  const { maxDeviationMm } = order.actual;
  const { toleranceMm } = order.spec;
  return Number.isFinite(maxDeviationMm) && Number.isFinite(toleranceMm) && maxDeviationMm > toleranceMm ? { maxDeviationMm, toleranceMm } : null;
}

/**
 * The customer accepts or rejects the goods. Then the agent releases or refunds the escrow.
 * Accepting needs `checked: true` (the customer ticked that they checked size, colour, finishing and function).
 * Accepting above the agreed tolerance is allowed: it is written in the log and the acceptance note, and the
 * release still goes through the policy as usual.
 */
export async function customerDecide(
  orderId: string, input: { accepted: boolean; by: string; note: string; checked?: boolean },
): Promise<{ ok: true; settled: boolean; reasons?: string[] } | Fail> {
  const escrow = store.getEscrow(orderId);
  if (!escrow || escrow.state !== "FUNDED") return fail(409, "The payment is not in escrow yet, so you cannot decide yet");
  if (input.accepted && input.checked !== true) {
    return fail(400, "First tick the box that you checked the size, colour, finish and function of the item you received");
  }
  const order = store.getOrder(orderId);
  const over = input.accepted && order ? overTolerance(order) : null;
  const note = over
    ? `${input.note.trim() ? `${input.note.trim()} ` : ""}[Accepted although the size deviation of ${mm(over.maxDeviationMm)} mm exceeds the ±${mm(over.toleranceMm)} mm limit]`
    : input.note;
  const r = recordAcceptance(orderId, { accepted: input.accepted, by: input.by, note });
  if (!r.ok) return r;
  const at = new Date().toISOString();
  store.addLog({
    orderId, actor: "human", tool: "customer_decision",
    input: { accepted: input.accepted, ...(input.accepted ? { checked: true } : {}), ...(over ? { acceptedOverTolerance: over } : {}) },
    ok: true, output: { by: input.by.trim() }, at,
  });

  // The agent settles on its own; the policy engine decides whether the money may move.
  const tool = input.accepted ? "release_escrow" : "refund_escrow";
  const s = input.accepted ? await release(orderId) : await refund(orderId);
  store.addLog({ orderId, actor: "agent", tool, input: {}, ok: s.ok, output: s.ok ? { state: "submitted" } : { error: s.error, reasons: s.reasons }, at: new Date().toISOString() });
  if (!s.ok) {
    store.saveTask({
      id: store.nextTaskId(), orderId, kind: "check_printer", status: "open", createdBy: "agent", at: new Date().toISOString(),
      text: `Payment for ${orderId} held by policy: ${(s.reasons ?? [s.error]).join("; ")}. Check before trying again.`,
    });
    return { ok: true, settled: false, reasons: s.reasons ?? [s.error] };
  }
  return { ok: true, settled: true };
}

/** A customer places an order through the invite link. Prices are set later by Kesuni.
 *  material / colors: the customer's pick from the studio's loaded spools (see readColorChoice), both optional. */
export function customerCreateOrder(input: {
  name: string; product: string; quantity: number; deadline: string; budgetIdr: number; note: string;
  material?: unknown; colors?: unknown;
}): { ok: true; order: Order } | Fail {
  const r: string[] = [];
  if (!input.name.trim()) r.push("Name is required");
  if (input.product.trim().length > 200) r.push("Product name is too long (at most 200 characters)");
  if (!Number.isFinite(input.budgetIdr) || input.budgetIdr < 1000) r.push("Budget minimal Rp1.000");
  const choice = readColorChoice(input.material, input.colors, studioPalette(store.listPrinters()));
  if (!choice.ok) r.push(...choice.reasons);
  if (r.length || !choice.ok) return fail(400, "The order is incomplete", r);
  // The rupiah as typed and the rate used, so the USDC budget can always be explained (same helper as New order).
  return createOrder({
    product: input.product, quantity: input.quantity, deadline: input.deadline, designVersion: "v1",
    label: "real", customerName: input.name, customerNote: input.note, ...budgetFromRupiah(input.budgetIdr),
    material: choice.material, preferredColors: choice.preferredColors,
  });
}

/**
 * The customer's material and colours from a request body: material "PLA" | "PETG" (or none: Kesuni picks), colors
 * [{ type, color }] that must be loaded in the studio right now (the palette). One material per order: colours without a
 * material set it. Names are always the English nameOf(color), whatever the page sent.
 */
export function readColorChoice(
  material: unknown, colors: unknown, palette: Pick<PaletteColor, "type" | "color">[],
): { ok: true; material?: Material; preferredColors: ColorChoice[] } | { ok: false; reasons: string[] } {
  const picked = MATERIALS.find((m) => m === material);
  if (!picked && material !== undefined && material !== null && material !== "") return { ok: false, reasons: ["Material must be PLA or PETG"] };
  const plain = Array.isArray(colors)
    ? colors.map((c) => (c && typeof c === "object" ? { type: (c as ColorChoice).type, color: (c as ColorChoice).color } : c))
    : colors;
  const r = parseColorChoices(plain, palette);
  if (!r.ok) return r;
  const chosen = picked ?? r.choices[0]?.type;
  if (r.choices.some((c) => c.type !== chosen)) return { ok: false, reasons: ["Pick the colours of one material"] };
  return { ok: true, material: chosen, preferredColors: r.choices.map((c) => ({ type: c.type, color: c.color, name: nameOf(c.color) })) };
}

/**
 * The customer changes their material or colours on their order page. Only while Kesuni has not priced the order
 * (CREATED); once a quote exists the material stays, because the price per gram may depend on it (colours of the same
 * material may still change). Logged for the operator; the Chief reads the choice from get_order.
 */
export function customerSetColors(
  orderId: string, input: { material: unknown; colors: unknown },
): { ok: true; choice: { material: Material | null; colors: ColorChoice[] } } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, "Kesuni has already priced your order. To change the material or colours, message Kesuni.");
  const c = readColorChoice(input.material, input.colors, studioPalette(store.listPrinters()));
  if (!c.ok) return fail(400, "These colours cannot be chosen", c.reasons);
  const pricedAs = (m: Material | null | undefined) => m ?? "PLA"; // no material is priced as PLA
  if (pricedAs(c.material) !== pricedAs(orderMaterial(order)) && store.listQuotes(orderId).length) {
    return fail(409, "Kesuni is already pricing your order. To change the material, message Kesuni.");
  }
  // undefined clears the field (the row is stored as JSON).
  store.saveOrder({ ...order, material: c.material, preferredColors: c.preferredColors.length ? c.preferredColors : undefined });
  store.addLog({
    orderId, actor: "human", tool: "customer_colors", input: { material: c.material ?? null, colors: c.preferredColors },
    ok: true, output: {}, at: new Date().toISOString(),
  });
  return { ok: true, choice: { material: c.material ?? null, colors: c.preferredColors } };
}
