# Open3DKesuni

The order desk of **Kesuni**, a real 3D-print studio in Padang, Indonesia. An AI agent, the Chief (Claude), takes the
orders, prices them by weight, plans the three printers and keeps the customer updated. Deterministic code decides
everything that touches money or a printer. The customer's payment waits in a per-order USDC escrow on Arc (Circle
wallets) until they accept the part.

Built for the Tameion Agents Hackathon (October 2026).

- **Live site:** https://open3dkesuni.up.railway.app
  - `/`: what it is, with live counts.
  - `/live`: read-only, no login. The printers, the agent at work (with its limits and last nightly report), money on
    Arc, and the token research.
  - `/customer`: the customer portal, where a real customer places an order (the token research is there too).
- **Demo video:** linked from the landing page once it is set (`DEMO_VIDEO_URL`).

## What is real and what is simulated

| Real | Simulated or test |
|---|---|
| Three Bambu Lab A1 Combo printers in the studio, reporting live over a LAN bridge (MQTT) | Orders the team made to test, labelled `simulated` and never counted |
| Orders from pilot customers (small businesses in Padang), labelled `real` | The six practice scenarios on `/demo` (team only), also `simulated` |
| Claude runs on those orders, every tool call in the decision log | The rule-based planner, when no Claude key is set (same tools and policy) |
| Escrow transfers on **Arc Testnet**: real transactions, each re-checked on Arc | The money: **test USDC** from Kesuni's demo wallet, not customer money. Payment to Kesuni is in rupiah, outside the app |

Every order and transfer on the site carries its label (`docs/EVIDENCE_LABELS.md`). An operator can mark a practice
order from the public form `simulated` (`POST /api/orders/:id/label`, logged with their name), so a judge's test order
stops counting as traction once it is marked. An order whose escrow still holds money is marked after its release or
refund, so until then it is counted.

**Traction, honestly** (snapshot 17 Oct 2026, about 04:30 WIB; live numbers on `/live`):

- 4 real orders from 3 pilot customers (an accessories shop, a graphic designer, a boarding-house owner).
- 3 escrow deposits on real orders, verified on Arc (test USDC from Kesuni's demo wallet).
- 1 real order done end to end: 5 lamps (ORD-005). The price was above the customer's budget; the customer raised
  it on their own page, the Chief chose the plan, the escrow was funded, the customer accepted the lamps and the
  release (122.727273 test USDC) was verified on Arc.
- 24 Claude runs on orders by 02:00 WIB; 82.5% of their input tokens came from the prompt cache.

## How the Chief works

One Claude agent (the "Chief Kesuni Officer") with five skills: Finance, Operations, Machines, Quality, Customer. It
works on one order per run. It wakes on events (a new order, slicer grams entered, a payment, the owner's approval) and
from a heartbeat: code checks open orders and printers every 2 minutes and wakes Claude only for a new problem that needs
a decision, with a cap on wakes per hour. Each run ends with "Decision: …" and "Waiting on: …", shown on `/live`.

Claude proposes; code checks every step and has the last word:

| Tool | Claude proposes | Code gate |
|---|---|---|
| `get_order`, `get_quotes`, `get_available_budget`, `get_production_status` | Reads the order, quotes, budget, printers and payment | Read-only. Never the customer's name, phone, address or link token |
| `price_by_weight` | Kesuni's price from the slicer grams | Only grams a person or the studio's slicer entered; PLA and PETG only; rupiah per gram and rounding from config; never under the owner's margin; only before a plan is chosen |
| `estimate_cost` | A check with the long cost calculator | Saves nothing |
| `check_vendor_policy`, `choose_plan` | Picks the production quote | Policy engine: the customer's budget mandate, the owner's rules (minimum order, approval limit, partner minimum, margin) and the deadline. Only the owner can lift an owner rule |
| `choose_printer` | Links a ready printer | Only after the escrow is funded; printer online, idle, bed empty. A person cannot start a print of an unpaid real order either |
| `request_dispatch` | Asks the print dispatcher to look now | The dispatcher is code: it prints only with the switch on and a person's "Bed is empty", one print per confirmation |
| `create_operator_task` | Asks a person for physical work | Three task kinds (filament, printer check, collect and QC); no reprint decisions |
| `request_human_decision` | Hands a question to the owner or operator | Opens a task for a person |
| `message_customer` | A short update on the customer's page, in English and Indonesian (the page shows the customer's language) | Both texts checked: at most 500 characters each; no links, wallet addresses, phone numbers, emails or repeats; no amount but the order's price, no free, discount or refund words in either language; rate-limited |

**No money tool.** Claude gets 13 tools and none of them moves money; a test fails if one looks like it could. Release
and refund run in code after the customer accepts or rejects on their own page, through the policy engine (accepted,
QC recorded, payee and amount match, one idempotency key per transfer).

Three real catches from the decision log:

1. A test order was marked "in production", but its escrow had no deposit and the only printer log was a Benchy test
   print, not the ordered part. The Chief stopped and asked a person instead of carrying on.
2. An order for a desk lamp (later marked a test) had three attached files, all the same model of a scraper. The Chief
   asked before the customer paid.
3. The operator entered 270 g per unit for a 60 × 30 × 15 mm part. The Chief called it too heavy, asked for a re-check,
   and refused to bend the grams or the price to fit the budget. The studio's own slice later said 55 g.

## How the money works: Circle + Arc

- **Two Circle wallets per order:** the customer's and the escrow. Both are developer-controlled smart-contract wallets
  (SCA) on Arc; Circle keeps the keys and Kesuni's server asks for each transfer (`src/lib/circle.ts`, `src/lib/escrow.ts`).
- **Idempotency:** every transfer gets a UUID idempotency key, saved before Circle is called. A retry after a timeout or
  a restart sends the same key, so a transfer never happens twice.
- **Gas Station:** Circle pays the gas. The wallets are ERC-4337 smart accounts, so the Arc explorer shows a transfer as
  a Bundler call to the EntryPoint contract; the USDC moved is under "Tokens transferred".
- **Re-checked on Arc:** every completed transfer is read back over Arc's RPC (receipt success, canonical block, exactly
  one matching USDC Transfer) and only then shown as "Verified on Arc" (`src/lib/arc-verify.ts`).
