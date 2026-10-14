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
| `POST /api/orders/:id/agent-plan` | none | 200 `{ result, log }`: runs the Chief Kesuni Officer on the order (Claude, or the rule-based planner in rules mode). `result` = `{ mode, outcome: "done"\|"fallback"\|"busy"\|"error", summary, turns }`; `log` lists every tool call |
| `POST /api/orders/:id/price-by-weight` | `{ gramsPerUnit, source, etaHours? }` (operator; always recorded `by: "human"`, `by: "agent"` is refused) | 201 `{ quote, price, gramPricing }`: Kesuni's own quote at grams × Rp1.500, unit price rounded up to Rp500. Only while `CREATED` |
| `POST /api/orders/:id/messages` | `{ text, by?: "human" }` | 200 `{ message }`: a short update on the customer's page. **422** for links, wallet addresses, phone numbers, emails or a repeat of the last message. Only the Chief writes as `agent` (its own tool, max one per 10 min) |
| `POST /api/orders/:id/slicer-grams` | `{ gramsPerUnit, source, by }` (operator; no agent tool) | 200 `{ order }`: grams per unit from the slicer, the only grams the Chief may price with (`price_by_weight` refuses others). Wakes the Chief. Only while `CREATED` |
| `POST /api/orders/:id/owner-approval` | `{ quoteId?, by, note }` (owner only; no agent tool) | 200 `{ order }`: lifts the owner's own rule (minimum or approval limit) for this quote at its current price; a new or re-priced quote needs a new approval. Without `quoteId`, the only quote the owner can approve. Closes the order's open questions (`needs_info`) and wakes the Chief. Only while `CREATED` |
| `POST /api/orders/:id/payment-intent` | `{ recipient, amountMicro, idempotencyKey }` | 201 `{ intent, replayed:false }`, replay 200 `replayed:true`, or **422** |

| `GET /api/orders/:id/escrow` | none | Asks Circle once about pending transfers, then `{ escrow }` |
| `POST /api/orders/:id/escrow` | `{ action: "open" \| "topup" \| "deposit" \| "release" \| "refund" }` | `{ ok, escrow }` (+ `intent` on release), or **422** with policy reasons |
| `POST /api/reset` | none | Resets the `simulated` demo order. `real` orders are never touched |

### The Chief (operator only; `src/proxy.ts` guards everything except `/c`, `/api/c`, `/pesan` and the printer bridge)

| Method & path | Body | Result |
|---|---|---|
| `GET /api/settings/agent` | none | `{ mode: "claude"\|"rules", model, profile: "test"\|"demo"\|null, source: "setting"\|"env"\|"default", hasApiKey }` (never the key) |
| `POST /api/settings/agent` | `{ profile: "test"\|"demo" }` | Same as GET. Test = `claude-sonnet-5-5` (testing, debugging), Demo = `claude-opus-5-5` (demo, recording). 400 for anything else |
| `GET /api/heartbeat` | none | `{ last, intervalSeconds, enabled, schedulerRunning, nextRunAt, running, mode }`. `last` = the last beat's `{ at, trigger, mode, findings, woke, actions, errors, durationMs }` |
| `POST /api/heartbeat` | none | Runs one beat now ("run now" button), then the same as GET. **409** while a beat is running |
| `GET /api/daily-review` | none | `{ reviews }`, newest day first |
| `GET /api/daily-review?day=YYYY-MM-DD` | none | `{ review }`, 404 if that day has none, 400 for a bad date |
| `POST /api/daily-review` | `{ day?: "YYYY-MM-DD" }` (default today, Jakarta time) | `{ review }`: written now; replaces that day's review. 400 for a bad or future day, **409** while one is being written |
| `POST /api/arc/verify` | `{ txHash, from, to, amountUsdc }` | `{ check, explorerUrl }`: checks any USDC transfer on Arc, saves nothing. `check.status` = `verified` (+ `logId` = `chainId:txHash:logIndex`, `logIndex`, `blockNumber`) \| `mismatch` \| `not_found` (+ `reason`). **400** bad input, **502** RPC unreachable |
| `POST /api/arc/verify` | `{ orderId, idempotencyKey }` | Re-checks one stored escrow transfer (COMPLETE, with hash) and saves a definite result on it as `verified`; `{ check, saved, explorerUrl }`. 404 unknown tx, 409 not checkable |
| `GET /api/health/chain` | none (`?fresh=1` skips the ~60 s cache) | Always 200: `{ at, network, arc: { status: "ok"\|"stale"\|"wrong_chain"\|"bad_token"\|"unreachable"\|"not_configured", chainId, expectedChainId, blockNumber, blockAgeSec, usdcDecimals, reason? }, circle: { status: "ok"\|"unreachable"\|"not_configured", walletSet, wallet: { address (shortened), blockchain, state, usdc } \| null, reason? }, cached }`. Never returns the RPC URL or a key |
| `GET /api/traction` | none | Real usage for the submission (`src/lib/traction.ts`, read-only): `{ computedAt, rule, realCustomers, realOrders, realOrdersByStatus, arcTxs: { count, byKind: { deposit, release, refund }, verifiedOnArc, mismatchOnArc, notCheckedYet, volume: { testnet: { micro, usdc }, mainnet: { micro, usdc } }, last: [{ orderId, kind, amountMicro, amountUsdc, network, networkLabel, txHash, explorerUrl, verifiedOnArc: true\|false\|null, at }] }, excluded: { simulatedOrders, demoTopups } }`. Counts only `real` orders; a transfer counts when it is a deposit, release or refund, `COMPLETE`, with an Arc tx hash. Simulated orders, demo top-ups (`customer_topup` from the demo-funds wallet) and internal transfers are not counted. Volume is the sum of those transfers per network (a deposit and its release are two transfers). Customers are counted by name (the same name twice = one customer), never returned. Same numbers as the "Real usage" card on `/` |

