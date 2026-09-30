# API contract

Types live in `src/lib/types.ts` and are the source of truth. Money is **integer
micro-USDC** (6 decimals): 30 USDC = `30000000`. Errors return `{ error, reasons? }`.
Data is stored in SQLite (`src/lib/store.ts`, file `data/local/kesuni.db`, git-ignored). Orders are labelled `real` or `simulated`.

| Method & path | Body | Result |
|---|---|---|
| `GET /api/orders` | none | `{ orders }` |
| `POST /api/orders` | `{ product, quantity, deadline: "YYYY-MM-DD", designVersion, budgetUsdc: "32.5", label: "real"\|"simulated" }` | 201 `{ order }`, or 400 with reasons |
| `GET /api/orders/:id` | none | order + vendors, quotes, decisions, evidence, acceptance, agentLog, paymentIntents |
| `POST /api/orders/:id/quotes` | `{ vendorId, priceUsdc: "30", etaHours }` (or `priceMicro`) | 201 `{ quote }`. Only while order is `CREATED` |
| `POST /api/orders/:id/decision` | `{ quoteId, decidedBy: "agent"\|"human", reason }` | 200 `{ order }`, or **422** with policy reasons |
| `POST /api/orders/:id/evidence` | `{ kind: "log"\|"photo"\|"qc", note, label }` | 201 `{ evidence }` |
| `POST /api/orders/:id/acceptance` | `{ accepted, by, note }` (human only) | 200 `{ acceptance, order }` |
| `POST /api/orders/:id/agent-plan` | none | 200 `{ result, log }`: rule-based planner (no LLM yet) picks the cheapest allowed quote or escalates; `log` lists every tool call |
| `POST /api/orders/:id/payment-intent` | `{ recipient, amountMicro, idempotencyKey }` | 201 `{ intent, replayed:false }`, replay 200 `replayed:true`, or **422** |

| `POST /api/reset` | none | Resets the `simulated` demo order. `real` orders are never touched |

## Order status flow
`CREATED → PLAN_CHOSEN → IN_PRODUCTION → EVIDENCE_SUBMITTED → ACCEPTED | REJECTED`
(`PAID` is set only after a verified on-chain transfer; not built yet.)

## Who may change what
- **decision**: agent or human. Policy engine checks budget, approved vendor, order match.
- **evidence**: operator (manual) or, later, a printer bridge. Always carries a `label`.
- **acceptance**: human only. Never derived from model output.
- **payment-intent**: allowed only when accepted, QC evidence exists, recipient equals the
  approved vendor address, amount equals the accepted quote and is within mandate, and no
  other intent exists for the order. Same `idempotencyKey` returns the original intent.

## Payment states
`ALLOCATED → PAYMENT_INTENT_CREATED → SUBMITTED → CONFIRMED`, with `UNKNOWN` and
`PARTIALLY_PAID` (`src/lib/payment-state.ts`). On `UNKNOWN`, check the original transaction
before any retry.

## Agent tools (`src/lib/agent/tools.ts`)
`get_order`, `get_quotes`, `get_available_budget`, `check_vendor_policy`, `choose_plan`,
`request_human_decision`, `propose_payment`. Each has a JSON Schema so an LLM can call them
later. Writes go through `src/lib/actions.ts`, the same code the HTTP routes use, so an agent
cannot bypass policy. Every call is stored in `agentLog` (returned by `GET /api/orders/:id`).

## Not built yet
Sending USDC on Arc, on-chain verification (chain, token, recipient, amount, job link),
the LLM tool-calling loop (a rule-based planner stands in), printer bridge, vendor management, and hosted storage for the live link.