- **Test USDC:** on Arc Testnet, Kesuni's demo-funds wallet tops up the customer's wallet before the deposit. That top-up
  is internal and never counted.
- **Honest limit:** Kesuni holds these wallets. Release and refund are guarded by the policy engine in our code, not by a
  smart contract. Mainnet is locked unless `KESUNI_ALLOW_MAINNET=1` (see `docs/PILOT.md`).

## Run it

Node 24 (storage uses Node's built-in `node:sqlite`; Node prints an `ExperimentalWarning` for it, which is expected).

```bash
npm install
cp .env.example .env.local   # optional; never commit it
npm test                     # vitest: policy, escrow (fake Circle), agent tools, pages
npm run typecheck:clean      # fresh clone: next typegen (route types) && tsc --noEmit; later `npm run typecheck`
npm run dev                  # http://localhost:3000
```

No key is needed to try it: without `ANTHROPIC_API_KEY` the Chief runs in **rules mode**, a rule-based planner with the
same tools and the same policy, and no Claude call. Without Circle keys the escrow stays off and the rest works. For
Circle on Arc Testnet run `node scripts/circle-setup.mjs` once (see `.env.example`);
`RUN_ARC_E2E=1 npx vitest run src/lib/escrow.e2e.test.ts` runs the real escrow flow. The printer bridge runs on the
studio PC: `node scripts/printer-bridge.mjs`. Deployment: `docs/DEPLOY-RAILWAY.md`. Every route: `docs/API_CONTRACT.md`.

## Design rules

- The LLM compares options and calls allowed tools. It never computes or sends money.
- A deterministic policy engine locks budget, vendor, recipient, amount, token/decimals,
  acceptance prerequisite, and idempotency.
- Agent writes use the same validation as the human UI.
- Payment state: `ALLOCATED, PAYMENT_INTENT_CREATED, SUBMITTED, CONFIRMED, UNKNOWN, PARTIALLY_PAID`.
  On `UNKNOWN`, check the original transaction before any retry.

## Security

Never commit `.env*`, `~/.arc-canteen/wallet.yaml`, private keys, or RPC URLs that contain keys.