`review` = `{ day, facts, text, mode: "claude" | "template", model, at, trigger: "schedule" | "button", error?, usage? }`.
`facts` are counted by code (`dailyFacts` in `src/lib/agent/daily-review.ts`): orders, plans (agent vs human), agreements,
escrow money (real and simulated orders apart, each labelled with its network: testnet = test USDC), operator tasks, the
Chief's activity (runs, heartbeat wake-ups, decisions, escalations, policy refusals, customer messages), deadlines, printers,
reputation and logged Claude tokens. No customer names, phones or addresses. `text` has five sections in simple Indonesian
("Ringkasan", "Yang berjalan baik", "Risiko & yang perlu diperhatikan", "Saran Chief", "Butuh keputusanmu"); Claude writes
it with no tools from the facts only, or a code template does (rules mode, Claude error or refusal: `error` says why).

## The Chief's heartbeat and daily review
Every `KESUNI_HEARTBEAT_SECONDS` (default 120) cheap code checks look at active orders, payments and printers. Code
handles what it can for free (sync a pending payment, open an operator task); Claude is woken only for a new problem that
needs a decision (max 3 orders per beat) and never again for the same unchanged problem. When Claude is unavailable (no
credits, overloaded), the problem is not counted as handled: it is tried again after 30 minutes. Background wake-ups
(new order, payment, owner approval) are capped at `KESUNI_MAX_WAKES_PER_HOUR` (default 20); the order form allows 5
orders per network address per hour. Last in a beat, once per Jakarta day after `KESUNI_DAILY_REVIEW_HOUR` (default 21
WIB), it writes the daily review; a button review made earlier that day is replaced, and a missing review of yesterday
is caught up on the next beat. Page: `/review`.

## Arc receipt check (`src/lib/arc-verify.ts`, read-only)
Circle reports a transfer COMPLETE; this asks Arc itself over JSON-RPC (viem): the receipt's status is success, its block
is canonical, and it holds **exactly one** USDC `Transfer` log (token = `network().usdcAddress`) from the tx's sender to its
recipient for exactly `amountMicro` (ERC-20 USDC on Arc has 6 decimals). The result is stored on the `ChainTx` as
`verified: { ok, at, logId?, reason?, internal? }` (`internal` = a `customer_topup` from the demo-funds wallet, not a customer
payment). It never changes escrow state, never blocks a release or refund and holds no key. The heartbeat checks up to 5
COMPLETE, unchecked transfers per beat (code, no Claude): a mismatch opens one `needs_info` operator task and an
`arc_verify` log entry; an RPC outage, or a hash the RPC does not know yet, is retried on a later beat (a hash still
unknown an hour after the transfer is reported). Shown as "verified on Arc" on the operator escrow panel and `/arc`, and as
"Terverifikasi di Arc" on the customer page.
- `KESUNI_ARC_RPC_URL`: Arc RPC (may contain an API key; never logged or returned). Default `https://rpc.testnet.arc.io`.
- `KESUNI_ARC_CHAIN_ID`: expected chain id. Default 5042002 (Arc Testnet). On a mainnet chain both must be set, or
  the check reports "not configured" instead of guessing.

