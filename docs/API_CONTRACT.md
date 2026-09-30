# API contract

Types live in `src/lib/types.ts` and are the source of truth. Money is **integer
micro-USDC** (6 decimals): 30 USDC = `30000000`. Errors return `{ error, reasons? }`.
Data is in-memory and labelled `simulated` until real (`src/lib/store.ts`).

| Method & path | Body | Result |
|---|---|---|
| `GET /api/orders` | none | `{ orders }` |
| `GET /api/orders/:id` | none | order + quotes, decisions, evidence, acceptance, paymentIntents |
| `POST /api/orders/:id/quotes` | `{ vendorId, priceMicro, etaHours }` | 201 `{ quote }` (operator enters partner quotes manually) |
| `POST /api/orders/:id/decision` | `{ quoteId, decidedBy: "agent"\|"human", reason }` | 200 `{ order }`, or **422** with policy reasons |
| `POST /api/orders/:id/evidence` | `{ kind: "log"\|"photo"\|"qc", note, label }` | 201 `{ evidence }` |
| `POST /api/orders/:id/acceptance` | `{ accepted, by, note }` (human only) | 200 `{ acceptance, order }` |
| `POST /api/orders/:id/payment-intent` | `{ recipient, amountMicro, idempotencyKey }` | 201 `{ intent, replayed:false }`, replay 200 `replayed:true`, or **422** |

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

## Not built yet
Sending USDC on Arc, on-chain verification (chain, token, recipient, amount, job link),
the LLM agent, printer bridge, UI screens, and a real database.