The Circle gateway refuses an API key from the wrong environment before any client is made: a `LIVE_API_KEY…` needs
`KESUNI_ALLOW_MAINNET=1` and a mainnet chain; a `TEST_API_KEY…` cannot be used on a mainnet chain.

## Customer page (`/c/<token>`, open: the token is the secret)
| Method & path | Body | Result |
|---|---|---|
| `GET /api/c/:token` | none | The customer's view (`CustomerView` in `src/lib/customer.ts`), no wallet ids, vendor addresses or agent log. `overTolerance: true` when the operator's measured `maxDeviationMm` is above the agreed `spec.toleranceMm` |
| `POST /api/c/:token` | `{ action: "agree", by }` \| `{ action: "pay", agree?: true, by? }` | Approve the price and spec; pay into escrow (testnet: test USDC first) |
| `POST /api/c/:token` | `{ action: "accept", by, note, checked: true }` | Accept the goods. `checked` must be exactly `true` (the customer ticked "Saya sudah memeriksa ukuran, warna, finishing, dan fungsi barang yang saya terima."), else **400**. Above the tolerance the page warns but accepting is allowed: the acceptance note gets "[Diterima walau selisih ukuran X mm melebihi batas ±Y mm]" and the `customer_decision` log entry `acceptedOverTolerance: { maxDeviationMm, toleranceMm }`. Then code releases the escrow through the policy (`checkRelease`, unchanged). `{ ok, settled, reasons? }` |
| `POST /api/c/:token` | `{ action: "reject", by, note }` | Reject (no tick needed); code refunds through the policy. `{ ok, settled, reasons? }` |
| `POST /api/c/:token` | `{ action: "review", quality, communication, value, text, by }` | The customer's review after payout |

## Order status flow
`CREATED → PLAN_CHOSEN → IN_PRODUCTION → EVIDENCE_SUBMITTED → ACCEPTED | REJECTED`, then `ACCEPTED → PAID`
when the escrow release is `COMPLETE` on Arc.

## Escrow (`src/lib/escrow.ts`, Circle developer-controlled SCA wallets on Arc)
`AWAITING_DEPOSIT → FUNDED → RELEASED | REFUNDED`
- `open`: needs a chosen quote. Creates a customer wallet and a per-order escrow wallet. Amount = quote price.
- `topup` (testnet only): Kesuni's demo-funds wallet sends test USDC to the customer wallet.
- `deposit`: customer wallet → escrow wallet.
- `release`: policy `checkRelease` (customer accepted, QC evidence, escrow funded with at least the amount, recipient = the
  approved vendor's real address, never a placeholder, nothing released before), then creates/reuses the payment intent and
  sends escrow → vendor. Intent goes `SUBMITTED → CONFIRMED` with the tx hash.
- `refund`: policy `checkRefund` (customer rejected), escrow → customer.
- Every transfer saves a UUID idempotency key before calling Circle. A lost call stays `NOT_SUBMITTED` and the next
  sync retries with the same key, so Circle never executes it twice. SCA wallets have gas paid by Circle Gas Station,
  so an escrow can hold exactly the order amount.

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
The Chief (Claude) gets `get_order`, `get_quotes`, `get_available_budget`, `check_vendor_policy`, `choose_plan`,
`request_human_decision`, `estimate_cost` (a check only), `price_by_weight`, `get_production_status`, `choose_printer`,
`create_operator_task` and `message_customer`. It never gets a payment tool: `propose_payment` (and
`price_with_calculator`) exist for code and tests only; money moves only through the policy-gated escrow code. The agent
never sees the customer's name, phone, address or email. Writes go through `src/lib/actions.ts`, the same code the HTTP
routes use, so an agent cannot bypass policy. Every call is stored in `agentLog` (returned by `GET /api/orders/:id`).

## Not built yet
Circle webhooks, vendor
management, and hosted storage for the live link. Customer payment on mainnet: a customer cannot fund their wallet or
see its deposit address in the app (on testnet Kesuni sends test USDC).
